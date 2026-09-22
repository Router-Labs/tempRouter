// Central config + Tempo chain constants (sourced from mppx defaults).
// Supports both testnet (Moderato, 42431) and mainnet (Allegro, 4217) via NETWORK env.
import process from 'node:process'
// Native .env loader (Node 20.12+), no dependency. Safe if .env is absent.
try {
  ;(process as any).loadEnvFile?.('.env')
} catch {

export type PrivacyMode = 'tdx-live' | 'stub' | 'down'

export async function resolveMode(timeoutMs = 6000): Promise<PrivacyMode> {
  if (!config.teeEndpoint) return 'stub'
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(teeAttestationUrl, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return 'down'
    // FIXME: replace 'any' with a proper type — auto-chore finding
    const live = att?.teeType === 'INTEL-TDX-PHALA' && att?.tdxQuote != null
    return live ? 'tdx-live' : 'down'
  } catch {
    return 'down'
  }
}
