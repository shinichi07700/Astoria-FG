-- Migration 016: product_name + variant on m_formula
-- These fields capture the product identity from the R&D formula document.
-- Physical parameters (BJ, pH, viscosity, stability) are filled from a separate form.

alter table public.m_formula add column if not exists product_name text not null default '';
alter table public.m_formula add column if not exists variant      text not null default '';
