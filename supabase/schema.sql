-- ============================================================================
-- Inhouse Clinic System — Supabase schema (Fase 1)
-- Multi-tenant (5 PT), role-based access (dokter / perawat / viewer)
-- Run this once in Supabase SQL Editor on a fresh project.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. COMPANIES (5 PT) + ROLES
-- ----------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

insert into companies (code, name) values
  ('WSL', 'PT Wana Subur Lestari'),
  ('MTI', 'PT Mayangkara Tanaman Industri'),
  ('KMF', 'PT Kubu Mulia Forestry'),
  ('BOS', 'PT Bina Ovivipari Semesta'),
  ('JLA', 'PT Jelai Lestari Abadi');

create type user_role as enum ('dokter', 'perawat', 'viewer');

-- One row per authenticated user (auth.users). Created by the create-user
-- Edge Function (dokter-only) — never insert directly from the client.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'perawat',
  -- NULL = access to all companies. Otherwise restricted to these PT only.
  company_scope uuid[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function fn_current_role()
returns user_role language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function fn_has_company_access(target_company uuid)
returns boolean language sql stable security definer as $$
  select coalesce(
    (select company_scope is null or target_company = any(company_scope)
     from profiles where id = auth.uid()),
    false
  );
$$;

create or replace function fn_is_active_user()
returns boolean language sql stable security definer as $$
  select coalesce((select active from profiles where id = auth.uid()), false);
$$;

-- ----------------------------------------------------------------------------
-- 2. DISEASE DICTIONARY (ICD-10, dikelompokkan per bab standar)
-- ----------------------------------------------------------------------------
create table disease_categories (
  id serial primary key,
  num int not null unique,
  name text not null
);

create table disease_codes (
  id serial primary key,
  code text unique not null,
  category_id int references disease_categories(id),
  description text not null
);

-- ----------------------------------------------------------------------------
-- 3. DRUG MASTER (katalog bersama) + BATCH per PT (FEFO)
-- ----------------------------------------------------------------------------
create table drug_categories (
  id serial primary key,
  code text unique not null,
  name text not null
);

create table drugs (
  id uuid primary key default gen_random_uuid(),
  kode text unique not null,
  nama text not null,
  kategori_id int references drug_categories(id),
  jenis text not null default 'obat' check (jenis in ('obat', 'alkes', 'bhp')),
  satuan text not null default 'pcs',
  stok_minimum int not null default 10,
  created_at timestamptz not null default now()
);

create table drug_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  drug_id uuid not null references drugs(id),
  no_batch text,
  tanggal_terima date not null default current_date,
  qty_diterima numeric not null,
  qty_sisa numeric not null,
  tanggal_expired date,
  harga_beli numeric not null default 0,
  harga_jual numeric not null default 0,
  supplier text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
create index idx_drug_batches_fefo on drug_batches (company_id, drug_id, tanggal_expired asc) where qty_sisa > 0;

create table stock_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  drug_id uuid not null references drugs(id),
  batch_id uuid references drug_batches(id),
  tipe text not null check (tipe in ('masuk', 'keluar', 'penyesuaian')),
  qty numeric not null,
  tanggal date not null default current_date,
  keterangan text,
  visit_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. PATIENTS
-- ----------------------------------------------------------------------------
create type status_pegawai_t as enum ('karyawan_tetap', 'karyawan_kontrak', 'mitra_kerja', 'masyarakat');

create table patients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  no_rm text not null,
  nik text,
  nama text not null,
  jenis_kelamin text not null check (jenis_kelamin in ('L', 'P')),
  tgl_lahir date not null,
  status_pernikahan text,
  alamat text,
  tempat_tinggal text,
  no_hp text,
  jabatan text,
  departemen text,
  status_pegawai status_pegawai_t not null default 'karyawan_tetap',
  nama_pt_mitra text,
  lokasi_kerja text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (company_id, no_rm)
);
create extension if not exists pg_trgm;
create index idx_patients_company on patients(company_id);
create index idx_patients_nama on patients using gin (nama gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 5. QUEUE
-- ----------------------------------------------------------------------------
create table queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  patient_id uuid not null references patients(id),
  tanggal date not null default current_date,
  poli text not null default 'Poli Umum',
  keluhan text,
  status text not null default 'menunggu' check (status in ('menunggu', 'diperiksa', 'selesai')),
  created_at timestamptz not null default now()
);
create index idx_queue_company_tanggal on queue(company_id, tanggal);

-- ----------------------------------------------------------------------------
-- 6. VISITS (SOAP)
-- ----------------------------------------------------------------------------
create table visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  patient_id uuid not null references patients(id),
  queue_id uuid references queue(id),
  tanggal date not null default current_date,
  jenis_kunjungan text not null default 'sakit' check (jenis_kunjungan in ('sakit', 'kecelakaan_kerja', 'kontrol', 'vitamin_mcu')),
  subjective text,
  objective text,
  diagnosa jsonb not null default '[]',
  plan text,
  disposisi text not null default 'rawat_jalan' check (disposisi in ('rawat_jalan', 'rawat_inap', 'observasi', 'rujuk_keluar')),
  lama_observasi_hari int,
  kecelakaan_kerja jsonb,
  biaya_total numeric not null default 0,
  dokter text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
create index idx_visits_company_tanggal on visits(company_id, tanggal);
create index idx_visits_patient on visits(patient_id);

create table visit_obat (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  drug_id uuid not null references drugs(id),
  batch_id uuid references drug_batches(id),
  qty numeric not null,
  harga_satuan numeric not null default 0,
  subtotal numeric not null default 0
);

-- ----------------------------------------------------------------------------
-- 7. REFERRALS / SICK NOTES
-- ----------------------------------------------------------------------------
create table referrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  patient_id uuid not null references patients(id),
  visit_id uuid references visits(id),
  tanggal date not null default current_date,
  faskes_tujuan text not null,
  diagnosa text not null,
  alasan_rujukan text,
  dokter_perujuk text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table sick_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  patient_id uuid not null references patients(id),
  visit_id uuid references visits(id),
  nomor_surat text not null,
  tanggal date not null default current_date,
  diagnosa text,
  tanggal_mulai date not null,
  tanggal_selesai date not null,
  catatan text,
  dokter text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

-- ----------------------------------------------------------------------------
-- 8. ACTIVITY LOG (dokter-only visibility)
-- ----------------------------------------------------------------------------
create table activity_log (
  id bigserial primary key,
  company_id uuid references companies(id),
  user_id uuid references profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create or replace function fn_log_activity(p_company uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql security definer as $$
  insert into activity_log (company_id, user_id, action, entity, entity_id, detail)
  values (p_company, auth.uid(), p_action, p_entity, p_entity_id, p_detail);
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table companies enable row level security;
alter table profiles enable row level security;
alter table disease_categories enable row level security;
alter table disease_codes enable row level security;
alter table drug_categories enable row level security;
alter table drugs enable row level security;
alter table drug_batches enable row level security;
alter table stock_transactions enable row level security;
alter table patients enable row level security;
alter table queue enable row level security;
alter table visits enable row level security;
alter table visit_obat enable row level security;
alter table referrals enable row level security;
alter table sick_notes enable row level security;
alter table activity_log enable row level security;

-- Reference/lookup tables: any authenticated + active user can read.
create policy p_companies_select on companies for select using (fn_is_active_user());
create policy p_disease_cat_select on disease_categories for select using (fn_is_active_user());
create policy p_disease_code_select on disease_codes for select using (fn_is_active_user());
create policy p_drug_cat_select on drug_categories for select using (fn_is_active_user());
create policy p_drugs_select on drugs for select using (fn_is_active_user());
create policy p_drugs_write on drugs for all using (fn_is_active_user() and fn_current_role() in ('dokter','perawat')) with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat'));

-- profiles: everyone can read their own row + colleagues' names (needed for UI);
-- only dokter can update roles/scope; inserts happen only via the Edge Function
-- (service role bypasses RLS).
create policy p_profiles_select on profiles for select using (fn_is_active_user());
create policy p_profiles_update on profiles for update using (fn_current_role() = 'dokter') with check (fn_current_role() = 'dokter');

-- viewer role gets NO policy on the clinical tables below -> default deny.
-- dokter & perawat: full read/write scoped to companies they can access.
create policy p_drug_batches_rw on drug_batches for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

create policy p_stock_tx_rw on stock_transactions for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

create policy p_patients_rw on patients for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

create policy p_queue_rw on queue for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

create policy p_visits_rw on visits for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

create policy p_visit_obat_rw on visit_obat for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and exists (select 1 from visits v where v.id = visit_id and fn_has_company_access(v.company_id)))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and exists (select 1 from visits v where v.id = visit_id and fn_has_company_access(v.company_id)));

create policy p_referrals_rw on referrals for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

create policy p_sick_notes_rw on sick_notes for all
  using (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter','perawat') and fn_has_company_access(company_id));

-- activity_log: dokter-only, read-only from the client (writes go through fn_log_activity).
create policy p_activity_log_select on activity_log for select using (fn_current_role() = 'dokter');

-- ============================================================================
-- DASHBOARD VIEWS (safe for the "viewer" role — aggregate only, no patient PII)
-- ============================================================================
create view v_kpi_kunjungan as
select v.company_id, date_trunc('month', v.tanggal)::date as bulan, count(*) as total_kunjungan
from visits v group by 1, 2;

create view v_top_diseases as
select v.company_id, date_trunc('month', v.tanggal)::date as bulan,
       (d->>'code') as kode, (d->>'desc') as penyakit, count(*) as jumlah
from visits v, jsonb_array_elements(v.diagnosa) d
group by 1, 2, 3, 4;

create view v_top_diseases_departemen as
select v.company_id, date_trunc('month', v.tanggal)::date as bulan, p.departemen,
       (d->>'code') as kode, (d->>'desc') as penyakit, count(*) as jumlah
from visits v
join patients p on p.id = v.patient_id, jsonb_array_elements(v.diagnosa) d
group by 1, 2, 3, 4, 5;

create view v_top_drugs as
select vs.company_id, date_trunc('month', v.tanggal)::date as bulan, dr.nama, sum(vs.qty) as jumlah
from visit_obat vs
join visits v on v.id = vs.visit_id
join drugs dr on dr.id = vs.drug_id
group by 1, 2, 3;

create view v_kpi_sks as
select company_id, date_trunc('month', tanggal)::date as bulan, count(*) as total_sks
from sick_notes group by 1, 2;

create view v_kpi_rujukan as
select company_id, date_trunc('month', tanggal)::date as bulan, count(*) as total_rujukan
from referrals group by 1, 2;

create view v_kpi_kecelakaan_kerja as
select company_id, date_trunc('month', tanggal)::date as bulan,
       kecelakaan_kerja->>'tingkat' as tingkat, count(*) as jumlah
from visits where jenis_kunjungan = 'kecelakaan_kerja' group by 1, 2, 3;

create view v_stock_warnings as
select b.company_id, dr.id as drug_id, dr.nama, dr.satuan, dr.stok_minimum,
       sum(b.qty_sisa) as stok_total,
       min(b.tanggal_expired) filter (where b.qty_sisa > 0) as expired_terdekat
from drug_batches b
join drugs dr on dr.id = b.drug_id
group by 1, 2, 3, 4, 5;

grant select on v_kpi_kunjungan, v_top_diseases, v_top_diseases_departemen, v_top_drugs,
  v_kpi_sks, v_kpi_rujukan, v_kpi_kecelakaan_kerja, v_stock_warnings to authenticated;

-- These views deliberately run with the VIEW OWNER's privileges (Postgres
-- default — do NOT set security_invoker = true here), because "viewer" gets
-- no RLS policy at all on patients/visits/visit_obat/referrals/sick_notes/
-- drug_batches/stock_transactions/queue below. That is what actually
-- enforces "dashboard only, no rekam medis pasien" for that role at the
-- database layer: viewer can only ever read these pre-aggregated counts
-- (company_id + month + disease/drug name + a number), never a row that
-- carries a patient identity or a raw diagnosis tied to one visit. dokter
-- and perawat don't rely on these views — they have full table access via
-- the p_*_rw policies above.

-- ============================================================================
-- REALTIME: broadcast row changes so every open browser/device stays in sync
-- without a manual refresh (dokter/perawat only — the app never opens a
-- realtime channel for the viewer role, and RLS still governs what any
-- change payload is allowed to contain for whoever is listening).
-- ============================================================================
alter publication supabase_realtime add table queue;
alter publication supabase_realtime add table visits;
alter publication supabase_realtime add table drug_batches;
alter publication supabase_realtime add table stock_transactions;
alter publication supabase_realtime add table patients;
alter publication supabase_realtime add table sick_notes;
alter publication supabase_realtime add table referrals;
