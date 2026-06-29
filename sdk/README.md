# @temprouter/sdk

The Tempo client SDK for **tempRouter** — confidential, attestation-gated, MPP-paid AI
inference in one call.

Your agent pays per response-chunk in **pathUSD** on Tempo — but only after it
cryptographically verifies (Intel DCAP) that inference runs inside a **real Phala Intel
TDX enclave** that can't read the prompt. The relay is blind: it forwards only
ciphertext and holds no key.

The SDK wraps three things so you never hand-roll them:

- **`@solrouter/sdk`** — client-side encryption (Arcium RescueCipher + X25519)
- **`mppx`** — per-response-chunk stablecoin payment over an MPP session on Tempo
- **Intel DCAP** — verify the TDX enclave *before any money moves* (fail-closed)

## Install

```bash
npm i @temprouter/sdk mppx @solrouter/sdk viem
```

## Use

```ts
import { TempRouter, detectSensitive } from '@temprouter/sdk'

const client = new TempRouter({
  serverUrl: 'https://mpp.solrouter.com',
  account: process.env.AGENT_PRIVATE_KEY as `0x${string}`, // funded Tempo testnet wallet
})

const prompt = 'A service leaked this key: sk-proj-… — assess blast radius and rotation steps.'

// Route confidential payloads to the private lane; use a normal model otherwise.
if (detectSensitive(prompt).sensitive) {
  const { answer, units, paid } = await client.infer(prompt, {
    onVerify: (r) => console.log(r.ok ? 'TDX verified ✅' : 'attestation FAILED ⛔'),
    onUnit: (n, usd) => process.stdout.write(`\r💸 ${n} chunks · ${usd} pathUSD`),
  })
  console.log('\n' + answer, `(${units} units, ${paid} pathUSD)`)
}
```

`infer()` does the whole dance: **verify → encrypt → pay per chunk → decrypt**. A failed
attestation throws `AttestationError` and signs **zero** vouchers — you never pay a host
that can't prove it's blind. Plaintext is only ever seen by you and the attested enclave.

## API

| Member | What it does |
|---|---|
| `new TempRouter({ serverUrl, account, maxDeposit?, pricePerUnit?, expectedMeasurement? })` | Construct a client with a payer wallet. |
| `client.infer(prompt, opts?)` → `{ answer, units, paid, attestation }` | Verify → encrypt → pay → decrypt. Throws `AttestationError` on a failed gate. |
| `client.verify()` → `VerifyReport` | Pre-pay attestation gate only. Never pays. |
| `detectSensitive(prompt)` → `{ sensitive, matches[] }` | Client-side secret/PII policy — decide whether to use the private lane. |
| `formatReport(report)` → `string` | Pretty-print a per-check PASS/FAIL transparency report. |

## Honest scope

The private lane runs an OSS model (`gpt-oss:20b`) inside the enclave — use it for
confidential payloads, not as a frontier-model replacement. Verification covers DCAP
cert-chain + key binding + enclave signature; code-measurement pinning is opt-in via
`expectedMeasurement`. Currently Tempo Moderato **testnet** (chain 42431).
