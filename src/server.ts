// tempRouter — MPP-paid, attestation-gated private inference on Tempo.
// Agent-only. Blind relay (ADR-0001) in front of the real Phala Intel TDX enclave.
// Payment is native Tempo/pathUSD via mppx; the 402 challenge binds sha256(tdxQuote)
// into externalId so the voucher settles against a named attested enclave (ADR-0002).

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
      testnet: true, // Tempo Moderato (42431), currency pathUSD
      store: Store.memory(),
      sse: true, // enable per-unit SSE metering on the session method
    }),
  ],
  secretKey: config.secretKey,
})

let MODE: PrivacyMode = 'stub'

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
  // Bind payment to the live enclave quote: externalId = sha256(tdxQuote).
  const att = await fetchAttestation()
  const externalId = sha256hex(JSON.stringify(att?.tdxQuote ?? null))

  // mppx issues / verifies the TIP-1034 session challenge (HMAC-binds externalId).
  // Bind the quote digest via `meta` (HMAC-signed into the challenge opaque).
  // NB: `externalId` is a charge-intent field; the session intent binds via meta.
  const result = await mppx.session({
    amount: config.pricePerUnit,
    unitType: 'response-chunk',
    description: 'Private inference in a real Phala Intel TDX enclave',
    meta: { teeQuoteDigest: externalId },
  })(c.req.raw.clone())

  if (result.status === 402) return result.challenge // a 402 Response with the challenge

  // Paid. Settlement re-check: the enclave must not have rotated since the challenge.
  const liveAtt = await fetchAttestation()
  if (sha256hex(JSON.stringify(liveAtt?.tdxQuote ?? null)) !== externalId) {
    return c.json({ error: 'enclave_quote_rotated', detail: 'attested quote changed after challenge; refusing to serve' }, 409)
  }

  const { encryptedPrompt, model } = (await c.req.raw.json()) as { encryptedPrompt: string; model?: string }
  const tee = await teeProcess(encryptedPrompt, model ?? config.upstreamModel)

  // Meter: each ciphertext chunk = one voucher tick. Final frame carries the receipt.
  const chunks = chunk(tee.encryptedResponse, config.chunkCount)
  const proofFrame = PROOF_SENTINEL + JSON.stringify({ attestation: tee.attestation, encryptionProof: tee.encryptionProof })
  async function* gen() {
    for (const ch of chunks) yield ch
    yield proofFrame
  }
  return result.withReceipt(gen()) // mppx wraps as metered SSE + payment-receipt
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
