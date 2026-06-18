# tempRouter — Context Glossary

> Domain language for tempRouter. Glossary only — no implementation details.
> Built during a grill-with-docs session, 2026-06-16.

## Terms

### tempRouter
A **private inference service** that is **paid via MPP** on Tempo. A Payer
(agent or human) pays in pathUSD stablecoin to receive AI inference. The
service's value proposition is *privacy*; the payment rail is MPP.

### MPP (Machine Payments Protocol)
The payment rail. Stripe + Tempo open standard: HTTP `402 Payment Required` →
the Payer fulfils payment in a TIP-20 stablecoin → retries with an
`Authorization: Payment` credential → `200` + `Payment-Receipt`. Settlement on
Tempo testnet ("Moderato", chain 42431) in stablecoin pathUSD.

### Payer
Whoever pays for inference. Two kinds, both in scope:
- **Agent** — an autonomous program paying programmatically over HTTP/MPP.
- **Human** — a person paying via a wallet / checkout surface.
(Open: which one is the demoed primary surface.)

### Private inference  *(RESOLVED 2026-06-16)*
The core value prop, scoped to exactly what runs live: **server-blind + real
hardware-attested**. The prompt is client-side encrypted (Arcium RescueCipher +
X25519) to a key that exists only inside a real Phala **Intel TDX** enclave;
tempRouter forwards opaque ciphertext and never holds a key → it is a
[[Blind relay]]. The payer can cryptographically verify (Intel DCAP) that the
enclave is genuine hardware before paying. Explicitly NOT claimed: code-measurement
pinning (`mrtd`/`rtmr`) — a different enclave *image* with a valid quote is out of
scope (post-hackathon). Verified live: prod `/tee/attestation` returns
`teeType: INTEL-TDX-PHALA` + a real TDX quote.

### Blind relay
tempRouter's server role: it holds no decryption key and never sees plaintext.
The only cleartext it touches is payment metadata (channel id, vouchers,
`externalId`). It proxies ciphertext to the enclave and meters the response.

### Enclave-key settlement label (`meta.enclaveKey`)
The server attaches the live enclave's stable `teePublicKeySha256` to the MPP 402
challenge `meta`, which mppx HMAC-signs into the challenge `opaque`. This is a
**label** naming the enclave a session is for — **not** an enforced gate: neither
side refuses a voucher on a mismatch (mppx 0.7.0 has no pre-settlement hook). The
guarantee that actually holds is the [[Private inference]] one — the prompt is
encrypted to a key the agent DCAP-verifies before paying — not a voucher binding.

### Unit (billing)  — `unitType: 'response-chunk'`
The MPP billable unit. Because the relay is blind it cannot count plaintext LLM
tokens, so it meters ordered **ciphertext chunks** of the enclave response (one
voucher tick each). This is MPP's server-defined-unit model — NOT a claim that
one unit == one model token.

### Payer  *(RESOLVED 2026-06-16 — agent-only)*
An autonomous **agent** that programmatically refuses to pay until it verifies the
TDX quote (Intel DCAP). The human/browser surface (mppx `charge` + HTML payment
page) is **DROPPED** — out of scope. Rationale: attestation-gated-pay is sharpest
when a program enforces verify-before-pay; the agent story is the crisp
Futura/agent-economy thesis; a human chatbot competes in a crowded consumer space.

### Sensitive payload  *(the "why-private", RESOLVED 2026-06-16)*
The class of input that justifies the private lane: confidential data, PII, and
**secrets/credentials (API keys, tokens, private keys)** that must never reach a
third-party model host. The demo leads with a secret/credential leak scenario —
leaking it is a concrete, visible harm.

### Private lane / model  *(honest constraint)*
The attested TEE path runs an **OSS model (gpt-oss:20b via Nosana), NOT a frontier
model.** So tempRouter is not a drop-in for "always use the best LLM" — it is the
*private lane* you choose for [[Sensitive payload]] work, accepting the model-quality
tradeoff in exchange for provable confidentiality.

### Privacy routing policy  *(RESOLVED 2026-06-16 — agent-side detector)*
A client-side **secret/PII detector** in the agent scans its own outgoing prompt
(regex/entropy: API keys, private keys, JWTs, emails, …). A hit **forces** the
attested private lane (encrypt → verify → pay via MPP); no hit → the agent may use
any public/frontier model. The detector MUST live agent-side: tempRouter is a
[[Blind relay]] and only sees ciphertext, so it cannot classify the prompt. The
policy is the *payer's* (transparent, runs before any bytes leave the agent).

### Full transparency / verifiability  *(design principle, set 2026-06-16)*
Nothing about the privacy claim is taken on trust — the paying agent can
independently verify *every* check. The verifier exposes all raw attestation
fields (DCAP result, `report_data`, key binding, enclave ed25519 signature,
`tdxQuote` digest vs the challenge `externalId`, and the enclave's `mrtd`/`rtmr`
measurements) and prints a per-check PASS/FAIL report. Measurement handling:
**soft-pin** — the agent compares the paid quote's `mrtd`/`rtmr` to the value the
`/attestation` endpoint advertised at boot (catches a mid-session enclave swap) and
**displays** them; an optional `EXPECTED_MEASUREMENT` env enables **strict-pin**
(reject if ≠ a published constant). Honestly labelled: soft-pin proves
"same enclave the service advertised," NOT "a trusted reproducible build" unless
strict-pin is configured. See [[Private inference]].

### Service discovery (mpp.dev/services)
tempRouter must be **discoverable** as an MPP service. It serves an MPP/OpenAPI
discovery document so agents and the mpp.dev directory can find and understand the
paid endpoint + its price/unit/recipient. (Exact listing mechanism under research.)
