// tempRouter — MPP-paid, attestation-gated private inference on Tempo.
// Agent-only. Blind relay (ADR-0001) in front of the real Phala Intel TDX enclave.
// Payment is native Tempo/pathUSD via mppx; the session challenge binds the stable
// enclave key into `meta` so the voucher settles against a named attested enclave (ADR-0002).
//
// Streaming follows mpp.dev/guides/streamed-payments + mppx's own hono middleware
// (src/middlewares/hono.ts): gate 402 → ack management requests with `withReceipt()`
// (no args) → else run inference and meter via an async generator that calls
// `await stream.charge()` before each yielded chunk.

import { serve as honoServe } from '@hono/node-server'
import { Hono } from 'hono'
import { Mppx, tempo, Store } from 'mppx/server'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { config, resolveMode, tempoTestnet, type PrivacyMode } from './config.js'
import { teeProcess, fetchAttestation, fetchTeePublicKeyRaw, chunk } from './upstream.js'

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const PROOF_SENTINEL = '__TEMPROUTER_PROOF__' // final SSE frame carrying the post-pay receipt

const mppx = Mppx.create({
  methods: [
    tempo({
      recipient: config.recipient,
      testnet: true, // Tempo Moderato, currency pathUSD
      chainId: tempoTestnet.chainId, // 42431 — REQUIRED: session intent else defaults to mainnet 4217
      store: Store.memory(),
      sse: true, // per-unit SSE metering on the session method
    }),
  ],
  secretKey: config.secretKey,
})

let MODE: PrivacyMode = 'stub'
mppx.onChallengeCreated((ctx) => console.log(`[challenge] ${ctx.method?.intent}`))
mppx.onPaymentFailed((ctx) => console.log(`[payfail] ${ctx.error?.message ?? ctx.error}`))

const app = new Hono()

app.get('/', (c) => {
  // Humans get the branded landing page; agents/curl get machine JSON.
  if ((c.req.header('accept') ?? '').includes('text/html')) {
    try {
      return c.html(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'))
    } catch {
      /* fall through to JSON */
    }
  }
  return c.json({
    name: 'tempRouter',
    what: 'MPP-paid, attestation-gated private AI inference on Tempo',
    mode: MODE,
    network: { chainId: tempoTestnet.chainId, currency: 'pathUSD', explorer: tempoTestnet.explorer },
    privacy: 'prompt is E2E-encrypted to a real Phala Intel TDX enclave; this relay is blind',
    endpoints: {
      'POST /v1/chat/completions/stream': `session, ${config.pricePerUnit} pathUSD/response-chunk (SSE)`,
      'GET /tee/attestation': 'enclave attestation (verify before you pay)',
      'GET /openapi.json': 'MPP service discovery',
    },
    recipient: config.recipient,
  })
})

// ── Blind passthrough to the enclave (free; agent verifies BEFORE paying) ─────
app.get('/tee/attestation', async (c) => c.json(await fetchAttestation()))
app.get('/tee/public-key', async (c) => c.json(await fetchTeePublicKeyRaw()))

// ── Per-unit attested private inference (session + SSE metering) ──────────────
app.post('/v1/chat/completions/stream', async (c) => {
  // Bind payment to the STABLE attested enclave identity (teePublicKeySha256). The
  // quote bytes change per call, but this key is constant across the challenge→pay
  // →retry cycle. The agent verifies the same key pre-pay (ADR-0002).
  const att = await fetchAttestation()
  const enclaveId = att?.teePublicKeySha256 ?? sha256hex(JSON.stringify(att?.tdxQuote ?? null))

  const result = await mppx.session({
    amount: config.pricePerUnit,
    unitType: 'response-chunk',
    description: 'Private inference in a real Phala Intel TDX enclave',
    meta: { enclaveKey: enclaveId },
    suggestedDeposit: config.maxDeposit, // fund once with headroom; fewer mid-stream top-ups
  })(c.req.raw.clone())

  if (result.status === 402) return result.challenge

  // Management requests (top-up / voucher) are acked with withReceipt() and NO args
  // (canonical — mppx/middlewares/hono.ts). It throws MissingReceiptResponseError for
  // a resource request, which we catch to proceed with inference.
  try {
    return await result.withReceipt()
  } catch (e) {
    if (!Mppx.isMissingReceiptResponseError(e)) throw e
  }

  // Resource request: run the attested private inference + meter the stream.
  try {
    const { encryptedPrompt, model } = (await c.req.raw.json()) as { encryptedPrompt: string; model?: string }
    console.log(`[stream] paid → teeProcess (prompt ${encryptedPrompt?.length ?? 0} bytes)`)
    const tee = await teeProcess(encryptedPrompt, model ?? config.upstreamModel)
    console.log(`[stream] tee ok → encryptedResponse ${tee.encryptedResponse?.length ?? 0} bytes`)

    const chunks = chunk(tee.encryptedResponse, config.chunkCount)
    const proofFrame = PROOF_SENTINEL + JSON.stringify({ attestation: tee.attestation, encryptionProof: tee.encryptionProof })
    return await result.withReceipt(async function* (stream: { charge(): Promise<void> }) {
      for (const ch of chunks) {
        await stream.charge() // reserve voucher headroom; waits (emits need-voucher) if exhausted
        yield ch
      }
      yield proofFrame // receipt metadata — not a billable unit
    })
  } catch (e: any) {
    console.error('[stream] ERROR:', e?.message ?? e)
    return c.json({ error: 'stream_failed', detail: String(e?.message ?? e) }, 500)
  }
})

// ── MPP service discovery (mpp.dev/services + MPPScan) ───────────────────────
app.get('/openapi.json', (c) => {
  const amountRaw = String(Math.round(Number(config.pricePerUnit) * 10 ** tempoTestnet.decimals))
  return c.json({
    openapi: '3.1.0',
    info: { title: 'tempRouter', version: '0.1.0', description: 'Attestation-gated private AI inference, paid per response-chunk in pathUSD on Tempo.' },
    'x-service-info': {
      categories: ['ai', 'inference', 'privacy'],
      docs: { homepage: 'https://github.com/Router-Labs/tempRouter', llms: '/llms.txt' },
    },
    paths: {
      '/v1/chat/completions/stream': {
        post: {
          summary: 'Private TDX inference, metered per response-chunk over SSE',
          'x-payment-info': {
            offers: [{ amount: amountRaw, currency: tempoTestnet.pathUsd, intent: 'session', method: 'tempo' }],
          },
          responses: { '200': { description: 'OK (SSE stream)' }, '402': { description: 'Payment Required' } },
        },
      },
    },
  })
})

app.get('/llms.txt', (c) => {
  try {
    return c.text(readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8'))
  } catch {
    return c.text('# tempRouter\nAttestation-gated private AI inference paid per response-chunk in pathUSD on Tempo.\n')
  }
})

resolveMode().then((mode) => {
  MODE = mode
  honoServe({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`tempRouter on http://localhost:${info.port}  | mode=${MODE}  | recipient=${config.recipient}`)
    if (MODE !== 'tdx-live') console.log(`⚠️  mode=${MODE}: no live TDX — agents will (correctly) refuse to pay. Set TEE_ENDPOINT for tdx-live.`)
  })
})
