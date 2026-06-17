# Per-unit SSE metering via manual stream.charge()

**Status:** accepted (2026-06-16)

The blind relay slices the enclave's single re-encrypted ciphertext blob into N
ordered chunks and meters them over an MPP session (SSE). We use the **manual-charge
generator** form (per `mpp.dev/guides/streamed-payments` + mppx's own
`src/middlewares/hono.ts`): the handler returns `async function*(stream){ … await
stream.charge(); yield chunk … }`, where `await stream.charge()` reserves voucher
headroom *before* each yield and waits (emitting `payment-need-voucher`) if exhausted
— rather than blasting all chunks and dropping the socket. Session-management requests
(top-up / voucher / close) hitting the same route are acked with **`result.withReceipt()`
called with NO args** (it returns the ack for management and throws
`MissingReceiptResponseError` for a resource request, which we catch to proceed).

## Verified

Full loop green on Tempo testnet (2026-06-16): detect → pre-pay DCAP verify (real
INTEL-TDX-PHALA, UpToDate) → encrypt → pay pathUSD (on-chain balance moves) → real
Phala TDX inference → SSE stream + charge → **decrypt to plaintext**.

## Resolved (2026-06-17): multi-unit streaming (`CHUNK_COUNT > 1`)

Multi-unit metering now works end-to-end on Tempo testnet — **verified**: the agent's
balance ticks per chunk (`units paid: 1 → 2`, 0.0002 → 0.0004 pathUSD), both chunks
stream, reassemble, and decrypt to plaintext. No `chunkCount` cap.

**The original diagnosis below was WRONG.** It was *not* a "separate `mppx.session()`
races the reservation" problem, and the store was shared all along: `tempo({ store:
Store.memory() })` is built once at module scope, so `Session.session()` runs once and
bakes one `ChannelStore` (cached by `WeakMap` on the Store object) into the method
closure; every per-request `mppx.session({...})(req)` reuses it.

**Real root cause (tempRouter's bug, not mppx's):** the mid-stream voucher POST is
**header-only** (Authorization only, empty body), but `@hono/node-server` hands even an
empty POST a **non-null** body stream. mppx's HTTP-transport `captureRequest`
(`src/server/Transport.ts:141` — `hasBody: request.body !== null`) therefore reports
`hasBody: true`, and `isSessionContentRequest` misclassifies the voucher POST as a
**billable content request**. Because mppx runs `verify` *before* `respond`
(`Mppx.ts:1246` / `1273`), two things break:
- `applyVerifiedHttpAccounting` *charges a unit* on the voucher POST, raising `spent` by
  exactly the headroom the voucher just added → the blocked stream's
  `commitReservedCharges` sees `highestVoucherAmount - spent < amount` and throws
  **"reserved voucher coverage is no longer available."**
- `respond` returns content (undefined) → `withReceipt()` throws
  `MissingReceiptResponseError` → our handler falls through to the resource path and
  `c.req.raw.json()` 500s on the empty body → client sees **"Voucher POST failed 500."**

`CHUNK_COUNT=1` worked only because the single chunk is the prepaid unit, so no voucher
POST is ever sent.

**Fix (`src/server.ts`):** read the request body once and hand `mppx.session()` a
`Request` whose body is `null` when there is no content, so header-only voucher/close
POSTs classify as **management** (clean 204 ack, no spurious charge). Surgical; no mppx
changes.

## Resolved (2026-06-17): cooperative close

`manager.close()` now settles cleanly on-chain — **verified**: `channel closed.` after the
4-unit stream + decrypt, payer (`temprouter` `0x9BD2…`) → payee (`demo-service` `0x44a7…`).

**Cause (distinct from the streaming bug):** the server-side close path
(`handleCloseCredential` → `assertSettlementSender`, `CredentialVerification.ts:652` /
`Settlement.ts:367`) must broadcast the on-chain close tx from an account whose address ==
the channel **payee**, but `tempo({ recipient, ... })` configured an address-only recipient
→ `"no account available"`.

**Fix (`src/server.ts` + `src/config.ts`):** when `TEMPO_RECIPIENT_PRIVATE_KEY` is set, the
server builds a viem account and passes it to `tempo({ account })`, signing the close as the
payee and paying the tx fee from its own pathUSD. Opt-in — unset → close stays best-effort
(deposit reclaims on timeout) and nothing is committed. **NB:** do *not* set `feePayer: true`
— that makes the server sponsor the PAYER's channel-open tx and trips Tempo's sponsor
`maxFeePerGas` policy (`FeePayerValidationError`).

## Status

Both ADR-0003 items (multi-unit metering + cooperative close) are fixed and verified
end-to-end on Tempo testnet against the real Phala Intel TDX enclave. Open + close ≈ 2
on-chain txs; vouchers off-chain.
