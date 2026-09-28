import test from 'node:test'
import assert from 'node:assert/strict'
import { mainnetGuardErrors } from '../src/mainnetGuard.js'
import { DEV_RECIPIENT, DEV_SECRET_KEY, tempoMainnet, tempoTestnet } from '../src/config.js'

const GOOD_RECIPIENT = '0x1111111111111111111111111111111111111111'
const GOOD_SECRET = 'x'.repeat(40) // ≥24 chars, not a known placeholder

test('testnet never fires the guard — behavior stays byte-for-byte, even on dev defaults', () => {
  const errors = mainnetGuardErrors({ isMainnet: false, recipient: DEV_RECIPIENT, secretKey: DEV_SECRET_KEY })
  assert.deepEqual(errors, [])
})

test('mainnet refuses to boot on the built-in demo recipient', () => {
  const errors = mainnetGuardErrors({ isMainnet: true, recipient: DEV_RECIPIENT, secretKey: GOOD_SECRET })
  assert.ok(errors.some((e) => /demo address/.test(e)), errors.join('; '))
})

test('mainnet refuses to boot on a malformed recipient', () => {
  for (const bad of ['', '0x…', '0xabc']) {
    const errors = mainnetGuardErrors({ isMainnet: true, recipient: bad, secretKey: GOOD_SECRET })
    assert.ok(errors.some((e) => /not a valid address/.test(e)), `${bad}: ${errors.join('; ')}`)
  }
})

test('mainnet refuses to boot on a known/placeholder or too-short MPP_SECRET_KEY', () => {
  for (const bad of [DEV_SECRET_KEY, 'change-me-to-a-long-random-string', 'short']) {
    const errors = mainnetGuardErrors({ isMainnet: true, recipient: GOOD_RECIPIENT, secretKey: bad })
    assert.ok(errors.some((e) => /MPP_SECRET_KEY/.test(e)), `${bad}: ${errors.join('; ')}`)
  }
})

test('mainnet refuses to boot when the payee key address does not match TEMPO_RECIPIENT', () => {
  const errors = mainnetGuardErrors({
    isMainnet: true,
    recipient: GOOD_RECIPIENT,
    secretKey: GOOD_SECRET,
    settlementAddress: '0x2222222222222222222222222222222222222222',
  })
  assert.ok(errors.some((e) => /TEMPO_RECIPIENT_PRIVATE_KEY/.test(e)), errors.join('; '))
})

test('mainnet boots clean with a real recipient + long secret (no payee key)', () => {
  assert.deepEqual(mainnetGuardErrors({ isMainnet: true, recipient: GOOD_RECIPIENT, secretKey: GOOD_SECRET }), [])
})

test('mainnet boots clean when the payee key address matches TEMPO_RECIPIENT', () => {
  const errors = mainnetGuardErrors({
    isMainnet: true,
    recipient: GOOD_RECIPIENT,
    secretKey: GOOD_SECRET,
    settlementAddress: GOOD_RECIPIENT.toUpperCase().replace('0X', '0x'), // case-insensitive match
  })
  assert.deepEqual(errors, [])
})

test('mainnet discovery advertises the real on-chain symbol USDC.e; testnet stays pathUSD', () => {
  assert.equal(tempoMainnet.currencyName, 'USDC.e')
  assert.equal(tempoTestnet.currencyName, 'pathUSD')
})
