// Same-URL key-pin regression against the REAL @solrouter/sdk (>=1.2.0).
//
// infer() verifies the enclave's attestation doc (which advertises teePublicKey)
// and then encrypts to a key fetched from a DIFFERENT endpoint, /tee/public-key.
// The SDK caches that key per baseUrl in module state. Without the pin, a server
// (or MITM) can pass attestation with the genuine key while /tee/public-key
// serves — or has already cached, for the SAME URL — an attacker key, and the
// prompt is encrypted to the attacker. These tests lock the dependency contract
// the pin relies on, so a future @solrouter/sdk regression fails HERE before a
// dep bump ships it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { encrypt } from '@solrouter/sdk'
// The exact x25519 the SDK encrypts with (its own dependency), so the test keys
// are valid for the real getSharedSecret path.
import { x25519 } from '@arcium-hq/client'

const genuineKey = x25519.getPublicKey(x25519.utils.randomSecretKey())
const attackerKey = x25519.getPublicKey(x25519.utils.randomSecretKey())
const genuineB64 = Buffer.from(genuineKey).toString('base64')
const attackerB64 = Buffer.from(attackerKey).toString('base64')

/** Serve GET /tee/public-key, returning whatever `current.key` holds. */
function keyServer(current: { key: string }): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/tee/public-key')) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ publicKey: current.key }))
      } else {
        res.statusCode = 404
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${addr.port}`, server })
    })
  })
}

test('pinned encrypt() fails closed when /tee/public-key serves a non-attested key', async () => {
  const current = { key: attackerB64 }
  const { url, server } = await keyServer(current)
  try {
    await assert.rejects(
      encrypt('secret prompt', url, true, genuineB64),
      /pinned teePublicKey/,
    )
  } finally {
    server.close()
  }
})

test('same URL: a poisoned key cache never bypasses the pin', async () => {
  const current = { key: attackerB64 }
  const { url, server } = await keyServer(current)
  try {
    // 1. An unpinned call (old behavior) caches the attacker key for this URL.
    const unpinned = await encrypt('warm the cache', url)
    assert.ok(unpinned.ciphertext)
    // 2. A pinned call for the SAME URL must check the pin against the cached
    //    key and refuse — not silently reuse the poisoned cache entry.
    await assert.rejects(
      encrypt('secret prompt', url, true, genuineB64),
      /pinned teePublicKey/,
    )
  } finally {
    server.close()
  }
})

test('pinned encrypt() succeeds when the served key matches the attested key', async () => {
  const current = { key: genuineB64 }
  const { url, server } = await keyServer(current)
  try {
    const enc = await encrypt('secret prompt', url, true, genuineB64)
    assert.ok(enc.ciphertext?.length, 'produced ciphertext')
    assert.ok(enc.publicKey, 'carries the client session public key')
    // And a second pinned call on the same (now warm-cached) URL still passes.
    const enc2 = await encrypt('another prompt', url, true, genuineB64)
    assert.ok(enc2.ciphertext?.length)
  } finally {
    server.close()
  }
})

test('an attestation doc with no advertised key keeps the unpinned behavior', async () => {
  // infer() passes prePay.teePublicKey straight through; when the server
  // advertises none, the pin argument is undefined and encrypt() must accept
  // whatever /tee/public-key serves (pre-1.2 behavior, still fail-open by
  // explicit choice for older enclaves).
  const current = { key: attackerB64 }
  const { url, server } = await keyServer(current)
  try {
    const enc = await encrypt('prompt', url, true, undefined)
    assert.ok(enc.ciphertext?.length)
  } finally {
    server.close()
  }
})
