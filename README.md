# tempRouter

> **Pay an LLM only after you can prove it never saw your prompt.**
> MPP-paid, attestation-gated private AI inference on Tempo. — *Berlin MPP Hackathon @ Futura Camp 2026.*

An AI agent pays per response-chunk in **pathUSD** on Tempo — but only after it
cryptographically verifies (Intel DCAP) that the prompt runs inside a **real Phala
Intel TDX enclave** that can't read it. tempRouter is a **blind relay**: it forwards
ciphertext, holds no key, and never sees plaintext.

Payment was the easy half — MPP already does per-token stablecoin billing. The new
contribution is the half MPP left open: **provable confidentiality fused into the
payment handshake** (the 402 challenge binds the enclave quote digest; the agent
verifies it before signing the first voucher).

## How it fits together

```
agent (src/agent.ts)
  0. detectSensitive(prompt)         ── secret/PII? → force the private lane
  1. GET /tee/attestation            ── verifyQuote() : Intel DCAP, fail-closed
  2. encrypt(prompt → enclave key)   ── Arcium RescueCipher + X25519 (@solrouter/sdk)
  3. sessionManager.sse(POST …)      ── MPP session, pay per response-chunk (Tempo Moderato)
        │
        ▼
tempRouter (src/server.ts)  ── BLIND RELAY (holds no key)
  · mppx.session({sse:true}) gates payment; binds sha256(tdxQuote) into challenge meta
  · forwards ciphertext → real Phala Intel TDX /process → meters reply chunks (withReceipt)
        │
        ▼
Phala Intel TDX enclave (SolRouter prod, chain-agnostic)
  · decrypts INSIDE the enclave · runs gpt-oss:20b · re-encrypts · returns a TDX-attested receipt
        │
        ▼
agent  ── reassemble chunks → decrypt() locally.  Plaintext seen only by agent + enclave.
```

- **Privacy** is real and verifiable live: prod returns `teeType: INTEL-TDX-PHALA` + a
  real Intel TDX quote (DCAP `UpToDate`). Reused as-is from SolRouter; only the Solana
  on-chain attestation is dropped. See [docs/adr/0001](docs/adr/0001-temprouter-is-a-blind-relay.md).
- **Payment** is native Tempo/pathUSD via [`mppx`](https://www.npmjs.com/package/mppx)
  session vouchers (~2 on-chain txs per stream). See [docs/adr/0002](docs/adr/0002-attestation-bound-mpp-settlement.md).

## Run it

```bash
npm install
# tdx-live: point at the real enclave (payment still needs a funded testnet key)
TEE_ENDPOINT=https://solrouter-obb4.onrender.com/tee MPP_SECRET_KEY=$(openssl rand -hex 24) npm start
# in another shell — the paying agent (fund AGENT_PRIVATE_KEY first; see below)
SERVER_URL=http://localhost:8402 AGENT_PRIVATE_KEY=0x… npm run agent
```

- **No `TEE_ENDPOINT`** → `mode=stub`: there's no live TDX, so the agent's attestation
  gate correctly **refuses to pay** (this is the demo's "refusal" run).
- Fund a Tempo testnet key: `curl -X POST https://docs.tempo.xyz/api/faucet -d '{"address":"0x…"}'`
  (or `npx mppx account fund --network testnet`).

### Env (`.env.example`)
| var | meaning |
|---|---|
| `TEE_ENDPOINT` | real Phala TDX base (`…/tee`). Unset → stub mode. |
| `MPP_SECRET_KEY` | HMAC secret for challenge binding (not a chain key). |
| `PRICE_PER_UNIT` | pathUSD per response-chunk (default 0.0002). |
| `AGENT_PRIVATE_KEY` | funded Tempo testnet key (agent side). |
| `EXPECTED_MEASUREMENT` | optional strict-pin of `mrtd` (else soft-pin). |

## Endpoints

| | path | |
|---|---|---|
| `POST` | `/v1/chat/completions/stream` | attested private inference, metered per response-chunk (SSE) |
| `GET` | `/tee/attestation` | enclave attestation — **verify before you pay** |
| `GET` | `/openapi.json` | MPP service discovery (`x-service-info` + `x-payment-info`) |
| `GET` | `/llms.txt` | agent-readable context |
| `GET` | `/` | branded landing page (browser) / service JSON (agent) |

Discoverable on **mpp.dev/services** (GitHub PR) + **MPPScan**.

## Status

**✅ Full loop VERIFIED end-to-end on Tempo testnet (2026-06-16):**
`detect secret → pre-pay DCAP verify (real INTEL-TDX-PHALA, UpToDate) → encrypt →
pay pathUSD on-chain (balance moves) → real Phala TDX inference → SSE stream + charge →
decrypt to plaintext answer.`

- ✅ Verifier validated against live prod hardware (DCAP + key-binding + ed25519 + quote-digest).
- ✅ Server boots `mode=tdx-live`; discovery + landing page serve.
- ✅ Attestation-gated payment, real MPP session on Tempo Moderato, real pathUSD spent.
- ✅ Funded testnet wallet (`mppx account temprouter`).

**Open (payment-channel lifecycle polish — see [ADR-0003](docs/adr/0003-per-unit-sse-metering.md)):**
- ⏳ Multi-unit streaming (`CHUNK_COUNT > 1`) breaks on the mid-stream voucher top-up POST; default is `chunkCount=1` (whole response = one charged unit), which completes cleanly.
- ⏳ Cooperative `manager.close()` returns 402 (made non-fatal; deposit reclaims on timeout).

See [`DESIGN.md`](DESIGN.md) for the locked design + 4-day plan, [`CONTEXT.md`](CONTEXT.md)
for the domain glossary, and `docs/adr/` for the load-bearing decisions.
