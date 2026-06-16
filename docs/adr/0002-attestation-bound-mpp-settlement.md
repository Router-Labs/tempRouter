# Attestation-bound MPP settlement

**Status:** accepted (2026-06-16)

The server computes `sha256(tdxQuote)` of the live enclave attestation it just fetched and puts that digest in the MPP 402 challenge's `externalId`, which mppx **HMAC-signs with the server `secretKey`**; the server then **refuses to settle any voucher whose bound `externalId` ≠ the live quote digest** (tears down the channel, no `Sse.serve`, zero transfer). This binds *payment to a named, attested enclave* on the MPP rail — the agent verifies the same quote (Intel DCAP) before signing the first voucher, so money moves only against an enclave both sides agree on.

## Why this exists (the contribution)

The reused crypto + TEE stack is chain-agnostic and predates Tempo — so "pay per token for TEE inference" alone is not novel (it's Tempo's own headline demo + a thirdweb x402 template). The **new MPP-rail artifact** is the HMAC-bound attestation commitment in the challenge plus settlement conditioned on it. Without this, "verify before pay" would be a courtesy client-side `if` with no protocol-level enforcement.

## Considered options (rejected)

- **mppx pre-voucher hook for the gate** — rejected: mppx 0.7.0's `sessionManager.sse()` auto-drives (`onChallenge` opens the channel + signs vouchers; `SseDriverOptions` exposes only `onReceipt` + `signal`). There is no pre-voucher interception point. So the client gate is plain control flow (`verifyAttestation()` throws *before* `sessionManager` is constructed), and the *server-side* refusal provides the protocol-level enforcement.
- **Reference the quote out-of-band only** — rejected: two unrelated HTTP calls (`GET /attestation` then pay) leave the payment unbound to the verified quote; an enclave swap between the two would go unnoticed. Binding the digest into the HMAC'd `externalId` closes that seam.

## Consequence

Honest scope: we verify DCAP cert-chain + key-binding + enclave signature + voucher-bound-to-quote. We do **not** pin the code measurement to a published reproducible build by default (soft-pin / opt-in strict via `EXPECTED_MEASUREMENT`) — see `DESIGN.md` §1.

## Implementation corrections (verified against live prod, 2026-06-16)

Three facts discovered while wiring this against the real enclave + mppx 0.7.0:

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
