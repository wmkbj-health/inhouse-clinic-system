-- ============================================================================
-- Inhouse Clinic System — Migration 002 (Fase 2 refinements)
-- Run this in Supabase SQL Editor AFTER schema.sql + seed_diseases_drugs.sql
-- have already been applied successfully.
-- ============================================================================

-- 1. Fix company abbreviation: Bina Ovivipari Semesta uses "BIOS", not "BOS".
update companies set code = 'BIOS' where code = 'BOS';

-- 2. Drugs: brand/proprietary name alongside the generic name.
alter table drugs add column if not exists nama_paten text;

-- 3. Visits: structured vital signs (drives "Perlu Perhatian" + abnormal-result
--    alerts against standard clinical thresholds, instead of free-text only).
alter table visits add column if not exists vitals jsonb not null default '{}';
-- Shape: { td_sistol, td_diastol, nadi, suhu, rr, gds, spo2 } (numbers, all optional)

-- 4. Chronic-disease flag on patients, used by the dashboard's "Perlu Perhatian"
--    monitoring (periodic-treatment risk) independent of any single visit.
alter table patients add column if not exists riwayat_kronis text[];
-- e.g. {'Diabetes Melitus','Hipertensi','Penyakit Jantung'} — free-form tags,
-- editable from the patient edit form.

-- 5. Medical consent / refusal records, linked to a patient (and optionally a visit).
create table if not exists consent_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  patient_id uuid not null references patients(id),
  visit_id uuid references visits(id),
  tipe text not null check (tipe in ('persetujuan', 'penolakan')),
  tindakan text not null,
  penjelasan_risiko text,
  nama_saksi text,
  nama_petugas text,
  tanggal date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
alter table consent_forms enable row level security;
create policy p_consent_forms_rw on consent_forms for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));
alter publication supabase_realtime add table consent_forms;

-- 6. Drug requisition/order records (permintaan pengadaan obat), printable.
create table if not exists drug_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  nomor_permintaan text not null,
  tanggal date not null default current_date,
  items jsonb not null default '[]',
  -- Shape: [{ drug_id, nama, satuan, stok_saat_ini, jumlah_diminta, keterangan }]
  keterangan text,
  diminta_oleh text,
  disetujui_oleh text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
alter table drug_requests enable row level security;
create policy p_drug_requests_rw on drug_requests for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));
alter publication supabase_realtime add table drug_requests;

-- 7. Signature settings per company (editable name/jabatan shown on printed
--    documents — stocktake, rujukan, SKS, consent forms). One row per company.
create table if not exists print_signatures (
  company_id uuid primary key references companies(id),
  nama_dokter text,
  nama_apoteker text,
  nama_admin_hrd text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
alter table print_signatures enable row level security;
create policy p_print_signatures_rw on print_signatures for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

-- 8. Stock request/reorder nomor helper index (for nomor_permintaan sequencing).
create index if not exists idx_drug_requests_company on drug_requests(company_id, created_at);
