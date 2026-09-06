-- ============================================================================
-- Migration 004: standardized obat/alkes/BHP categories (Formularium
-- Nasional Kemenkes RI + kaidah kefarmasian umum), expiry write-off
-- (Berita Acara Kadaluwarsa) support, and two dashboard views used for the
-- management-facing printed report (jenis kasus pasien & disposisi
-- breakdown per bulan).
--
-- Purely additive: no existing drug_categories row is renamed or removed, so
-- every drug already pointing at an old category (AB, AG, AH, ...) keeps
-- working unchanged. Run this once against your Supabase project's SQL
-- Editor (same way as schema.sql / migration_002.sql / migration_003.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Obat categories, aligned to Formularium Nasional Kemenkes RI class names
-- (kept to the classes relevant to a first-aid/occupational-health clinic —
-- the full FORNAS list also covers hospital-only classes like anestesi
-- umum, imunosupresan, or oksitosik yang tidak relevan di klinik ini).
-- ---------------------------------------------------------------------------
insert into drug_categories (code, name) values
  ('ANLG', 'Analgesik, Antipiretik, Antiinflamasi Nonsteroid, Antipirai'),
  ('ANTB', 'Antibakteri'),
  ('ANTJ', 'Antijamur'),
  ('ANTV', 'Antivirus'),
  ('ANTP', 'Antiparasit (Antimalaria, Antihelmintik, dll)'),
  ('ALRG', 'Antialergi dan Antianafilaksis'),
  ('EPIL', 'Antiepilepsi - Antikonvulsi'),
  ('GIT', 'Obat Saluran Cerna (Antasida, Antiulkus, Antiemetik, Laksatif, Antidiare)'),
  ('KV', 'Kardiovaskular (Antihipertensi, Antiangina, Antiaritmia)'),
  ('DIUR', 'Diuretik'),
  ('DRH', 'Obat yang Memengaruhi Darah (Antianemia, Hemostatik, Antikoagulan)'),
  ('HORM', 'Hormon, Endokrin, dan Antidiabetes'),
  ('KORT', 'Kortikosteroid'),
  ('NAPS', 'Saluran Napas (Antiasma, Bronkodilator, Antitusif, Mukolitik)'),
  ('THT', 'Obat Telinga, Hidung, dan Tenggorokan'),
  ('MATA', 'Obat Mata'),
  ('KULIT', 'Obat Kulit / Dermatologikal (Topikal)'),
  ('PSIK', 'Psikofarmaka (Ansiolitik, Antidepresan)'),
  ('SSP', 'Sistem Saraf Pusat Lainnya (Antimigren, Antiparkinson, Antivertigo)'),
  ('OTOT', 'Obat Otot dan Tulang (Muscle Relaxant, Antiinflamasi Topikal)'),
  ('GIGI', 'Obat Gigi dan Mulut'),
  ('ELEK', 'Larutan Elektrolit, Cairan Infus, dan Nutrisi'),
  ('VIT', 'Vitamin dan Mineral'),
  ('ANTD', 'Antidotum dan Obat untuk Keracunan')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Alat Kesehatan (Alkes), grouped by clinical function — this is how a
-- klinik/apotek practically organizes an alkes inventory day-to-day; formal
-- Kemenkes/BPOM alkes classification (Kelas A/B/C/D per Permenkes 62/2017)
-- is a regulatory risk grading for market authorization, not a shelving/
-- stock-taking scheme, so it isn't useful as an inventory category here.
-- ---------------------------------------------------------------------------
insert into drug_categories (code, name) values
  ('DIAG', 'Alkes Diagnostik (tensimeter, termometer, stetoskop, dll)'),
  ('BEDAH', 'Alkes Tindakan / Bedah Minor (instrumen, jarum jahit, dll)'),
  ('EMERG', 'Alkes Emergency & Resusitasi (AED, tabung oksigen, ambu bag)'),
  ('IMOB', 'Alkes Imobilisasi & Rehabilitasi (bidai, kruk, collar neck)'),
  ('STERIL', 'Alkes Sterilisasi & Perawatan Alat'),
  ('LAB', 'Alkes Laboratorium Sederhana (GDS/kolesterol/asam urat, dll)')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Bahan Habis Pakai (BHP), grouped by usage — mirrors how BHP is tracked in
-- clinic stock-opname practice (luka, injeksi, APD, dll).
-- ---------------------------------------------------------------------------
insert into drug_categories (code, name) values
  ('LUKA', 'BHP Perawatan Luka (kasa, perban, plester, kapas)'),
  ('APD', 'BHP Alat Pelindung Diri (masker, sarung tangan, apron)'),
  ('INJEK', 'BHP Injeksi & Infus (spuit, jarum, infus set, abocath)'),
  ('LABHP', 'BHP Laboratorium (kapas alkohol, lancet, tabung sampel)'),
  ('STERBHP', 'BHP Sterilisasi & Kebersihan (alkohol swab, disinfektan)'),
  ('LAINBHP', 'BHP Lainnya')
on conflict (code) do nothing;

-- Widen stock_transactions.tipe so an expiry write-off gets its own explicit
-- transaction type instead of being recorded as an ordinary 'keluar'
-- (pemakaian pasien) — keeps stocktake/usage reports from conflating stock
-- lost to expiry with stock actually dispensed to a patient.
alter table stock_transactions drop constraint if exists stock_transactions_tipe_check;
alter table stock_transactions add constraint stock_transactions_tipe_check
  check (tipe in ('masuk', 'keluar', 'penyesuaian', 'kadaluarsa'));

-- ============================================================================
-- Berita Acara Kadaluwarsa (Obat/Alkes) — a formal write-off document for
-- expired stock: one document per event, itemized lines that each reduce
-- the matching drug_batches.qty_sisa and log a 'kadaluarsa' stock_transaction
-- (so Apotek's stock and the transaction history/stocktake stay consistent —
-- no manual "koreksi stok" side-channel needed, and every write-off stays
-- traceable back to its Berita Acara).
-- ============================================================================
create table if not exists expiry_writeoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  nomor_berita_acara text not null,
  tanggal date not null default current_date,
  jenis text not null default 'obat' check (jenis in ('obat', 'alkes', 'bhp')),
  keterangan text,
  dibuat_oleh text,
  disaksikan_oleh text,
  dimusnahkan_oleh text,
  created_at timestamptz not null default now(),
  unique (company_id, nomor_berita_acara)
);

create table if not exists expiry_writeoff_items (
  id uuid primary key default gen_random_uuid(),
  writeoff_id uuid not null references expiry_writeoffs(id) on delete cascade,
  drug_id uuid not null references drugs(id),
  batch_id uuid references drug_batches(id),
  no_batch text,
  qty numeric not null check (qty > 0),
  satuan text,
  tanggal_expired date,
  harga_satuan numeric default 0,
  created_at timestamptz not null default now()
);

alter table expiry_writeoffs enable row level security;
alter table expiry_writeoff_items enable row level security;

drop policy if exists p_expiry_writeoffs_select on expiry_writeoffs;
create policy p_expiry_writeoffs_select on expiry_writeoffs for select using (fn_is_active_user());
drop policy if exists p_expiry_writeoffs_write on expiry_writeoffs;
create policy p_expiry_writeoffs_write on expiry_writeoffs for all
  using (fn_is_active_user() and fn_current_role() in ('dokter', 'perawat'))
  with check (fn_is_active_user() and fn_current_role() in ('dokter', 'perawat'));

drop policy if exists p_expiry_writeoff_items_select on expiry_writeoff_items;
create policy p_expiry_writeoff_items_select on expiry_writeoff_items for select using (fn_is_active_user());
drop policy if exists p_expiry_writeoff_items_write on expiry_writeoff_items;
create policy p_expiry_writeoff_items_write on expiry_writeoff_items for all
  using (fn_is_active_user() and fn_current_role() in ('dokter', 'perawat'))
  with check (fn_is_active_user() and fn_current_role() in ('dokter', 'perawat'));

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expiry_writeoffs'
  ) then
    alter publication supabase_realtime add table expiry_writeoffs;
  end if;
end $$;

-- ============================================================================
-- Dashboard views for the management report: breakdown of visits by reason
-- (sakit/kecelakaan kerja/kontrol/vitamin-mcu) and by disposisi (rawat
-- jalan/observasi/rawat inap/rujuk keluar) per bulan. Same security model as
-- the existing v_kpi_* views (view-owner privileges, so "viewer" gets these
-- pre-aggregated counts without ever touching a row with a patient identity
-- or raw diagnosis).
-- ---------------------------------------------------------------------------
create or replace view v_kpi_jenis_kunjungan as
select company_id, date_trunc('month', tanggal)::date as bulan, jenis_kunjungan, count(*) as jumlah
from visits group by 1, 2, 3;

create or replace view v_kpi_disposisi as
select company_id, date_trunc('month', tanggal)::date as bulan, disposisi, count(*) as jumlah
from visits group by 1, 2, 3;

grant select on v_kpi_jenis_kunjungan, v_kpi_disposisi to authenticated;
