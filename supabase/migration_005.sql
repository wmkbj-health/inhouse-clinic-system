-- ============================================================================
-- Migration 005: P3K categories (kept separate from regular pharmacy stock
-- so the same drug name can exist in both without being flagged as a
-- duplicate or mixed into the wrong stock), a "sediaan" (route/form) column
-- for the stocktake report, and photo attachments on Berita Acara
-- Kadaluwarsa. Purely additive — run once in the Supabase SQL Editor.
-- ============================================================================

insert into drug_categories (code, name) values
  ('P3KOBT', 'P3K - Obat'),
  ('P3KALK', 'P3K - Alat Kesehatan')
on conflict (code) do nothing;

alter table drugs add column if not exists sediaan text;
comment on column drugs.sediaan is 'Rute/bentuk sediaan untuk laporan stocktake, mis. Oral, Topikal, Injeksi, Tetes, Inhalasi.';

alter table expiry_writeoffs add column if not exists foto_urls jsonb not null default '[]'::jsonb;
comment on column expiry_writeoffs.foto_urls is 'Array of data-URI photos attached as lampiran to this Berita Acara (small, client-compressed images).';
