# Attestation-bound MPP settlement

**Status:** accepted (2026-06-16)

> **⚠️ Superseded in part — see "Implementation corrections" §1 and §4 below.** The real impl binds the stable `teePublicKeySha256` into `meta` (NOT `sha256(tdxQuote)` into `externalId`), and the server-side settlement gate was **never built** (mppx 0.7.0 has no settlement hook). The original decision text is kept for history; the binding ships as an unenforced *label*.

The server computes `sha256(tdxQuote)` of the live enclave attestation it just fetched and puts that digest in the MPP 402 challenge's `externalId`, which mppx **HMAC-signs with the server `secretKey`**; the server then **refuses to settle any voucher whose bound `externalId` ≠ the live quote digest** (tears down the channel, no `Sse.serve`, zero transfer). This binds *payment to a named, attested enclave* on the MPP rail — the agent verifies the same quote (Intel DCAP) before signing the first voucher, so money moves only against an enclave both sides agree on.

## Why this exists (the contribution)

The reused crypto + TEE stack is chain-agnostic and predates Tempo — so "pay per token for TEE inference" alone is not novel (it's Tempo's own headline demo + a thirdweb x402 template). The **new MPP-rail artifact** is the HMAC-bound attestation commitment in the challenge plus settlement conditioned on it. Without this, "verify before pay" would be a courtesy client-side `if` with no protocol-level enforcement.

## Considered options (rejected)

- **mppx pre-voucher hook for the gate** — rejected: mppx 0.7.0's `sessionManager.sse()` auto-drives (`onChallenge` opens the channel + signs vouchers; `SseDriverOptions` exposes only `onReceipt` + `signal`). There is no pre-voucher interception point. So the client gate is plain control flow (`verifyAttestation()` throws *before* `sessionManager` is constructed), and the *server-side* refusal provides the protocol-level enforcement.
- **Reference the quote out-of-band only** — rejected: two unrelated HTTP calls (`GET /attestation` then pay) leave the payment unbound to the verified quote; an enclave swap between the two would go unnoticed. Binding the digest into the HMAC'd `externalId` closes that seam.

## Consequence

Honest scope: we verify DCAP cert-chain + key-binding + enclave signature + voucher-bound-to-quote. We do **not** pin the code measurement to a published reproducible build by default (soft-pin / opt-in strict via `EXPECTED_MEASUREMENT`) — see `DESIGN.md` §1.

## Implementation corrections (verified against live prod, 2026-06-16)

Four facts discovered while wiring this against the real enclave + mppx 0.7.0:

1. **Bind the stable enclave KEY, not the quote.** The TDX quote bytes change on
   every `/attestation` call (fresh nonce/timestamp), so `sha256(tdxQuote)` is
   unstable across the challenge→pay→retry cycle and breaks credential matching.
   We bind **`teePublicKeySha256`** (the enclave X25519 boot key, which the quote's
   `report_data` attests and the agent verifies pre-pay) — it is constant.
2. **The session intent has no `externalId`** (that is charge-only). We bind via
   **`meta: { enclaveKey }`**, which mppx HMAC-signs into the challenge `opaque`.
3. **The session intent defaults to `chainId` 4217 (mainnet)** even with
   `testnet: true`. We must pass `chainId: 42431` explicitly or every testnet
   voucher is rejected with `CHAIN_MISMATCH`.

4. **The server-side settlement gate was NOT built; the binding is an unenforced
   label.** The decision above describes the server "refusing to settle any voucher
   bound to a different enclave" — that gate does **not** exist: mppx 0.7.0 exposes no
   pre-settlement hook, and the agent never reads the challenge `opaque`/`meta` back to
   compare it against the key it DCAP-verified. So `meta.enclaveKey` is a **label** on
   the session, not an enforced check. The guarantee that actually holds is
   **verify-before-pay** (the agent DCAP-verifies the enclave and signs zero vouchers on
   failure) plus the cryptographic fact that the prompt is encrypted to the enclave's
   key — a swapped enclave cannot decrypt it. A real voucher-refusal check (client-side
   `meta.enclaveKey` vs verified key, and/or a server gate once mppx adds a hook) is the
   documented next step. Read this ADR's title as "attestation-*labelled*," not
   "-bound": the binding ships as a label, not enforcement.
