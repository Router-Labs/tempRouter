import test from 'node:test'
import assert from 'node:assert/strict'
import { PROOF_SENTINEL, proofPayload } from '../src/proofSentinel.js'

test('the server keeps emitting the pre-rebrand marker', () => {
  assert.equal(PROOF_SENTINEL, '__TEMPROUTER_PROOF__')
})

test('readers accept both the legacy and the rebranded marker', () => {
  assert.equal(proofPayload('__TEMPROUTER_PROOF__{"a":1}'), '{"a":1}')
  assert.equal(proofPayload('__MPPROUTER_PROOF__{"a":1}'), '{"a":1}')
})

test('ordinary cipher frames are not mistaken for receipts', () => {
  assert.equal(proofPayload('{"ciphertext":"…"}'), null)
  assert.equal(proofPayload(''), null)
})
