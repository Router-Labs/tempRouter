# tempRouter — Hackathon Submission
**MPP Hackathon @ Futura Camp Berlin 2026**

## Elevator Pitch

**tempRouter** — Confidential compute behind Intel TDX, payable per chunk on Tempo. No API keys, no trust required.

## Inspiration

SolRouter runs private AI inference inside Intel TDX enclaves on Solana — gated by API keys. We wanted to remove the API key friction entirely and make it pay-per-use on Tempo: no accounts, no provisioning, just pay per chunk in stablecoin. That meant rebuilding the payment and access layer around MPP, natively on Tempo.

## What it does

tempRouter is a payable confidential compute endpoint. An agent verifies the Intel TDX enclave is genuine (Intel DCAP), encrypts its payload to the enclave's hardware key, pays per response-chunk via MPP on Tempo, and decrypts locally. The relay is blind — it forwards ciphertext, holds no key. Failed attestation = zero vouchers signed.

Not just prompts — any sensitive computation that needs verifiable confidentiality: transactions, cryptographic operations, financial data processing.

## How we built it

Hono + mppx server as a blind relay in front of a Phala Intel TDX enclave (SolRouter production hardware). Payments are native Tempo sessions (pathUSD on Moderato testnet, chain 42431). Client-side encryption via Arcium RescueCipher + X25519. Full Intel DCAP verification (cert chain, TCB status, key binding, ed25519 signatures). Everything — settlement, transactions, payment channels — runs on Tempo. Shipped as SDK, CLI, MCP server, and agent skill with full OpenAPI + llms.txt discovery.

## Challenges we faced

Making it fully Tempo-native was the main battle. Transactions, session settlement, payment channels — all had to work cleanly on Tempo infrastructure. We hit a brutal SSE metering bug where mid-stream voucher POSTs were misclassified as billable content, double-charging the channel and crashing streams. Traced it to `@hono/node-server` passing empty POST bodies as non-null — fixed by normalizing requests before mppx processing. Also solved attestation-binding to payment by using the enclave's stable public key hash as a session metadata label.

## What we learned

Pay-per-use beats API keys for autonomous agents. TEE + Tempo micropayments is a general primitive — not just for prompts, but any sensitive computation that needs verifiable confidentiality. Discovery is half the infrastructure — shipping `openapi.json`, `llms.txt`, and agent skills alongside the API makes the service autonomously discoverable.

## Built with

- **TypeScript** — server, SDK, CLI, MCP server
- **Hono** — HTTP framework / blind relay
- **mppx** — MPP payment middleware (Tempo sessions, SSE metering)
- **Tempo** — stablecoin payment rails (Moderato testnet, pathUSD)
- **Phala Intel TDX** — trusted execution environment
- **Intel DCAP** — attestation verification
- **Arcium** — client-side encryption (RescueCipher + X25519)
- **viem** — Tempo wallet + chain utilities
- **Node.js** — runtime
- **Render** — deployment

## Links

- **Live:** https://temprouter.onrender.com
- **GitHub:** https://github.com/Router-Labs/tempRouter
- **OpenAPI:** https://temprouter.onrender.com/openapi.json
- **Agent Skill:** https://temprouter.onrender.com/SKILL.md
