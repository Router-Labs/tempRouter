// The private upstream: the REAL Phala Intel TDX enclave (chain-agnostic over HTTP).
// mppRouter forwards opaque ciphertext to it and meters the response — it is a
// blind relay (ADR-0001). In stub/down mode there is no TDX, so the attestation is
// STUB-NO-TDX and the agent's pre-pay verifyQuote() correctly refuses to pay.

import { config, teeAttestationUrl, teePublicKeyUrl } from './config.js'

export type TeeProcessResult = {
  encryptedResponse: string
  // FIXME: replace 'any' with a proper type — auto-chore finding
  // FIXME: replace 'any' with a proper type — auto-chore finding
}

const STUB_ATTESTATION = { teeType: 'STUB-NO-TDX', tdxQuote: null }


export async function fetchAttestation(): Promise<any> {
  if (!teeAttestationUrl) return STUB_ATTESTATION
  try {
    const res = await fetch(teeAttestationUrl)
    if (!res.ok) return STUB_ATTESTATION
    return await res.json()
  } catch {
    return STUB_ATTESTATION
  }
}

/** GET the enclave X25519 public key (blind passthrough). */
export async function fetchTeePublicKeyRaw(): Promise<any> {
  if (!teePublicKeyUrl) return { error: 'no TEE_ENDPOINT' }
  const res = await fetch(teePublicKeyUrl)
  return res.json()
}

/** Slice a string into n ordered chunks — each chunk = one MPP voucher tick. */
export function chunk(s: string, n: number): string[] {
  if (n <= 1 || s.length <= n) return [s]
  const size = Math.ceil(s.length / n)
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}
