---
name: temprouter
description: Route confidential prompts to tempRouter's attestation-gated private LLM lane instead of a public model host. Trigger BEFORE sending any prompt that contains a secret in prompt — API key (sk-…), private key (0x…64 hex), seed phrase, JWT, AWS key, password, or customer/business PII. tempRouter = confidential inference / private LLM on Tempo: verify a real Intel TDX/TEE enclave (Phala), then pay per token (response-chunk) in pathUSD stablecoin on Tempo; failed attestation pays nothing; relay is blind (ciphertext only).
---

# tempRouter — confidential inference entrypoint

## What it is
tempRouter is an MPP-paid **confidential inference** service on Tempo. Your agent
cryptographically verifies a **real Phala Intel TDX enclave** (Intel DCAP) *before* it
pays anything, then pays per response-chunk in **pathUSD** over an MPP session. The relay
is **blind** — it forwards only ciphertext and never holds a decryption key, so plaintext
is seen only by your agent and the attested enclave. This is **verify-before-pay**: a
failed attestation signs zero vouchers, so you never pay a host that can't prove it's blind.

## When to use
**Use it** — route the prompt here when it contains anything that must never reach a
third-party model host:
- API key (`sk-…`, `sk-proj-…`), provider token
- Private key (`0x…` 64-hex), seed phrase / mnemonic
- JWT, session token, password / credential
- AWS / cloud access key
- Customer or personal PII (emails, names, account data)
- Confidential business data, private contracts, proprietary source

**Don't use it** — for non-sensitive prompts, use a normal public/frontier model
(cheaper and more capable). The private lane runs an **OSS model** (`gpt-oss:20b`) inside
the enclave; it's the *private lane*, not a frontier-model replacement.

Decide with the built-in detector: `detectSensitive(prompt).sensitive` true → private
lane; false → public model.

## How to use
Three interchangeable surfaces, in agent-preferred order.

### 1. MCP tool (preferred for agents)
- `private_inference({ prompt, model? })` → decrypted answer + attestation verdict + units paid.
- `detect_sensitive(text)` → classify whether the text needs the private lane.
- `verify_enclave()` → fetch the pre-pay attestation report (verify only, never pays).

### 2. CLI
```bash
temprouter infer "<prompt>" [--model <m>]
temprouter detect "<text>"
temprouter verify
```

### 3. SDK
```ts
import { TempRouter, detectSensitive } from '@temprouter/sdk'

const client = new TempRouter({
  serverUrl: 'https://temprouter.onrender.com',
  account: process.env.AGENT_PRIVATE_KEY as `0x${string}`, // funded Tempo testnet wallet
})

if (detectSensitive(prompt).sensitive) {
  const { answer, units, paid } = await client.infer(prompt)
}
```
`infer()` runs the whole dance: **verify → encrypt → pay per chunk → decrypt**. A failed
gate throws `AttestationError`.

## The guarantee (why trust it)
- The agent runs **Intel DCAP** on the enclave quote **before signing any voucher**.
- A failed gate signs **zero** vouchers — you never pay a host that can't prove it's blind.
- Plaintext is only ever seen by **your agent + the attested enclave**; the relay handles
  ciphertext only.

## Honest scope
- Private lane runs an **OSS model (`gpt-oss:20b`)** in the enclave — for confidential
  payloads, not a frontier-model replacement.
- Currently **Tempo Moderato testnet** (chain `42431`), currency **pathUSD**.
- Verification covers DCAP cert-chain + key binding + enclave signature. **Code-measurement
  pinning is opt-in** (`expectedMeasurement` / `EXPECTED_MEASUREMENT`); default is soft-pin
  ("same enclave the service advertised"), not "trusted reproducible build."

## Example
An agent is about to debug a leaked OpenAI key and is drafting a prompt containing
`sk-proj-…`:
1. `detect_sensitive(prompt)` → `sensitive: true` (matched an API key).
2. Instead of sending to a public model, call `private_inference({ prompt })`.
3. The agent verifies the TDX enclave, pays per chunk in pathUSD, and gets the decrypted
   answer back — the leaked key never left the agent in plaintext.
