# Making tempRouter Discoverable

tempRouter is **live and verified on Tempo Moderato testnet** (chain `42431`, currency
pathUSD). This guide covers how to make it discoverable to MPP-speaking agents and developers.

> **It is a verified *testnet* build — not "production-ready."** That distinction drives the
> whole listing strategy below: list on the surfaces that accept a live testnet service now,
> and defer the surfaces that gate on mainnet/production until tempRouter actually ships mainnet.

---

## TL;DR

| Surface | Action | When |
|---|---|---|
| **Built-in discovery endpoints** | Nothing — already live (`/openapi.json`, `/llms.txt`, `/SKILL.md`, `/robots.txt`, `/.well-known/*`) | ✅ Now |
| **MPPScan** | Browser submit at https://www.mppscan.com/register — it crawls the live `/openapi.json` | ✅ Now |
| **Curated `tempoxyz/mpp` registry** | Open a PR to `schemas/services.ts` | ⏸ **Deferred to mainnet** (see below) |

---

## 1. MPPScan (do this now)

MPPScan is the open explorer/registry for MPP-compliant services. It has **no production
gate** — it crawls whatever the live URL advertises, so a testnet service lists fine.

**Steps:**

1. Go to **https://www.mppscan.com/register**
2. Enter the server URL: `https://temprouter.onrender.com`
3. MPPScan auto-discovers the service by crawling the live **`/openapi.json`** (annotated
   with `x-payment-info.offers[]`, the canonical machine-readable contract) — no manual
   schema entry required. (The `402` / `WWW-Authenticate` challenge is the runtime payment
   flow, not the discovery mechanism.)
4. Confirm any prompted metadata:
   - **Name:** tempRouter
   - **Description:** Payable, end-to-end-encrypted LLM inference on MPP. Verify a real Intel TDX enclave with DCAP, then pay per response-chunk in pathUSD (Tempo Moderato testnet).
   - **Category:** AI / Inference
   - **Tags:** `llm`, `tee`, `tdx`, `private`, `encrypted`, `phala`
5. Submit.

**Cost:** No listing fee documented · **Time:** ~couple min to submit; listing is subject to
MPPScan validation / periodic health-checks, so may not be instant.

---

## 2. Curated `tempoxyz/mpp` registry — DEFERRED until mainnet

The curated MPP service directory is the **[`tempoxyz/mpp`](https://github.com/tempoxyz/mpp)**
repo. Service entries live in **`schemas/services.ts`** as a typed `ServiceDef` array. (A fork
already exists at **`Sarthib7/mpp`** for when this is ready.)

**Why it's held, not opened now:** that registry is **mainnet/production-only by construction**:

- Its `PaymentDefaults` has **no testnet field** — there is no way to mark an entry as testnet.
- **Every existing entry uses mainnet `USDCe`** as the currency.
- tempRouter currently settles in **testnet pathUSD** on chain `42431`.

A PR adding a testnet pathUSD service to a mainnet-USDCe registry would be **declined** — it
doesn't fit the schema or the directory's intent. So the curated listing is **deferred until
tempRouter goes mainnet** (chain `4217`, currency `USDCe`). At that point the `ServiceDef` entry
slots in cleanly.

**When tempRouter ships mainnet, open the PR from the existing fork:**

1. Sync and branch the fork:
   ```bash
   git clone https://github.com/Sarthib7/mpp.git
   cd mpp
   git checkout -b add-temprouter
   ```
2. Add a `ServiceDef` entry to **`schemas/services.ts`** (mainnet USDCe payment defaults).
3. Build/typecheck per that repo's instructions, then open the PR upstream to `tempoxyz/mpp`.

Until then: **MPPScan is the live listing**, and the built-in endpoints below already make
the service self-describing to any agent.

---

## Already built-in (no action needed)

tempRouter ships automated discovery surfaces that work with zero external listing:

| Endpoint | URL | Purpose |
|---|---|---|
| OpenAPI 3.1 | `/openapi.json` | Standard API discovery (`x-service-info` + `x-payment-info`, servers, schemas) |
| llms.txt | `/llms.txt` | Agent-readable context |
| SKILL.md | `/SKILL.md` | Agent skill entrypoint (installable via `npx skills add`) |
| robots.txt | `/robots.txt` | Crawler rules |
| `.well-known` aliases | `/.well-known/llms.txt`, `/.well-known/openapi.json`, `/.well-known/skill.md` | Redirects to the canonical surfaces |
| 402 Challenge | HTTP response | Live MPP Tempo session terms (price, method, endpoints) on every payable route |

Any MPP-speaking agent that hits the base URL gets everything it needs to discover, verify,
and pay — no catalog required. The listings above just make the service easier to *find*.

---

## Discovery validation

Sanity-check the live surfaces:

```bash
curl -s https://temprouter.onrender.com/openapi.json | jq '.["x-payment-info"], .servers'
curl -s https://temprouter.onrender.com/llms.txt | head
curl -sI https://temprouter.onrender.com/v1/chat/completions/stream -X POST   # expect 402
```

Current status:
- ✅ OpenAPI 3.1.0 with `servers`, `x-payment-info`, `x-service-info`
- ✅ Live 402 challenge (MPP Tempo session, testnet pathUSD)
- ✅ `/llms.txt`, `/SKILL.md`, `/robots.txt`, `/.well-known/*` aliases
- ✅ Favicon (inline SVG)
- ⚠️ Generic x402-format validators won't fully validate an MPP-only service — this is expected; MPPScan reads the MPP discovery format directly.

---

## Other places to share

- **Hackathon submission** — submit repo + live link to Futura Camp Berlin judges
- **MPP Discord/Telegram** — share in the community channels
- **GitHub topics** — add `mpp`, `ai-inference`, `tee`, `intel-tdx`, `privacy`, `stablecoins`, `agents`
- **Twitter/X** — post the live link + a short pitch

---

## Optional, future: add x402 support (a second ecosystem)

tempRouter currently speaks **MPP only**. Adding [x402](https://docs.x402.org/) would make it
discoverable by a second ecosystem of agents. This is **not automated and not in scope today** —
it needs an x402 SDK, x402 payment metadata in the OpenAPI spec, additional EVM wallets, and
server changes. Evaluate after the hackathon based on traction.
