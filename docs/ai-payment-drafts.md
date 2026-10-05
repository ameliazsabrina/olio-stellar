# Qwen payment-link draft prototype

The Create link dialog can turn a short English or Indonesian request into a
description and USDC amount. A separate preview must be applied to the editable
form; generating a draft never creates a link or sends a payment. Existing
authentication is required. Client names, due dates, OCR, and invoice records
are outside this prototype.

## Run locally

Install Ollama from https://ollama.com, then run:

```sh
ollama serve
# In a second terminal:
ollama pull qwen3:0.6b
```

Add these values to `web/.env.local` and restart Next.js:

```dotenv
OLIO_AI_DRAFTS_ENABLED=true
NEXT_PUBLIC_OLIO_AI_DRAFTS_ENABLED=true
OLIO_AI_OLLAMA_URL=http://127.0.0.1:11434
```

Sign in, open Links → Create link → Draft with AI. Try
"Request 750 USDC for September design work", then review and apply the draft.
The public flag is evaluated at build time for production builds. Both flags
default off. This uses Ollama's packaged Qwen3-0.6B; record the installed model
digest and quantization when comparing results with the original HF weights.

## Data and validation

Only entered text is sent through the authenticated Olio server to the configured
Ollama server. This is server-side inference, not browser-local inference. The
feature does not persist prompts or add prompt logging, and never reads wallet
keys or notes. Operators must separately check infrastructure logging policies.

Non-thinking generation uses a JSON schema, a 45-second timeout, and bounded
input/output lengths. Application validation permits only one explicit USDC
literal matching the model output. Mixed currencies, comma formatting, and
three-decimal ambiguity require manual entry. This deliberately rejects some
valid amounts. It does not prove that the model correctly understood a request;
all fields still need human review. The model cannot choose a recipient or
invoke tools. One inference is allowed per app process at a time; production
would also need shared per-user quotas.

## Verify

```sh
pnpm --filter web test -- test/aiDrafts.test.ts test/AiLinkDraft.test.tsx
pnpm --filter web exec jiti scripts/evaluate-ai-drafts.mjs
```

The live evaluation uses 12 synthetic examples, reports latency and exact final
amount matches, and prints descriptions for manual review. Unit tests use mocked
inference and cannot establish model quality. Before shipping, expand to a
representative held-out set of 100–200 requests and measure description fidelity,
abstentions, critical-field errors, latency, and user corrections.
