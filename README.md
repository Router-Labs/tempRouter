# tempRouter

> **Pay an LLM only after you can prove it never saw your prompt.**
> Confidential compute behind Intel TDX, payable per response-chunk on Tempo. No API keys, no trust required. — *MPP Hackathon @ Futura Camp Berlin 2026.*

[![Live](https://img.shields.io/badge/live-temprouter.onrender.com-00ff88)](https://temprouter.onrender.com)
[![GitHub](https://img.shields.io/badge/GitHub-Router--Labs/tempRouter-181717)](https://github.com/Router-Labs/tempRouter)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Live:** https://temprouter.onrender.com · [OpenAPI](https://temprouter.onrender.com/openapi.json) · [Attestation](https://temprouter.onrender.com/tee/attestation) · [Agent Skill](https://temprouter.onrender.com/SKILL.md)

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Integration](#integration)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Discovery](#discovery)
- [Project Structure](#project-structure)
- [Status](#status)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

tempRouter is a **payable confidential compute endpoint**. An agent verifies the computation runs inside a real Intel TDX enclave (Intel DCAP attestation), encrypts its payload to the enclave's hardware-bound key, pays per response-chunk via MPP on Tempo, and decrypts locally.

The relay is **blind** — it forwards ciphertext, meters usage, and holds no key. A failed attestation means **zero vouchers signed** — the client never pays for untrusted hardware. One charge per inference by default.

**Why it exists:** SolRouter runs private AI inference inside Intel TDX enclaves on Solana, gated by API keys. tempRouter removes the API-key friction entirely — making it pay-per-use on Tempo via MPP. No accounts, no provisioning, just pay per chunk in stablecoin.

Not limited to prompts — any sensitive computation that needs verifiable confidentiality: transactions, cryptographic operations, financial data processing.

> **Testnet build.** tempRouter runs on **Tempo Moderato testnet** (chain `42431`), currency **pathUSD** (test funds, no real money). It is a *verified testnet* deployment — see [Status](#status).

## How It Works

```
agent (src/agent.ts)
  0. detectSensitive(prompt)         ── secret/PII? → force the private lane
  1. GET /tee/attestation            ── verifyQuote() : Intel DCAP, fail-closed
  2. encrypt(prompt → enclave key)   ── Arcium RescueCipher + X25519 (@solrouter/sdk)
  3. sessionManager.sse(POST …)      ── MPP session, pay per response-chunk (Tempo Moderato)
        │
        ▼
tempRouter (src/server.ts)  ── BLIND RELAY (holds no key)
  · mppx.session({sse:true}) gates payment per response-chunk (402 → pay → SSE stream)
  · forwards ciphertext → real Phala Intel TDX /process → meters reply chunks (withReceipt)
        │
        ▼
Phala Intel TDX enclave (SolRouter prod, chain-agnostic)
  · decrypts INSIDE the enclave · runs gpt-oss:20b · re-encrypts · returns a TDX-attested receipt
        │
        ▼
agent  ── reassemble chunks → decrypt() locally.  Plaintext seen only by agent + enclave.
```

**The guarantee:**
- Agent runs Intel DCAP on the enclave quote **before** signing any voucher
- A failed gate signs **zero** vouchers — you never pay a host that can't prove it's blind
- A swapped enclave **can't decrypt** the payload (encrypted to the attested key)

**Honest scope:** the payment↔enclave binding ships as an unenforced **label** (`meta.enclaveKey`), not a settlement gate — the real guarantee is verify-before-pay + encryption-to-the-attested-key. Code-measurement pinning is **opt-in** (`EXPECTED_MEASUREMENT`); the default is **soft-pin** ("same enclave the service advertised"), not "trusted reproducible build." See [docs/adr/0001](docs/adr/0001-temprouter-is-a-blind-relay.md) and [docs/adr/0002](docs/adr/0002-attestation-bound-mpp-settlement.md).

## Architecture

📖 **[View architecture diagram (Excalidraw)](docs/architecture.excalidraw)** — editable, opens at [excalidraw.com](https://excalidraw.com)

Three parties, one blind hop:

| Party | Role | Sees plaintext? |
|---|---|---|
| **Agent** (client) | Detects sensitive data, verifies enclave, encrypts, pays, decrypts | ✅ (own data) |
| **tempRouter** (relay) | Blind relay — forwards ciphertext, meters chunks, handles MPP 402 flow | ❌ Never |
| **Phala Intel TDX** (enclave) | Decrypts inside hardware, processes, re-encrypts, signs receipt | ✅ (inside TEE only) |

## Quick Start

```bash
npm install
```

**1. Verify only (free, no payment):**
```bash
npm run cli -- verify
# Fetches live enclave attestation + runs DCAP verification. Costs nothing.
```

**2. Single inference (end-to-end):**
```bash
# Fund a Tempo testnet wallet first (test pathUSD): https://explore.testnet.tempo.xyz
AGENT_PRIVATE_KEY=0x… SERVER_URL=http://localhost:8402 npm run agent
```

**3. Detect sensitivity (client-side, no network):**
```bash
npm run cli -- detect "my password is hunter2 and key is 0xdeadbeef"
# → { sensitive: true, matched: ["password", "private-key"] }
```

**Run the server:**
```bash
TEE_ENDPOINT=https://solrouter-obb4.onrender.com/tee \
MPP_SECRET_KEY=$(openssl rand -hex 24) \
npm start
```

- **No `TEE_ENDPOINT`** → `mode=stub`: there's no live TDX, so the agent's attestation gate correctly **refuses to pay** (the demo's "refusal" run).

## Integration

Four surfaces, same verify-before-pay lane:

| Surface | Install | Use |
|---|---|---|
| **SDK** | `npm install @temprouter/sdk` | `client.infer(prompt)` → `{ answer, units, paid }` |
| **CLI** | `npm run cli --` | `temprouter infer "…"`, `verify`, `detect` |
| **MCP** | stdio server | Tools: `private_inference`, `verify_enclave`, `detect_sensitive` |
| **Skill** | `npx skills add Router-Labs/tempRouter` | Auto-routes sensitive prompts to the private lane |

**SDK example:**
```ts
import { TempRouter, detectSensitive } from '@temprouter/sdk'

const client = new TempRouter({
  serverUrl: 'https://temprouter.onrender.com',
  account: process.env.AGENT_PRIVATE_KEY as `0x${string}`, // funded Tempo testnet wallet
})

if (detectSensitive(prompt).sensitive) {
  const { answer, units, paid } = await client.infer(prompt)
  // verify → encrypt → pay per chunk → decrypt
  // throws AttestationError on a failed gate (zero vouchers signed)
}
```

**MCP config (Claude, etc.):**
```json
{ "command": "npx", "args": ["tsx", "/abs/path/tempRouter/mcp/server.ts"] }
```

## Configuration

Environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Default | Description |
|---|---|---|---|
| `TEE_ENDPOINT` | No | — | Phala TDX base URL (`…/tee`). Unset → stub mode. |
| `MPP_SECRET_KEY` | Yes | — | HMAC secret for challenge binding (not a chain key). |
| `TEMPO_RECIPIENT` | Yes | — | Wallet address receiving pathUSD payments (your earnings address). |
| `TEMPO_RECIPIENT_PRIVATE_KEY` | No | — | Payee key for cooperative channel close. |
| `PRICE_PER_UNIT` | No | `0.0002` | pathUSD per response-chunk. |
| `CHUNK_COUNT` | No | `1` | SSE chunks per inference (metering granularity; one charge per inference at `1`). |
| `AGENT_PRIVATE_KEY` | Agent | — | Funded Tempo testnet wallet key (client side). |
| `EXPECTED_MEASUREMENT` | No | — | Strict-pin of enclave `mrtd` (else soft-pin). |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/chat/completions/stream` | Attested private inference, metered per response-chunk (SSE) |
| `GET` | `/tee/attestation` | Enclave attestation — **verify before you pay** (free) |
| `GET` | `/tee/public-key` | Enclave public key (for client-side encryption) |
| `GET` | `/openapi.json` | MPP service discovery (`x-service-info` + `x-payment-info`) |
| `GET` | `/llms.txt` | Agent-readable context |
| `GET` | `/SKILL.md` | Agent skill entrypoint |
| `GET` | `/health` | Liveness/readiness (mode, uptime) |
| `GET` | `/` | Landing page (browser) / service JSON (agent) |

## Discovery

tempRouter is autonomously discoverable:

- **OpenAPI 3.1** at `/openapi.json` — payment offers, endpoints, schemas
- **llms.txt** at `/llms.txt` — agent-readable context
- **Agent Skill** at `/SKILL.md` — installable via `npx skills add`
- **402 Challenge** — live MPP payment terms on every payable endpoint
- **robots.txt** at `/robots.txt` + **`/.well-known/*` aliases** — crawler/agent surface
- **MPPScan** — register now at https://www.mppscan.com/register
- **tempoxyz/mpp curated registry** — deferred until mainnet (see [DISCOVERY.md](docs/DISCOVERY.md))

## Project Structure

```
tempRouter/
├── src/
│   ├── server.ts            # Hono server — blind relay + mppx payment middleware
│   ├── agent.ts             # Client-side agent (verify → encrypt → pay → decrypt)
│   ├── config.ts            # Config + Tempo testnet chain constants
│   ├── detectSensitive.ts   # Client-side secret/PII detector
│   ├── verifyAttestation.ts # Intel DCAP verification logic
│   └── upstream.ts          # Phala TDX enclave passthrough
├── sdk/                     # @temprouter/sdk — TypeScript SDK
├── cli/                     # CLI tool (infer, verify, detect)
├── mcp/                     # MCP stdio server (Claude, etc.)
├── skills/temprouter/       # Agent skill (SKILL.md)
├── public/
│   ├── index.html           # Landing page
│   ├── llms.txt             # Agent context
│   └── robots.txt           # Crawler rules
├── docs/
│   ├── architecture.excalidraw  # Architecture flow diagram
│   ├── DISCOVERY.md             # MPP catalog listing guide
│   └── adr/                     # Architecture Decision Records
│       ├── 0001-temprouter-is-a-blind-relay.md
│       ├── 0002-attestation-bound-mpp-settlement.md
│       └── 0003-per-unit-sse-metering.md
├── DESIGN.md                # Design spec + 4-day plan
├── CONTEXT.md               # Domain glossary
├── evidence.md              # Verification evidence
├── render.yaml              # Render deployment config
└── .env.example             # Environment template
```

## Status

**✅ Full loop VERIFIED end-to-end on Tempo testnet (2026-06-16):**
`detect secret → pre-pay DCAP verify (real INTEL-TDX-PHALA, UpToDate) → encrypt →
pay pathUSD on-chain (balance moves) → real Phala TDX inference → SSE stream + charge →
decrypt to plaintext answer.`

- ✅ Verifier validated against live prod hardware (DCAP + key-binding + ed25519 + quote-digest)
- ✅ Server boots `mode=tdx-live`; discovery + landing page serve
- ✅ Attestation-gated payment, real MPP session on Tempo Moderato, real pathUSD spent
- ✅ SDK · CLI · MCP · agent skill shipped, all verified end-to-end on testnet
- ✅ Funded testnet wallet (`mppx account temprouter`)

**✅ ADR-0003 closed (2026-06-17) — see [ADR-0003](docs/adr/0003-per-unit-sse-metering.md):**
- ✅ Multi-unit streaming (`CHUNK_COUNT > 1`) supported + verified; **prod bills one charge per inference** (`CHUNK_COUNT=1`). (Fixed a request-classification bug where header-only voucher POSTs were misread as billable content.)
- ✅ Cooperative `manager.close()` settles on-chain as the payee (opt-in via `TEMPO_RECIPIENT_PRIVATE_KEY`).

## Documentation

| Document | Description |
|---|---|
| [DESIGN.md](DESIGN.md) | Locked design spec + 4-day build plan |
| [CONTEXT.md](CONTEXT.md) | Domain glossary (TEE, MPP, DCAP, Tempo) |
| [docs/DISCOVERY.md](docs/DISCOVERY.md) | How to list tempRouter on MPP catalogs |
| [docs/architecture.excalidraw](docs/architecture.excalidraw) | Editable architecture flow diagram |
| [docs/adr/0001](docs/adr/0001-temprouter-is-a-blind-relay.md) | ADR: tempRouter is a blind relay |
| [docs/adr/0002](docs/adr/0002-attestation-bound-mpp-settlement.md) | ADR: Attestation-bound MPP settlement |
| [docs/adr/0003](docs/adr/0003-per-unit-sse-metering.md) | ADR: Per-unit SSE metering |
| [skills/temprouter/SKILL.md](skills/temprouter/SKILL.md) | Agent skill (quick start, errors, cost) |

## Contributing

This is a hackathon project. PRs welcome on the [`Router-Labs/tempRouter`](https://github.com/Router-Labs/tempRouter) repo. See the existing [ADR docs](docs/adr/) for architectural context before contributing.

## License

MIT — see [LICENSE](LICENSE).
