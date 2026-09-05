-- ============================================================================
-- Inhouse Clinic System — Migration 003
-- Run this in Supabase SQL Editor AFTER schema.sql + seed_diseases_drugs.sql +
-- migration_002.sql have already been applied successfully.
-- Safe to run even if you are not 100% sure migration_002 ran — every
-- statement below is idempotent (if not exists / if exists guards).
-- ============================================================================

-- 1. Print signatures: replace the fixed 3-name shape with a fully dynamic
--    list of {label, nama} rows, so the number/labels/names of signature
--    columns on every printed document are user-editable per PT.
alter table print_signatures add column if not exists signatures jsonb not null default '[]';
-- Shape: [{ "label": "Dokter Pemeriksa", "nama": "dr. Contoh" }, ...] — any length.
-- The old nama_dokter/nama_apoteker/nama_admin_hrd columns are kept only so
-- existing data migrates automatically (read once, then superseded); no
-- action needed on them.

-- 2. Drug receipt history: "riwayat penerimaan obat" — every time stock is
--    received, log the quantity and who received/handed it over, independent
--    of the FEFO batch bookkeeping in drug_batches.
create table if not exists drug_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  drug_id uuid not null references drugs(id),
  batch_id uuid references drug_batches(id),
  tanggal date not null default current_date,
  jumlah numeric not null check (jumlah > 0),
  nama_penerima text not null,
  sumber text,
  keterangan text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
alter table drug_receipts enable row level security;
create policy p_drug_receipts_rw on drug_receipts for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));
create index if not exists idx_drug_receipts_company on drug_receipts(company_id, tanggal desc);
create index if not exists idx_drug_receipts_drug on drug_receipts(drug_id, tanggal desc);
alter publication supabase_realtime add table drug_receipts;
