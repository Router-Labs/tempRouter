# tempRouter is a blind relay

**Status:** accepted (2026-06-16)

tempRouter sits in front of inference but **never holds a decryption key and never sees plaintext** — prompts are client-side encrypted (Arcium RescueCipher + X25519, via `@solrouter/sdk`) to a key that exists only inside the real Phala Intel TDX enclave, and tempRouter only forwards opaque ciphertext and meters the response. The only cleartext it touches is payment metadata (channel id, vouchers, `externalId`). We chose this over a server that decrypts-then-routes because it makes the privacy claim *architectural* ("we can't read your prompt") rather than a promise, and lets us reuse the already-in-prod SolRouter encryption + TEE unchanged.

## Consequences (non-obvious, downstream)

These three later decisions are **forced** by blindness, not independent choices — a future reader who tries to "simplify" any of them will reintroduce a plaintext-at-the-server hole:

1. **Billing unit = `response-chunk`, not `token`.** A blind relay cannot count plaintext LLM tokens, so it meters ordered ciphertext chunks of the response (one MPP voucher tick each). This is MPP's server-defined-unit model — see [[Unit (billing)]]. We do **not** claim one unit == one model token.
2. **The privacy-routing policy must live client-side.** The agent runs the secret/PII detector; tempRouter cannot classify a prompt it cannot read. See ADR-0002's sibling and `CONTEXT.md` → Privacy routing policy.
3. **Verification is the payer's job.** Confidentiality is proven by the agent verifying the TDX attestation (DCAP), not by trusting the relay.

## Rejected alternative

Server-side decrypt + smart-route (what a non-private gateway would do) — rejected: it would let the paid server read prompts, collapsing the entire value proposition, and a server-side sensitivity classifier would *require* exactly that plaintext access.
