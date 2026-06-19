# Making tempRouter Discoverable

tempRouter is live and production-ready. This guide covers how to list it on the
two MPP catalogs so agents and developers can find it.

---

## 1. MPPScan (instant — do this first)

MPPScan is the open registry for MPP-compliant services. Listing here makes
tempRouter immediately discoverable by any MPP-speaking agent.

**Steps:**

1. Go to **https://www.mppscan.com/register**
2. Enter the server URL: `https://temprouter.onrender.com`
3. MPPScan will auto-discover the service via the standard MPP discovery format
   (it reads `/openapi.json` and the `WWW-Authenticate` 402 challenge)
4. Fill in any additional metadata:
   - **Name:** tempRouter
   - **Description:** Payable, end-to-end-encrypted LLM inference on MPP. Verify a real Intel TDX enclave with DCAP, then pay per response-chunk in stablecoin.
   - **Category:** AI / Inference
   - **Tags:** `llm`, `tee`, `tdx`, `private`, `encrypted`, `phala`
5. Submit — the service is listed immediately

**Cost:** Free
**Time:** ~2 minutes

---

## 2. mpp.dev/services (curated — PR required)

The official MPP documentation site maintains a curated service directory at
`mpp.dev/services`. This gives credibility and visibility.

**Steps:**

1. Clone the docs repo:
   ```bash
   git clone https://github.com/quiknode-labs/mpp-dev-official-docs.git
   cd mpp-dev-official-docs
   ```

2. Edit `schemas/services.ts` — add a new entry to the `services` array:
   ```ts
   {
     id: "temprouter",
     name: "tempRouter",
     url: "https://temprouter.onrender.com",
     serviceUrl: "https://temprouter.onrender.com",
     description: "Payable, end-to-end-encrypted LLM inference. Verify a real Intel TDX enclave with DCAP, then pay per response-chunk. The relay is blind — it forwards ciphertext and holds no key.",
     categories: ["ai"],
     integration: "first-party",
     tags: ["llm", "tee", "tdx", "private", "encrypted", "phala", "confidential"],
     docs: {
       homepage: "https://github.com/Router-Labs/tempRouter",
       llmsTxt: "https://temprouter.onrender.com/llms.txt",
     },
     provider: { name: "Router Labs", url: "https://github.com/Router-Labs" },
     realm: MPP_REALM,
     intent: "charge",
     payment: TEMPO_PAYMENT,
     endpoints: [
       { route: "POST /v1/chat/completions/stream", desc: "Payable encrypted inference (MPP 402 → pay → SSE)", amount: "200" },
       { route: "GET /tee/attestation", desc: "Enclave attestation — verify before you pay (free)" },
       { route: "GET /openapi.json", desc: "OpenAPI service discovery" },
       { route: "GET /llms.txt", desc: "Agent-readable context" },
     ],
   }
   ```

3. Validate locally:
   ```bash
   pnpm install
   pnpm check:types
   pnpm build
   ```

4. Open a PR:
   ```bash
   git checkout -b add-temprouter
   git add schemas/services.ts
   git commit -m "feat: add tempRouter to service directory"
   git push origin add-temprouter
   ```

5. Open the PR on GitHub with title: `Add tempRouter — payable confidential inference (Intel TDX + MPP)`

**Notes:**
- They curate for quality and novelty. tempRouter's TEE + MPP angle is genuinely novel.
- The PR may take a few days for review.
- Service must remain live and accepting payments.

**Cost:** Free
**Time:** ~15 minutes (PR) + review time

---

## Already built-in (no action needed)

tempRouter already has automated discovery endpoints that work without any listing:

| Endpoint | URL | Purpose |
|---|---|---|
| OpenAPI | `/openapi.json` | Standard API discovery |
| llms.txt | `/llms.txt` | Agent-readable context |
| SKILL.md | `/SKILL.md` | Agent skill entrypoint |
| 402 Challenge | HTTP response | MPP payment terms (price, method, endpoints) |

Any MPP-speaking agent that hits the URL gets everything it needs to discover,
verify, and pay for inference — no catalog required. The catalogs above just
make it easier to *find*.

---

## Other places to share

- **Twitter/X** — post the live link + a short pitch
- **Hackathon submission** — submit repo + live link to Futura Camp Berlin judges
- **MPP Discord/Telegram** — share in the community channels
- **GitHub topics** — add topics to the repo: `mpp`, `ai-inference`, `tee`, `intel-tdx`, `privacy`, `stablecoins`, `agents`
