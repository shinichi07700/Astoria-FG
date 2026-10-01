# Formula PDF Import (n8n + OpenAI) — Design

Date: 2026-10-01
Status: Approved. Field set provisional — to be finalized with the RND Formula team; the contract is designed to absorb field changes cheaply.

## Context & goal

R&D formula source documents (docx/doc) are converted to digital PDF by the client. A self-hosted n8n webhook extracts the text layer and an OpenAI model parses it into JSON. The web app opens the existing Formula editor pre-filled with the parsed values for human confirmation; saving goes through the existing audited `Store.saveFormula` path and the existing debounced cloud sync to Supabase.

## Locked decisions

| Decision | Choice |
|---|---|
| n8n hosting | Self-hosted, public HTTPS URL |
| Result transport | Synchronous webhook (JSON in the HTTP response) |
| Parse engine | OpenAI (text model), digital PDFs only |
| Confirmation UX | Pre-filled existing Formula editor modal |
| Deliverables | App-side flow + importable n8n workflow template |
| Supabase impact | None — no new tables, migrations, or storage buckets |

## Field set (provisional)

Mirrors the current `m_formula` shape: `ffs`, `kategori`, `customer`, `bj`, `phMin`, `phMax`, `viscosity`, `stabTk`, `stabTkul`, `stabT50`, `stabTm`, `note`, `lines[{materialName, materialCode, pct, note}]`.

To be finalized with the RND Formula team on 2026-10-01. The contract is tolerant so field changes are cheap:

- Unknown keys in the response are ignored by the app.
- Missing / unreadable keys become `null` (or `""`) plus a `warnings[]` entry — never invented values.
- Adding or removing a captured field requires only editing the n8n prompt (and optionally the app's prefill map).

## Architecture & data flow

```
R&D user (Master Formula page)
   │  selects PDF
   ▼
Browser ──POST multipart──► n8n webhook ──► Extract from File (PDF text)
   │                                              │
   │                                     IF text layer empty ──► error response
   │                                              ▼
   │                                   OpenAI parse (JSON schema prompt)
   │                                              ▼
   │                                   Code node: normalize + warnings
   ▼◄──────────── JSON in HTTP response ──────────┘
Pre-filled Formula editor ──user confirms/corrects──► Store.saveFormula()
                                                          │
                                              audit + debounced sync (existing)
                                                          ▼
                                                      Supabase
```

The confirm step writes through the existing `saveMaster` path, so RBAC, audit trail, and cloud sync are reused unchanged.

## JSON contract

Request:

- `POST https://<n8n-host>/webhook/<path>` — `multipart/form-data`, one binary field `file` (`.pdf`, ≤ 10 MB).
- Header `X-Astoria-Token: <shared token>` (n8n Header Auth credential).

Success response (HTTP 200):

```json
{
  "ok": true,
  "document": { "fileName": "MR03-BN-01.pdf", "pages": 2, "parser": "text" },
  "formula": {
    "ffs": "MR03-BN-01",
    "kategori": "Cream",
    "customer": "Bening Naturals",
    "bj": 1.02,
    "phMin": 5.2,
    "phMax": 5.8,
    "viscosity": "20000 - 30000 cP",
    "stabTk": "Pass",
    "stabTkul": "Pass",
    "stabT50": "Running",
    "stabTm": "-",
    "note": "",
    "lines": [
      { "materialName": "Aqua", "materialCode": "", "pct": 62.5, "note": "" }
    ]
  },
  "warnings": ["BJ not found in document - please fill in"]
}
```

Error response — always HTTP 200 with the `ok` flag so the client parses a single shape:

```json
{ "ok": false, "error": "This looks like a scanned PDF. Please provide a digitally exported PDF." }
```

A document with multiple formula tables: the workflow parses the primary table and appends a warning.

## Mapping rules (browser)

- `ffs`: trimmed. If it already exists in `db.formulas`, the editor opens on the existing record (edit mode) with a prominent amber banner: "Formula X already exists - saving will overwrite its parameters and composition." Changing the code in the editor creates a new record instead.
- `customer`: exact case-insensitive match on `m_customer` names → normalized match → blank + warning.
- `lines[].materialCode`: exact code → exact name (case-insensitive) → normalized name → blank + per-line warning (user picks from the existing dropdown, already filtered to RM-INT / RM-EXT / PREMIX / RM).
- Stability values: matched case-insensitively against the existing enum `- / Running / Pass / Fail`; unrecognized → `-` + warning.
- `pct`: coerced to number; line order preserved; lines with no name dropped.
- On save of an imported draft, an extra `IMPORT` audit row is written (same precedent as the Master F/G CSV import), naming the source file.

## UX

- Toolbar button "Import from PDF" on the Master Formula page, next to "+ New Formula", visible only when `RBAC.canEditMaster("formulas")`.
- File picker accepts `.pdf` only.
- While n8n works: modal spinner with elapsed time ("Parsing with n8n... usually 10-30s"), client abort at 120 s.
- On success: the spinner is replaced by the pre-filled Formula editor with a banner showing file name, parser used, warnings list, and the existing live Sigma-ratio indicator (100% check) so it is visible before saving.
- On failure (network, timeout, `ok:false`, malformed JSON): toast + clear message; manual entry remains the fallback. Re-upload to retry.

## Auth, CORS, limits

- n8n webhook protected with a Header Auth credential (`X-Astoria-Token`). URL and token are configured in `assets/js/supabase-config.js` alongside the Supabase block (`window.ASTORIA_OCR`). Tradeoff: the token is visible to any employee who inspects the page; abuse costs only OpenAI credits. Rotate if leaked.
- n8n webhook "Allowed Origins" set to the app's origin. Opening the app from `file://` breaks cross-origin calls — the app should be served over HTTP(S). Production origin is an open item.
- Limits: `.pdf` only, ≤ 10 MB, client abort 120 s, n8n workflow timeout 120 s.

## n8n workflow template

`integrations/n8n/formula-ocr.workflow.json`, importable:

1. Webhook (POST, Header Auth, respond-when-last-node, CORS origin configured).
2. Extract from File — PDF text.
3. IF text layer yields fewer than 100 characters → Respond with scanned-PDF error.
4. Basic LLM Chain with OpenAI chat model — temperature 0, structured prompt containing the exact JSON schema and the rule "extract exactly as printed, never invent".
5. Code node — normalize (coerce numbers, clamp stability enum, collect warnings, shape response).
6. Respond to Webhook — JSON.

Setup steps documented in the spec and commit: import workflow, attach OpenAI + Header Auth credentials, set origin, copy webhook URL + token into the app config.

## Error handling matrix

| Failure | Behavior |
|---|---|
| Network / DNS / CORS | Toast + modal message; retry by re-upload |
| 120 s timeout | Spinner aborts; "n8n took too long" message |
| `ok:false` from n8n | Modal with the n8n error text |
| Malformed / non-JSON body | "Unexpected response from n8n" message |
| Scanned PDF (no text layer) | n8n error response with guidance |
| Unmatched customer / material | Warning banner + blank field for manual pick |
| Existing FFS code | Edit mode + overwrite banner |

## Testing

- New headless test `tests/ocr-import.test.js` following the existing pattern (Node + `localStorage`/`window` shims, no dependencies): golden vectors for the mapping layer (customer/material matching, stability clamping, malformed payload rejection) with a stubbed `fetch`.
- Manual E2E against the real n8n instance with one sample R&D PDF.
- Existing tests untouched.

## Out of scope (future work)

- Scanned PDFs / vision-model fallback.
- Batch / multi-file processing.
- Auto-creating missing materials or customers.
- Direct n8n → Supabase writes (staging tables).
- Packaging (FPS) document import.

## Deliverables

| File | Status |
|---|---|
| `assets/js/ocr-import.js` | new — fetch, validation, mapping |
| `assets/js/supabase-config.js` | edit — `window.ASTORIA_OCR` block |
| `assets/js/views-master.js` | edit — toolbar button, spinner modal, editor `importInfo` option, IMPORT audit |
| `index.html` | edit — script tag |
| `integrations/n8n/formula-ocr.workflow.json` | new — importable template |
| `tests/ocr-import.test.js` | new — headless mapping tests |

## Open items

- Final field set after the RND Formula meeting (2026-10-01) — adjust n8n prompt and, if needed, the prefill map.
- Production app origin for the n8n CORS setting.
- Client-specific n8n URL + token values (pasted into `supabase-config.js`).
