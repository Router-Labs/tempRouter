// Final SSE frame carrying the post-pay receipt. The wire marker is frozen at the
// original `__TEMPROUTER_PROOF__` so SDKs released before the mppRouter rebrand
// keep parsing receipts; readers also accept the rebranded marker.
export const PROOF_SENTINEL = '__TEMPROUTER_PROOF__'
const ACCEPTED = [PROOF_SENTINEL, '__MPPROUTER_PROOF__'] as const

/** The receipt JSON text if `frame` is a proof frame, otherwise null. */
export function proofPayload(frame: string): string | null {
  for (const marker of ACCEPTED) if (frame.startsWith(marker)) return frame.slice(marker.length)
  return null
}
