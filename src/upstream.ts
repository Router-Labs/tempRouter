// The private upstream: the REAL Phala Intel TDX enclave (chain-agnostic over HTTP).
// tempRouter forwards opaque ciphertext to it and meters the response — it is a
// blind relay (ADR-0001). In stub/down mode there is no TDX, so the attestation is
// STUB-NO-TDX and the agent's pre-pay verifyQuote() correctly refuses to pay.

import { config, teeAttestationUrl, teePublicKeyUrl } from './config.js'

export type TeeProcessResult = {
  encryptedResponse: string
  attestation: any
  encryptionProof: any
}

const STUB_ATTESTATION = { teeType: 'STUB-NO-TDX', tdxQuote: null }

/** POST ciphertext to the enclave; returns the re-encrypted blob + per-request proof. */
export async function teeProcess(encryptedPrompt: string, model: string): Promise<TeeProcessResult> {
  if (!config.teeEndpoint) throw new Error('TEE_ENDPOINT not configured (stub mode cannot run real inference)')
  const res = await fetch(`${config.teeEndpoint}/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ encryptedPrompt, model }),
  })
  if (!res.ok) throw new Error(`TEE /process ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const b: any = await res.json()
  return { encryptedResponse: b.encryptedResponse, attestation: b.attestation, encryptionProof: b.encryptionProof }
}

/** GET the enclave attestation (blind passthrough). Returns STUB-NO-TDX when no TEE. */
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
