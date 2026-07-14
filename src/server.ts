// tempRouter — MPP-paid, attestation-gated private inference on Tempo.
// Agent-only. Blind relay (ADR-0001) in front of the real Phala Intel TDX enclave.
// Payment is native Tempo/pathUSD via mppx; the session challenge attaches the stable
// enclave key to `meta` as a settlement LABEL (not an enforced gate — see ADR-0002 §4).
//
// Streaming follows mpp.dev/guides/streamed-payments + mppx's own hono middleware
// (src/middlewares/hono.ts): gate 402 → ack management requests with `withReceipt()`
// (no args) → else run inference and meter via an async generator that calls
// `await stream.charge()` before each yielded chunk.

import { serve as honoServe } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Mppx, tempo, Store } from 'mppx/server'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { config, resolveMode, tempoChain, isMainnet, DEV_SECRET_KEY, DEV_RECIPIENT, type PrivacyMode } from './config.js'
import { teeProcess, fetchAttestation, fetchTeePublicKeyRaw, chunk } from './upstream.js'
import { log } from './logger.js'

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const PROOF_SENTINEL = '__TEMPROUTER_PROOF__' // final SSE frame carrying the post-pay receipt
const startedAt = Date.now()

// Cap the request body. The only content body is an encrypted prompt; anything past this
// is abuse, not a prompt. Management (voucher/close) POSTs are header-only (0 bytes).
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_000_000)

// The encrypted-prompt content body. The relay is blind: it validates SHAPE only and
// never inspects/decrypts the ciphertext.
const ContentBody = z.object({
  encryptedPrompt: z.string().min(1),
  model: z.string().min(1).max(128).optional(),
})

// When the payee key is configured, the server signs the on-chain CLOSE as the
// recipient (settlement sender must equal the channel payee), paying the tx fee from
// its own pathUSD. Without it, cooperative close 402s and the deposit reclaims on
// timeout (ADR-0003). NB: do NOT set `feePayer: true` — that makes the server sponsor
// the PAYER's channel-open tx, which trips Tempo's sponsor maxFeePerGas policy.
const settlementAccount = config.recipientPrivateKey ? privateKeyToAccount(config.recipientPrivateKey) : undefined
const recipientMismatch = settlementAccount
  ? config.recipient.toLowerCase() !== settlementAccount.address.toLowerCase()
  : false
if (recipientMismatch)
  log.warn('recipient_mismatch', { recipient: config.recipient, settlementAccount: settlementAccount?.address })

// ── Mainnet safety gate — fail closed, real USDC.e must never ride dev defaults ──
// On testnet the fallbacks are a convenience; on mainnet the same fallbacks would
// settle real money to the demo address / verify challenges with a public secret,
// and a recipient/key mismatch makes every cooperative close fail the on-chain
// payee check (mppx Settlement) — silently, per request. Refuse to boot instead.
if (isMainnet) {
  const fatal = (reason: string, extra: Record<string, unknown> = {}) => {
    log.error('mainnet_guard', { reason, ...extra })
    process.exit(1)
  }
  if (config.recipient.toLowerCase() === DEV_RECIPIENT.toLowerCase())
    fatal('TEMPO_RECIPIENT is the built-in demo address — set your own mainnet earnings address')
  if (config.secretKey === DEV_SECRET_KEY)
    fatal('MPP_SECRET_KEY is the insecure dev default — set a long random secret')
  if (recipientMismatch)
    fatal('TEMPO_RECIPIENT_PRIVATE_KEY address does not match TEMPO_RECIPIENT — every cooperative close would fail on-chain', {
      recipient: config.recipient,
      settlementAccount: settlementAccount?.address,
    })
  if (!settlementAccount)
    log.warn('mainnet_no_payee_key', {
      hint: 'cooperative close disabled — unsettled revenue reclaims to payers on channel timeout (ADR-0003); set TEMPO_RECIPIENT_PRIVATE_KEY',
    })
}

const mppx = Mppx.create({
  methods: [
    tempo({
      // An `account` makes the server sign settlement as the payee AND become the
      // recipient; otherwise fall back to the address-only recipient (no cooperative close).
      ...(settlementAccount ? { account: settlementAccount } : { recipient: config.recipient }),
      testnet: !isMainnet, // Moderato (testnet) or Allegro (mainnet)
      chainId: tempoChain.chainId, // 42431 testnet | 4217 mainnet
      store: Store.memory(),
      sse: true, // per-unit SSE metering on the session method
    }),
  ],
  secretKey: config.secretKey,
})

let MODE: PrivacyMode = 'stub'
mppx.onChallengeCreated((ctx) => log.info('mpp.challenge', { intent: ctx.method?.intent }))
mppx.onPaymentFailed((ctx) => log.warn('mpp.payfail', { error: String(ctx.error?.message ?? ctx.error) }))

const app = new Hono()

// Agents call cross-origin; allow the MPP handshake headers explicitly.
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
    exposeHeaders: ['payment-receipt', 'payment-required'],
    maxAge: 86400,
  }),
)

// One structured access-log line per request (method, path, status, ms).
app.use('*', async (c, next) => {
  const t0 = Date.now()
  await next()
  log.info('req', { method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms: Date.now() - t0 })
})

// Don't leak internals on an unexpected throw; log server-side, return a clean 500.
app.onError((err, c) => {
  log.error('unhandled', { path: new URL(c.req.url).pathname, error: err instanceof Error ? err.message : String(err) })
  return c.json({ error: 'internal_error' }, 500)
})
app.notFound((c) => c.json({ error: 'not_found' }, 404))

// Liveness/readiness: process is up, and whether the private lane is actually reachable.
app.get('/health', (c) =>
  c.json({ status: 'ok', mode: MODE, ready: MODE === 'tdx-live', uptimeSec: Math.floor((Date.now() - startedAt) / 1000) }),
)

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
    network: { chainId: tempoChain.chainId, currency: tempoChain.currencyName, explorer: tempoChain.explorer },
    privacy: 'prompt is E2E-encrypted to a real Phala Intel TDX enclave; this relay is blind',
    endpoints: {
      'POST /v1/chat/completions/stream': `session, ${config.pricePerUnit} ${tempoChain.currencyName}/response-chunk (SSE)`,
      'GET /tee/attestation': 'enclave attestation (verify before you pay)',
      'GET /openapi.json': 'MPP service discovery',
      'GET /llms.txt': 'agent-readable context',
      'GET /SKILL.md': 'agent skill entrypoint',
    },
    recipient: config.recipient,
  })
})

// ── Blind passthrough to the enclave (free; agent verifies BEFORE paying) ─────
app.get('/tee/attestation', async (c) => c.json(await fetchAttestation()))
app.get('/tee/public-key', async (c) => c.json(await fetchTeePublicKeyRaw()))

// ── Per-unit attested private inference (session + SSE metering) ──────────────
app.post('/v1/chat/completions/stream', async (c) => {
  // Read the body ONCE. The CONTENT (open) request carries the encrypted-prompt JSON;
  // mid-stream MANAGEMENT POSTs (voucher top-up / close) are header-only (Authorization
  // only, empty body). @hono/node-server hands even an empty POST a NON-null body stream,
  // so mppx's captureRequest reports `hasBody: true` and MISCLASSIFIES a header-only
  // voucher POST as billable content — it then double-charges the channel (eating the
  // very headroom the voucher just added → the stream's commit throws "reserved voucher
  // coverage is no longer available") and 500s below on the empty JSON body. Normalize:
  // hand mppx a request whose body is null when there is no real content, so voucher/close
  // correctly classify as management (clean 204 ack, no spurious charge). This is what
  // unblocks multi-unit streaming (chunkCount > 1). See ADR-0003.
  const bodyText = await c.req.raw.text()
  if (bodyText.length > MAX_BODY_BYTES) {
    log.warn('body.too_large', { bytes: bodyText.length })
    return c.json({ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES }, 413)
  }
  const reqForMppx = new Request(c.req.raw.url, {
    method: 'POST',
    headers: c.req.raw.headers,
    ...(bodyText.length ? { body: bodyText } : {}),
  })

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
  })(reqForMppx)

  if (result.status === 402) return result.challenge

  // Management requests (top-up / voucher / close) are acked with withReceipt() and NO
  // args (canonical — mppx/middlewares/hono.ts). It throws MissingReceiptResponseError for
  // a content request, which we catch to proceed with inference.
  try {
    return await result.withReceipt()
  } catch (e) {
    if (!Mppx.isMissingReceiptResponseError(e)) throw e
  }

  // Content request: validate the body SHAPE (blind — never inspects ciphertext), then
  // run the attested private inference + meter the stream.
  let encryptedPrompt: string
  let model: string | undefined
  try {
    const parsed = ContentBody.safeParse(JSON.parse(bodyText))
    if (!parsed.success) {
      log.warn('body.invalid', { issues: parsed.error.issues.map((i) => i.path.join('.')) })
      return c.json({ error: 'invalid_body', detail: 'expected { encryptedPrompt: string, model?: string }' }, 400)
    }
    ;({ encryptedPrompt, model } = parsed.data)
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }

  try {
    log.info('stream.paid', { promptBytes: encryptedPrompt.length })
    const tee = await teeProcess(encryptedPrompt, model ?? config.upstreamModel)
    log.info('stream.tee_ok', { responseBytes: tee.encryptedResponse?.length ?? 0 })

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
    log.error('stream.failed', { error: String(e?.message ?? e) })
    return c.json({ error: 'stream_failed', detail: String(e?.message ?? e) }, 500)
  }
})

// ── MPP service discovery (mpp.dev/services + MPPScan) ───────────────────────
app.get('/openapi.json', (c) => {
  const amountRaw = String(Math.round(Number(config.pricePerUnit) * 10 ** tempoChain.decimals))
  return c.json({
    openapi: '3.1.0',
    info: { title: 'tempRouter', version: '0.1.0', description: `Attestation-gated private AI inference, paid per response-chunk in ${tempoChain.currencyName} on Tempo.` },
    servers: [{ url: c.req.url.replace(/\/openapi\.json$/, ''), description: 'Current origin' }],
    'x-service-info': {
      categories: ['ai', 'inference', 'privacy'],
      docs: { homepage: 'https://github.com/Router-Labs/tempRouter', llms: '/llms.txt' },
    },
    paths: {
      '/v1/chat/completions/stream': {
        post: {
          summary: 'Private TDX inference, metered per response-chunk over SSE',
          'x-payment-info': {
            offers: [{ amount: amountRaw, currency: tempoChain.currency, intent: 'session', method: 'tempo' }],
          },
          responses: {
            '200': { description: 'OK (SSE stream of decrypted response chunks)', content: { 'text/event-stream': {} } },
            '402': { description: 'Payment Required — MPP Tempo session challenge', content: { 'application/problem+json': {} } },
          },
        },
      },
    },
  })
})

// Agent-readable context, generated per-network so discovery can never contradict the
// 402 challenge / openapi.json. (public/llms.txt is a static snapshot for the repo/Pages;
// this route — not the file — is what paying agents read.)
const NETWORK_LABEL = isMainnet ? 'Tempo mainnet' : 'Tempo Moderato testnet'
const MONEY_LINE = isMainnet
  ? 'REAL MONEY — every response-chunk settles in USDC.e on mainnet.'
  : 'Testnet only — not mainnet, no real money.'
app.get('/llms.txt', (c) =>
  c.text(`# tempRouter

> A payable, end-to-end-encrypted LLM inference endpoint on MPP — pay per response-chunk in ${tempoChain.currencyName} on ${NETWORK_LABEL}.

tempRouter is an MPP-payable endpoint for **confidential** LLM inference. An agent
pays per response-chunk in ${tempoChain.currencyName} over an MPP session — but only after it
cryptographically verifies (Intel DCAP) that inference runs inside a real Phala
Intel TDX enclave that cannot read the prompt. The relay is blind: it forwards
only ciphertext and never holds a decryption key.

## When to use
Use tempRouter when the prompt contains secrets, credentials, PII, or other
confidential data that must never reach a third-party model host. For non-sensitive
work, use a normal (cheaper / more capable) public model — the private lane runs an
OSS model (gpt-oss:20b) in the enclave.

## Flow (agent)
1. GET /tee/attestation → verify the TDX quote (DCAP) BEFORE paying.
2. Encrypt the prompt to the enclave key (Arcium RescueCipher + X25519).
3. POST /v1/chat/completions/stream with {encryptedPrompt, model}.
   - 402 → open an MPP session (${NETWORK_LABEL}, chain ${tempoChain.chainId}), pay per chunk.
   - 200 → SSE stream of ciphertext chunks (one MPP voucher tick each) + a final receipt frame.
4. Reassemble + decrypt locally.

## Payment
- Network: ${NETWORK_LABEL} (chain ${tempoChain.chainId}), currency ${tempoChain.currencyName} (${tempoChain.decimals} decimals). ${MONEY_LINE}
- Price: ${config.pricePerUnit} ${tempoChain.currencyName} per response-chunk.
- Model: MPP \`tempo\` session intent, unitType \`response-chunk\`.
- Discovery: GET /openapi.json (x-service-info + x-payment-info) — the 402 challenge is authoritative.
- Entrypoint: GET /SKILL.md — agent skill (install: \`npx skills add Router-Labs/tempRouter\`).

## Verified runs
Three real Tempo Moderato testnet runs (each tripping a different detector) are linked on the
landing page (#verified): openai-key, email/PII, and hex-private-key — each settled at 0.0002 pathUSD.
The enclave key is attached to the MPP session as a settlement label, not an enforced gate.
`),
)

// Crawler/agent discoverability: robots + /.well-known aliases for the discovery surfaces.
app.get('/robots.txt', (c) => {
  try {
    return c.text(readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8'))
  } catch {
    return c.text('User-agent: *\nAllow: /\n')
  }
})
app.get('/.well-known/llms.txt', (c) => c.redirect('/llms.txt'))
app.get('/.well-known/openapi.json', (c) => c.redirect('/openapi.json'))
app.get('/.well-known/skill.md', (c) => c.redirect('/SKILL.md'))

// ── Agent skill entrypoint (installable: `npx skills add Router-Labs/tempRouter`) ──
// The repo file is network-neutral; stamp the live network under the H1 so an agent
// reading the served copy knows exactly which chain/currency THIS deployment charges.
const SKILL_HEADING = '# tempRouter — payable confidential inference (entrypoint)'
const SKILL_NET_BANNER = `> **Live network:** ${NETWORK_LABEL} (chain \`${tempoChain.chainId}\`), currency **${tempoChain.currencyName}**. ${MONEY_LINE}`
const serveSkill = (c: any) => {
  try {
    const raw = readFileSync(new URL('../skills/temprouter/SKILL.md', import.meta.url), 'utf8')
    const stamped = raw.includes(SKILL_HEADING) ? raw.replace(SKILL_HEADING, `${SKILL_HEADING}\n\n${SKILL_NET_BANNER}`) : raw
    return c.text(stamped, 200, {
      'content-type': 'text/markdown; charset=utf-8',
    })
  } catch {
    return c.text(`# tempRouter\nPayable, E2E-encrypted LLM inference on MPP, per response-chunk in ${tempoChain.currencyName}. See /llms.txt + /openapi.json.\n`)
  }
}
// Canonical path + the common variants a human or agent might try.
for (const p of ['/SKILL.md', '/skill.md', '/skill', '/skills.md', '/skills']) app.get(p, serveSkill)

resolveMode().then((mode) => {
  MODE = mode
  const server = honoServe({ fetch: app.fetch, port: config.port }, (info) => {
    log.info('listening', { port: info.port, mode: MODE, recipient: config.recipient })
    if (MODE !== 'tdx-live')
      log.warn('no_live_tdx', { mode: MODE, hint: 'agents will (correctly) refuse to pay; set TEE_ENDPOINT for tdx-live' })
  })

  // Graceful shutdown: stop accepting connections, let in-flight requests drain, then exit.
  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    log.info('shutdown', { signal })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})
