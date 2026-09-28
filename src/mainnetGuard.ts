// Fail-closed mainnet safety gate. On NETWORK=mainnet the fallbacks that are a harmless
// convenience on testnet become real-money hazards: the demo recipient would collect real
// USDC.e, a public/guessable MPP_SECRET_KEY lets an attacker forge challenge provenance, and
// a payee-key/recipient mismatch makes every cooperative close fail the on-chain payee check
// (silently, per request). This returns the list of fatal reasons; server.ts refuses to boot
// when it is non-empty. On testnet it always returns [] — behavior stays byte-for-byte.
// See defects #1/#3 (recipient), #4 (payee mismatch), and DESIGN mainnet notes.
import { isAddress } from 'viem'
import { DEV_SECRET_KEY, DEV_RECIPIENT } from './config.js'

export type GuardInput = {
  isMainnet: boolean
  recipient: string
  secretKey: string
  /** Address resolved from TEMPO_RECIPIENT_PRIVATE_KEY, when a payee key is set. */
  settlementAddress?: string
}

// Public placeholders that must never guard real money: the code default plus the
// .env.example template value. Also reject anything short enough to brute-force —
// challenge provenance is HMAC-SHA256 over this secret.
const KNOWN_SECRETS = [DEV_SECRET_KEY, 'change-me-to-a-long-random-string']

/** Fatal reasons that must block a mainnet boot. Empty = safe. Testnet always returns []. */
export function mainnetGuardErrors(input: GuardInput): string[] {
  if (!input.isMainnet) return []
  const errors: string[] = []
  const recipient = input.recipient ?? ''

  if (recipient.toLowerCase() === DEV_RECIPIENT.toLowerCase())
    errors.push('TEMPO_RECIPIENT is the built-in demo address — set your own mainnet earnings address')
  else if (!isAddress(recipient, { strict: false }))
    errors.push(`TEMPO_RECIPIENT is not a valid address (${recipient || 'empty'}) — set your mainnet earnings address`)

  if (KNOWN_SECRETS.includes(input.secretKey) || input.secretKey.trim().length < 24)
    errors.push('MPP_SECRET_KEY is a known placeholder or shorter than 24 chars — set a long random secret')

  if (input.settlementAddress && recipient.toLowerCase() !== input.settlementAddress.toLowerCase())
    errors.push('TEMPO_RECIPIENT_PRIVATE_KEY address does not match TEMPO_RECIPIENT — every cooperative close would fail on-chain')

  return errors
}
