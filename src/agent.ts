// tempRouter paying agent. Policy gate → pre-pay attestation verify → encrypt →
// pay per response-chunk over an MPP session on Tempo → post-pay receipt → decrypt.
// Fail-closed: a failed attestation gate signs ZERO vouchers (ADR-0002).

import { encrypt, decrypt, packageForTEE } from '@solrouter/sdk'
import { Session } from 'mppx/tempo'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { config } from './config.js'
import { detectSensitive } from './detectSensitive.js'
import { verifyQuote, verifyAttestation, formatReport } from './verifyAttestation.js'

const PROOF_SENTINEL = '__TEMPROUTER_PROOF__'
const MODEL = process.env.MODEL ?? 'nosana:gpt-oss:20b'
// Default demo prompt carries a (fake) leaked credential → forces the private lane.
const PROMPT =
  process.env.PROMPT ??
  'A service leaked this key: sk-proj-1a2b3c4d5e6f7g8h9i0jklmnopqrstuvwx. Assess the blast radius and the exact rotation steps.'

async function main() {
  // 0. Policy gate — runs before any bytes leave the agent (ADR-0001).
  const det = detectSensitive(PROMPT)
  if (det.sensitive) console.log(`🔒 sensitive payload detected (${det.matches.join(', ')}) → forcing attested private lane`)
  else {
    console.log('ℹ️  not sensitive → a normal agent would use a public/frontier model (out of tempRouter scope)')
    return
  }

  // 1–2. PRE-PAY: fetch + verify the enclave quote BEFORE paying.
  const att = await (await fetch(`${config.serverUrl}/tee/attestation`)).json()
  const gate = await verifyQuote(att, { expectedMeasurement: config.expectedMeasurement || undefined })
  console.log('\n── pre-pay attestation gate ──\n' + formatReport(gate))
  if (!gate.ok) {
    console.error('\n⛔ attestation gate FAILED — refusing to pay. Zero vouchers signed.')
    process.exit(1)
  }

  // 3. Encrypt the prompt to the enclave key (via tempRouter blind passthrough).
  const enc = await encrypt(PROMPT, config.serverUrl)
  const encryptedPrompt = packageForTEE(enc)

  // 4. Pay per response-chunk over an MPP session (Tempo Moderato testnet).
  if (!config.agentPrivateKey) {
    console.error('\nAGENT_PRIVATE_KEY not set — fund a Tempo testnet key to run the paid stream (faucet: POST https://docs.tempo.xyz/api/faucet).')
    process.exit(2)
  }
  const account = privateKeyToAccount(config.agentPrivateKey)
  const client = createWalletClient({ account, chain: tempoModerato, transport: http() })
  const manager = Session.Client.sessionManager({ account, client, decimals: 6, maxDeposit: config.maxDeposit })

  const stream = await manager.sse(`${config.serverUrl}/v1/chat/completions/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ encryptedPrompt, model: MODEL }),
  })

  let cipher = ''
  let units = 0
  let proof: any = null
  for await (const frame of stream) {
    if (frame.startsWith(PROOF_SENTINEL)) {
      proof = JSON.parse(frame.slice(PROOF_SENTINEL.length))
      continue
    }
    cipher += frame
    units++
    process.stdout.write(`\r  💸 [units paid: ${units} | ${(units * Number(config.pricePerUnit)).toFixed(4)} pathUSD]`)
  }
  console.log()

  // 5. POST-PAY receipt verify (bonus) + decrypt. Do this BEFORE closing — the
  // data is already paid for and received; channel close is cleanup.
  if (proof) {
    const v = await verifyAttestation({ response: proof, encryptedPrompt, model: MODEL })
    console.log('── post-pay receipt verification ──\n' + formatReport(v))
  }
  const answer = await decrypt(JSON.parse(cipher), enc.ephemeralPrivateKey)
  console.log('\n🔓 decrypted answer (plaintext only ever seen by you + the attested enclave):\n' + answer)

  // 6. Best-effort cooperative close (reclaims unspent deposit). Non-fatal.
  try {
    await manager.close()
    console.log('\nchannel closed.')
  } catch (e: any) {
    console.warn(`\nchannel close failed (non-fatal, funds reclaim on timeout): ${e?.message?.split('\n')[0] ?? e}`)
  }
}

main().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
