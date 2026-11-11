# FG SKU 13-Character Codification Replacement — Design

Date: 2026-11-12
Status: approved in chat (sections 1–3), pending written-spec review

## 1. Context & goal

The Master F/G List currently issues Kode FG = `ffs + "-" + fps` (R&D formula code +
packaging spec code), with primary key `ffs + "|" + fps`. The client approved a new
13-character compact scheme (see codification diagram):

```
[Brand 3][App 2][Form 2][Seq 3][Size 1][Rev 2]
BRL-EY-CP-012-A-01  ->  BRLEYCP012A01
```

| Segment | Meaning | Source |
|---|---|---|
| Brand (3 letters) | Brand code, master lookup | new Master Brand |
| App (2 letters) | Application category: EY FC LP SK CL SN BD HC | formula `kategori` mapped |
| Form (2 letters) | Dosage form: LQ CR SS LP CP LS ST | new formula field |
| Seq (3 digits) | Item sequence 001–999 | auto counter |
| Size (1 letter) | Netto size ordinal A = 1st, B = 2nd, … | auto from FPS netto |
| Rev (2 digits) | Packaging revision 01–99 | FPS `revisi` |

Goals: brand-first ERP indexing, typo-proof issuance, 1D-barcode fit, no customer
reverse-engineering of formula/packaging codes.

Non-goals: no downstream module rewrites, no barcode generator (none exists today),
no change to Master Material / Accurate item codes, no ISO document numbers.

## 2. Decisions (user-approved)

1. **Legacy SKUs: re-code all + legacy alias.** Existing rows receive a new 13-char
   `kode_fg`; old code preserved in `legacy_code`; internal ids unchanged.
2. **Separate brand master** (`m_brand`); a customer may own several brands.
3. **Seq & Size auto-assigned** from formula + netto; no manual typing.
4. **Packaging revision = today's revision behavior**: new SKU row, old row
   auto-Discontinue, NA cleared → Pending BPOM.
5. **Approach A — opaque internal id**: new SKUs use the 13-char code as `id`;
   legacy rows keep the pipe id. Downstream FK graph untouched.

## 3. Current-system evidence (audit)

- Code builder: `assets/js/engine.js:61` (`kodeFG`); status evaluator
  `engine.js:71`; recompute on save/boot `assets/js/store.js:97`
  (`refreshDerived`), `store.js:198` (`saveFG`), `store.js:224` (`reviseFG`).
- FG editor (free-text ffs/fps, role locks): `assets/js/views-master.js:302`;
  revision dialog `views-master.js:398`; customer editor `views-master.js:658`;
  the 8 application categories already exist as `FFS_CATS` `views-master.js:884`;
  packaging editor `views-master.js:1451` (revisi deleted at `:1641`).
- Schema: `supabase/schema.sql:47` (`fg_master`, non-unique `kode_fg` index at :62);
  FK graph `supabase/new-project-bootstrap.sql:369–938` (t_sales_order, PR,
  call-off, bulk WO, IPC, pack WO, release, fg_receipt, delivery_order, fg txn;
  receipts/txns/DOs also store denormalized `kode_fg`).
- Sync mappers: `assets/js/sync.js:119–134`; CSV export `store.js:1338`;
  search `views-master.js:253`; SO `kodeBarang` defaults to FG code
  `assets/js/views-so.js:153` (Accurate flow).
- Seeds: `assets/js/seed.js:42–70` (fg builder, 16 rows), BOM `fgId` at :83;
  `assets/js/demo-seed.js` end-to-end sample.

## 4. Data model — migration 020 (additive, idempotent)

```sql
create table public.m_brand (
  id          text primary key check (id ~ '^[A-Z]{3}$'),
  name        text not null default '',
  customer_id text references public.m_customer(id) on delete set null,
  updated_at  timestamptz not null default now()
);
-- touch trigger + RLS staff_all, same pattern as m_customer

alter table public.m_formula   add column if not exists dosage_form text not null default ''
  check (dosage_form in ('','LQ','CR','SS','LP','CP','LS','ST'));
alter table public.m_packaging add column if not exists revisi integer not null default 1
  check (revisi between 1 and 99);

alter table public.fg_master add column if not exists brand_id     text references public.m_brand(id)     on delete restrict;
alter table public.fg_master add column if not exists formula_id   text references public.m_formula(id)   on delete restrict;
alter table public.fg_master add column if not exists packaging_id text references public.m_packaging(id) on delete restrict;
alter table public.fg_master add column if not exists app         text not null default '';
alter table public.fg_master add column if not exists form        text not null default '';
alter table public.fg_master add column if not exists seq         integer not null default 0;
alter table public.fg_master add column if not exists size_letter text not null default '';
alter table public.fg_master add column if not exists netto_ml    numeric not null default 0;
alter table public.fg_master add column if not exists rev         integer not null default 0;
alter table public.fg_master add column if not exists legacy_code text not null default '';
drop index if exists public.fg_master_kode_idx;
create unique index if not exists fg_master_kode_uq on public.fg_master (kode_fg);
```

Constants (in `engine.js`): `APP_MAP` = {Eye Makeup:EY, Face Makeup:FC, Lip Makeup:LP,
Skincare:SK, Cleansers & Makeup Removers:CL, Sun Care:SN, Body Care:BD, Hair Care:HC};
`DOSAGE_FORMS` = [LQ Liquid, CR Cream, SS Semi-Solid, LP Loose Powder, CP Compact
Powder, LS Lipstick, ST Stick].

Rules:
- Segments (`app, form, seq, size_letter, netto_ml, rev`) are **frozen at issue**;
  later master edits never mutate an issued code.
- New rows: `id = kode_fg`. Legacy rows keep `ffs|fps` id until/unless recoded
  (recode never changes id).
- `on delete restrict` protects issued codes from master deletion.

## 5. Code generation & assignment rules

- `Engine.skuCode({brand, app, form, seq, size, rev})` concatenates; validation
  regex `^[A-Z]{3}(EY|FC|LP|SK|CL|SN|BD|HC)(LQ|CR|SS|LP|CP|LS|ST)\d{3}[A-Z]\d{2}$`.
  Old `kodeFG(ffs,fps)` remains only as legacy formatter (crosswalk display).
- **Seq**: reuse the seq of an existing (brand, app, form, formula_id) group;
  else max seq within (brand, app, form) + 1. Overflow > 999 → hard error.
- **Size**: within a seq group, each distinct netto (FPS `volumeMl`, exact numeric
  match) owns a letter; next letter = highest existing letter in group + 1
  (A…Z; overflow → hard error). Same netto reuses its letter.
- **Rev**: linked FPS `revisi`, zero-padded to 2.
- Uniqueness enforced by the unique index + pre-save check.

## 6. F/G editor & workflows

- Editor combos replace free-text inputs: **Brand** (shows brand + customer),
  **Formula** (derives App + Form; save blocked with pointer to formula master if
  `dosage_form` empty), **FPS** (derives netto + rev). Seq/Size read-only in the
  live preview alongside code + status. NA / expiry / discontinue unchanged.
- Field rights (extend `FG_FIELD_RIGHTS`): brand = Marketing, formula link =
  RND Formula, packaging link = RND Kemas, NA/expiry = Regulatory, desc =
  master-data roles (as today).
- **Status evaluator**: presence check becomes
  `(formula_id || ffs) && (packaging_id || fps)` so legacy rows keep their status
  before recode; NA / expiry / discontinue logic byte-identical; nightly expiry
  audit unchanged. `refreshDerived` keeps stored `kode_fg` when segments exist,
  legacy formatter otherwise.
- **Save**: new id = code; uniqueness check; freeze segments; audit CREATE/UPDATE.
- **Formula revision**: same code; swap `formula_id`; new formula's mapped
  app+form must equal the frozen segments (else block); clear NA/expiry →
  Pending BPOM; audit REVISION.
- **Packaging revision**: pick an FPS with same `volumeMl` and `revisi` > old rev
  (different netto = new size variant via normal editor, not a revision); creates
  new SKU row at the new rev; old row auto-Discontinue; NA cleared → Pending BPOM;
  audit REVISION. FPS `revisi` itself is maintained in the FPS editor (1–99).
- List: code column = 13-char code; Formula Code / FPS columns show linked master
  codes (legacy rows fall back to ffs/fps text until recoded); search and CSV
  include `legacy_code` + segments. CSV column order:
  kodeFG, legacy_code, deskripsi, status, brand, app, form, seq, size, netto_ml,
  rev, formula, fps, kodeNA, tglExpire, discontinue, diubahOleh, waktuUpdate.

## 7. Master Brand screen & other master UIs

- New "Master Brand" route in `app.js` NAV beside Master Customer: table
  (code, name, customer) + editor (3-letter code auto-uppercased & unique, name,
  customer combo). RBAC: extend `canEditMaster` registry with `brands` →
  Marketing (+ Admin), same pattern as `customers`.
- Formula Composition panel: Dosage Form select (7 options).
- FPS editor: Revisi number field 1–99 (default 1).
- Master Customer and Master Material: unchanged.

## 8. Recode tool & Finance crosswalk

- One-time admin tool, banner on Master F/G while any row id contains `|`.
  Lists legacy rows; pre-matches formula by old `ffs` text and FPS by old `fps`;
  if no matching master row exists (or the formula lacks `kategori`/`dosage_form`),
  the user must pick an existing master or create it first — the tool links,
  never invents. Dosage form answers are written to the formula master (shared
  by all SKUs using that formula), brand to the FG row. Processes rows in
  `waktuUpdate` ascending; proposes seq/size per §5 with per-row override before
  confirm; previews new code; writes only on explicit user confirm (per row or
  batch): segments + `kode_fg` + `legacy_code = old code`, id unchanged; audit
  RECODE.
- Crosswalk CSV export: legacy_code, new code, deskripsi — for Accurate master
  update in one pass.

## 9. Sync, seeds, downstream, tests

- `sync.js`: extend `fgRow`/`fgFrom`; add brand mappers; `has020` drift-tolerance
  retry (pattern of `has018`) so the app works before migration is applied.
- `seed.js` / `demo-seed.js`: rebuilt under the new scheme (brands, dosage forms,
  FPS revisi, 13-char codes with legacy aliases); BOM `fgId` refs and the
  end-to-end demo test updated.
- Downstream views: **zero edits** (all render via `Store.fgById(...).kodeFG`);
  historical denormalized codes stay old; new SOs default `kodeBarang` to the new
  code. BOM editor gains a save-time warning when its formula/packaging links
  disagree with the FG's links.
- Tests: unit tests for `skuCode` builder/regex, seq/size assignment (incl.
  overflow errors), status-evaluator parity (legacy + new), recode crosswalk;
  existing demo-seed test updated. UI verified via browser structural checks
  (evaluate_script/snapshot), per session convention.

## 10. Rollout order

1. Standalone HTML mockup of FG editor / Master Brand / recode screens → user
   approval (standing rule: mockup before app CSS/JS changes).
2. Apply migration 020 in Supabase SQL Editor.
3. Deploy app (GitHub Pages).
4. Run recode with per-batch user approval.
5. Export crosswalk for Finance.

New SKUs can use the new scheme immediately after step 3, before legacy recode.