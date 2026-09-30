-- 011: move composition ownership from BOM to Master Formula / Packaging
-- FFS (m_formula) gains a `lines` array: [{materialCode, pct, note}]
-- FPS (m_packaging) gains a `lines` array: [{materialCode, qty, supportedBy, note}]
-- The BOM builder will inherit composition from linked masters.

alter table public.m_formula add column if not exists lines jsonb not null default '[]';
alter table public.m_packaging add column if not exists lines jsonb not null default '[]';
