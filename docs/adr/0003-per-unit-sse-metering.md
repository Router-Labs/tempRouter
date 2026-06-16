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

## Open (known limitations, not yet solved)

1. **Multi-unit streaming (`CHUNK_COUNT > 1`) breaks on the mid-stream voucher
   top-up.** The client's initial voucher covers ~1 unit; the 2nd `stream.charge()`
   emits `payment-need-voucher`, the client POSTs a voucher/top-up to the same URL,
   and our separate `mppx.session()` invocation for that POST races the original
   stream's reservation (`reserved voucher coverage is no longer available`) /
   `Voucher POST failed 500`. Default is therefore **`chunkCount = 1`** (whole
   response = one charged unit) which completes cleanly. Fixing multi-unit needs the
   need-voucher management POST handled in-band with the live stream (likely adopting
   mppx's hono middleware coordination rather than the raw `withReceipt` form).
2. **Cooperative `manager.close()` returns 402** ("Payment verification failed").
   Made non-fatal client-side (data is already paid for + received; deposit reclaims
   on channel timeout). Root cause likely the same separate-invocation gap as (1).

## Why accept these now

The contribution (attestation-gated payment) and the full pay→infer→decrypt loop are
proven. The open items are payment-channel *lifecycle* polish (multi-tick metering +
clean close), not the core thesis. Recorded so the next session starts from the exact
failure points rather than re-discovering them.
