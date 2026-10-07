/* ============================================================
   SUPABASE CONFIG
   Paste your project credentials here (Supabase Dashboard >
   Project Settings > API). The anon key is safe to embed in
   client code because Row Level Security protects the data.
   Leave both empty to keep running in local-only mode.
   ============================================================ */
window.ASTORIA_SUPABASE = {
  url: "https://txruugumfhnnqimvrmsp.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cnV1Z3VtZmhubnFpbXZybXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDk5NjAsImV4cCI6MjEwNjkyNTk2MH0.R_FIDxygt7f23jPYDFwVk6JqeUDRfJXttnrjB8C4H30"
};

/* Formula PDF import (n8n + OpenAI). Fill both values after importing
   integrations/n8n/formula-ocr.workflow.json - see that folder's README.
   When either value is empty the "Import from PDF" button stays hidden.
   The token is client-visible by design (internal tool; rotate if leaked). */
window.ASTORIA_OCR = {
  webhookUrl: "",   /* e.g. https://<n8n-host>/webhook/astoria/formula-ocr */
  token: ""         /* X-Astoria-Token Header Auth value */
};
