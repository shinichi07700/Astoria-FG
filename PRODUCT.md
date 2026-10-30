# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: R&D Formula staff ("RND Formula" role) at PT Astoria Prima who create and maintain Master Formula (FFS) records and their material composition. Secondary readers: PPIC and Production (consume formula ratios for BOMs and work orders), QA/QC (stability results), Regulatory (BPOM status gates), Admin (user and audit management). Users sit at office desktops under normal indoor light; the Master Formula list is scanned many times per day and rows are opened into an editor to change values.

## Product Purpose

The F/G Master & BOM Suite is the internal MES that replaced a Google Sheet + Apps Script workflow for PT Astoria Prima, a cosmetic contract manufacturer. It holds the single source of truth for finished-goods masters, formula masters (FFS), packaging masters (FPS), materials, BOMs, and the downstream purchasing/production/logistics documents. Success means R&D and production work from one audited, role-gated dataset instead of spreadsheets, and Finance gets stable codes for Accurate ERP.

## Positioning

One audited master-data spine (FFS / FPS / BOM on a 100% ratio basis) with server-side RBAC and a debounced Supabase sync, covering the client's real 13-step document flow from formula to delivery — a scope a generic inventory tool does not carry.

## Operating Context

Work happens against named paper/electronic forms (Master Formula = form FR-RD-09); R&D formula documents arrive as digitally exported PDFs and are imported through an n8n + OpenAI OCR webhook into a prefilled editor. Stability is tracked as four tests (TK room temp, TKUL refrigerator, T50 oven 50°C, TM sunlight) each in states `- / Running / Pass / Fail`. Composition is expressed as material lines summing to 100%. BPOM registration gates F/G status. Documents (BOM, surat jalan, release) are printed from the app.

## Capabilities and Constraints

Vanilla ES5-style browser JS (IIFE + `window.X`), no build step, one `index.html` with versioned script tags (`?v=` bumped as a set). Supabase backend (project txruugumfhnnqimvrmsp) with RLS generated from `rbac.js`; localStorage cache plus debounced cloud sync; optional-column probes gate newer migrations. Headless Node test suite under `tests/`. Print-faithful document CSS. UI changes ship as a standalone HTML mockup for user approval before app CSS/JS are touched.

## Brand Commitments

PT Astoria Prima identity sampled from astoriaprima.com and the company logo (`assets/img/logo.png`): rose/red accent `#b12024` on a warm near-white ground `#f9f6f6`, white cards, 14px radii. Typography: Adegia Serif/Georgia for page titles, Public Sans for UI, Cascadia Mono for codes and numeric data. The user confirmed this redesign stays in-brand.

## Evidence on Hand

Live app source (`assets/js/*`, `assets/css/app.css`), Supabase migrations 002–016, headless tests, demo seed data, the n8n OCR workflow template, and design specs under `docs/superpowers/`. No customer-facing marketing assets, testimonials, or photography exist; the logo is the only brand raster. Future work must not fabricate product photography or customer claims.

## Product Principles

1. Master data is the single source of truth; BOMs inherit, never duplicate.
2. Every write is audited and role-gated; read-only roles see the same page minus edit affordances.
3. Provisional field sets are tolerated: unknown values become blank + warning, never invented.
4. The screen must serve daily scanning first: density and glanceability outrank decoration.
5. Printed documents and on-screen records must agree.
