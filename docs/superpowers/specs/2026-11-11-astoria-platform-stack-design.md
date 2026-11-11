# Astoria Platform Stack Design

Date: 2026-11-11
Status: Agreed 2026-11-11 — topology Option B (separate apps) confirmed by user
Scope: Astoria MES (this repo) + upcoming Astoria HR-eval + future Astoria HRIS

## Context

- PT Astoria Prima's MES lives in this repo: zero-dependency vanilla-JS SPA on GitHub Pages, backed by Supabase project `txruugumfhnnqimvrmsp` (Postgres + GoTrue + PostgREST via raw fetch, RLS generated from the RBAC model).
- The PAT HRIS project serves a **different company**. Its stack (Go API + Rust payroll engine + Next.js web + Flutter mobile + Supabase) is the **architectural template only**. PAT and Astoria data must never be merged.
- Astoria HR-eval will be built soon as a **web-only** app; the user is finalizing its role division and department mapping. It will grow into a full Astoria HRIS module set.
- Integration requirement: shared identity and RBAC between MES and HR (same company, same employees). No attendance/payroll data flows are required yet — loose coupling first.

## Agreed decisions

1. **One Supabase project for all of Astoria** — MES, HR-eval, and future HRIS share `txruugumfhnnqimvrmsp`. MES data never moves; HR joins the existing project.
2. **HR-eval owns the employee model.** The MES does NOT create an `employees` table (avoids a double model). HR-eval creates the employee master with department/position/status; MES `profiles` (full_name, role, emp_id, pw_temp) stays as-is for now.
3. **Shared identity is automatic** — both apps use the same GoTrue `auth.users`. No auth changes in the MES.
4. **HR-eval stack (PAT web pattern):** Next.js 16 / React 19 + TypeScript 5 + Tailwind 4, `@supabase/ssr` auth, TanStack Query, zod, react-hook-form. Separate repo; Node hosting (Vercel or self-hosted).
5. **MES frontend React rewrite is deferred.** When it happens: big-bang cutover, vanilla app frozen during the rewrite, no data migration (pure frontend project).
6. **Backend growth path:** frontend talks to Supabase directly with RLS until server-side logic is needed (notifications, scheduled jobs, document generation) → then Go domain packages following the PAT `api/internal/` pattern. Rust only for stateless heavy math (payroll engine ports from PAT when HRIS payroll arrives).
7. **Schema ownership — one owner per schema:**
   - `public` = MES tables + profiles. MES repo owns migrations, numbering continues `019+`.
   - `hr` = HR-eval/HRIS tables (employees master, evaluations, later attendance/payroll). HR repo owns migrations, prefixed `hr_001+`.
   - MES never writes `hr.*`; HR never writes MES tables. `employees` is the canonical person record; `profiles.full_name`/`emp_id` degrade to cached display values over time.
8. **Account lifecycle ownership:** once HRIS exists, HR owns joiner/mover/leaver (resignation → deactivate auth user); MES Admin retains only MES role assignment.
9. **Role mapping alignment:** HR-eval departments should map 1:1 onto the MES's nine departmental roles (RND, Regulatory, Marketing, PPIC, Production, QA, Warehouse, Finance, Purchasing) so department→role default provisioning stays trivial.
10. **Job-runner convention:** small scheduled SQL → Supabase `pg_cron` / Edge Functions; logic-heavy jobs → one shared Go service (covers MES nightly expiry scan, attendance aggregation, payroll runs). Avoid improvising multiple schedulers.
11. **Security posture for the shared project:** default-deny RLS on `hr` schema, column protection on salary fields, minimal `service_role` usage, PITR/daily backups enabled with at least one tested restore.
12. **Practical Supabase setup:** expose the `hr` schema to PostgREST in the project's API settings (off by default).
13. **Environments:** keep the production project clean — use a separate dev/staging Supabase project for HR-eval development and migration dry-runs before applying anything to production.
14. **Additive-only schema evolution:** once mobile clients exist, schema/API changes must stay backward-compatible (add columns/tables; never break existing clients), because installed mobile versions lag web deploys.
15. **Retention & testing:** MES audit retention is **730 days (2 years)** so the BOD can run full audit searches (raised from 365; migration 015's floor superseded by a new migration). HR/payroll retention must follow Indonesian legal requirements when payroll arrives. HR-eval ships with unit + e2e tests from day one; the MES keeps its plain Node test scripts.

## Mobile readiness (future phase)

- A mobile app is just another client of the same Supabase project: same `auth.users` login, same `employees` data, same RLS. **No backend rebuild when mobile arrives** — that is the payoff of the shared-identity decision. Realtime works over Supabase WebSocket channels on mobile too.
- Client choice deferred until needed: **Flutter** (clone the PAT ESS — GPS check-in, camera, barcode plugins already proven) or **React Native** (reuses the React/TS skills from the web apps). Both slot into the same foundation.
- Performance requirements that determine smoothness (discipline, not stack): indexes and pagination on fast-growing tables (attendance records), no N+1 queries, per-screen payloads instead of whole-table fetches.
- Offline: if factory-floor WiFi is spotty, design local cache + sync deliberately for the affected screens — no stack provides this for free.
- Schema changes follow decision 14 (additive-only) because mobile app versions lag behind web releases.

## Future MES adaptation (when HR-eval schema exists)

- One small migration: `profiles.employee_id uuid references hr.employees`, backfilled by matching `emp_id`.
- Optional: Master User page picks from `employees` instead of free-text; department defaults the MES role at provisioning.
- Nothing else changes in the MES until the frontend rewrite phase.

## App topology — decided: Option B (separate apps)

**Chosen (user, 2026-11-11): Option B — separate apps.** HR-eval is its own Next.js app (HRIS modules grow inside it); the MES rewrite later becomes a second, standalone Next.js app.
- Pros: independent repos and release cycles; clean boundaries if teams split later.
- Cons accepted: duplicate shell/auth/nav chrome; MES rewrite remains a full big-bang project; larger maintenance surface for a solo developer.

**Considered alternative: Option A — unified "Astoria Suite" app** (one shell absorbing HR-eval → HRIS → MES modules). Recommended during brainstorming for less duplication and a smaller MES rebuild, but not chosen.

Both options share the identical data layer, service pattern, and phased growth below.

## Phases

1. **Now:** zero changes to the MES repo. It is already platform-compatible.
2. **HR-eval:** new Next.js app; `hr` schema + employees master + role/department mapping; MES untouched; shared identity from day one.
3. **HRIS:** attendance/payroll modules; Go API service and Rust payroll engine added only when needed.
4. **MES rebuild:** React port of MES views as a standalone Next.js app (Option B); vanilla app retired at cutover.

## Non-goals

- No migration of MES tables into a `mes` schema.
- No changes to the MES auth flow or existing RLS (008/013) until the linking phase.
- No Rust backend for MES CRUD — Rust is reserved for stateless compute engines.
- No data sharing or merging with the PAT HRIS project.
- No multi-tenant design now (single company); schema separation keeps a future pivot feasible.

## Longevity assessment (10-year view)

Postgres + open standards (SQL, JWT, TS, Go) are the durable core; frameworks and hosting are replaceable edges. The real long-term risks are operational: tested backups, migration discipline, documentation (bus factor), and budgeting one frontend refresh around year 5–7.
