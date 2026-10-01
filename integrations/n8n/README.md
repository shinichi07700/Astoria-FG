# Astoria Formula OCR — n8n workflow

Self-hosted n8n workflow that turns a digitally-exported Formula PDF into JSON for the
Master Formula import in the F/G web app. Text extraction only — scanned PDFs are rejected
with a clear message (see "Limitations").

## Requirements

- n8n ≥ 1.44 (Extract from File / PDF) with the LangChain nodes package
  (`@n8n/n8n-nodes-langchain`) installed on the host.
- An OpenAI API key with access to `gpt-4o-mini`.
- A public HTTPS URL for the n8n instance (the browser calls it cross-origin).

## Setup

1. **Import** `formula-ocr.workflow.json` into n8n (Workflows → Import from File).
2. **Header Auth credential** — Credentials → New → "Header Auth", name it
   `Astoria OCR Token`, configure:
   - Header Name: `X-Astoria-Token`
   - Header Value: a long random string (this is your shared token).
   Then open the imported **Webhook** node — its Authentication is preset to
   "Header Auth" — and select the credential you just created. (On import, n8n may
   prompt to map the missing "Astoria OCR Token" credential; assign the one created here.)
3. **OpenAI credential** — on the **OpenAI Chat Model** node, select your OpenAI account
   (model is fixed to `gpt-4o-mini`, temperature 0).
4. **CORS** — the Webhook node ships with `allowedOrigins: "*"`. For production, set it to
   the app's exact origin (e.g. `https://fg.astoria.example`).
5. **Activate** the workflow. The production URL is then
   `https://<your-n8n-host>/webhook/astoria/formula-ocr`.
6. **Configure the app** — in `assets/js/supabase-config.js` fill:
   ```js
   window.ASTORIA_OCR = {
     webhookUrl: "https://<your-n8n-host>/webhook/astoria/formula-ocr",
     token: "<the Header Value from step 2>"
   };
   ```
   The "Import from PDF" button on the Master Formula page appears only when both values are set.

## Test with curl

```bash
curl -X POST "https://<your-n8n-host>/webhook/astoria/formula-ocr" \
  -H "X-Astoria-Token: <token>" \
  -F "file=@sample-formula.pdf"
```

Success: HTTP 200 with `{"ok":true,"document":{...},"formula":{...},"warnings":[...]}`.
Scanned PDF: HTTP 200 with `{"ok":false,"error":"This looks like a scanned PDF ..."}`.
Every response is HTTP 200 — check the `ok` flag, not the status code.

## Changing the captured fields

The RND field set is provisional. Removing a captured field needs a prompt edit only, in the
*Extract Formula (OpenAI)* node. Adding one needs the prompt edit **and** the field added to
the whitelist in the *Normalize Response* code node — fields it does not map are dropped.
Either way **no browser/app change is ever required**: the app ignores unknown keys and fills
missing ones with warnings. The app's prefill map can optionally be updated later if the new
field should prefill something.

## Limitations

- **Digital PDFs only.** The workflow extracts the PDF text layer; there is no vision fallback.
  Ask R&D to export the Word document with "Save as PDF" (not a scan/photo).
- Request limits: `.pdf` only, ≤ 10 MB, 120 s workflow timeout (matches the app's client abort).
- The app must be served over HTTP(S). Opening it as `file://` makes the browser block this
  cross-origin call.
- The `X-Astoria-Token` is embedded in the web app and visible to any signed-in employee.
  Abuse costs only OpenAI credits; rotate the token if it leaks.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App toast "Could not reach the n8n webhook" | instance down / URL typo / CORS | check URL, workflow active, `allowedOrigins` |
| `{"ok":false,"error":"This looks like a scanned PDF ..."}` | PDF has no text layer | re-export digitally |
| `{"ok":false,"error":"Could not read the PDF: ..."}` | corrupt/encrypted PDF | open the PDF, re-export |
| `{"ok":false,"error":"OpenAI did not return valid JSON ..."}` | model drifted from schema | retry; if persistent, tighten the prompt |
