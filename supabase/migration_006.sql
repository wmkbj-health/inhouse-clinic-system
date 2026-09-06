-- ============================================================================
-- Migration 006: matured obat/alkes/BHP category taxonomy.
--
-- migration_004 added a second, overlapping set of category names
-- alongside the ones already seeded in seed_diseases_drugs.sql (e.g. a new
-- "GIT" next to the original "SP", both meaning "Obat Saluran Cerna") —
-- this migration consolidates that into one coherent set instead of two
-- parallel lists, renames every remaining category to its official
-- Formularium Nasional Kemenkes RI class title (rather than a paraphrase),
-- and reassigns a small number of specific, well-defined drugs that were
-- filed under the wrong bucket (corticosteroids were mixed into the
-- antihistamine category; several cardiovascular/antidiabetic/antigout
-- drugs were lumped into one catch-all "Endokrin-Metabolik-Kardiovaskular"
-- category that Fornas treats as three separate classes).
--
-- The same problem exists on the Alkes/BHP side: migration_004 added six
-- functional Alkes subcategories and six functional BHP subcategories, but
-- every seeded Alkes/BHP item was still left filed under the original
-- generic catch-all "ALK"/"BHP" categories from seed_diseases_drugs.sql, so
-- the two schemes never actually merged. Part 4 below files each seeded
-- item into its real functional bucket (and, for single-use IV access
-- items miscoded as durable "alkes", corrects jenis to "bhp" as well —
-- abocath/spuit are consumables, not reusable alat kesehatan).
--
-- Safe to run more than once. Run after migration_004 and migration_005.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rename existing categories to their official Fornas class titles.
--    Same `code` (and therefore same `id`) — no drug's kategori_id changes
--    just from this step.
-- ---------------------------------------------------------------------------
update drug_categories set name = 'Antibakteri (Antibiotik)' where code = 'AB';
update drug_categories set name = 'Analgesik, Antipiretik, Antiinflamasi Nonsteroid, dan Antipirai' where code = 'AG';
update drug_categories set name = 'Antialergi, Antihistamin, dan Kortikosteroid' where code = 'AH';
update drug_categories set name = 'Antivirus, Antijamur, dan Antiparasit' where code = 'AM';
update drug_categories set name = 'Obat untuk Saluran Cerna' where code = 'SP';
update drug_categories set name = 'Obat untuk Gangguan Saluran Napas' where code = 'SN';
update drug_categories set name = 'Vitamin dan Mineral' where code = 'SU';
update drug_categories set name = 'Obat Dermatologikal (Topikal)' where code = 'SA';
update drug_categories set name = 'Obat Injeksi (Parenteral)' where code = 'INJ';
update drug_categories set name = 'Obat untuk Mata dan Telinga' where code = 'OT';
update drug_categories set name = 'Kardiovaskular (Antihipertensi, Antiangina, Antihiperlipidemia)' where code = 'KV';
update drug_categories set name = 'Hormon, Endokrin, dan Antidiabetes' where code = 'HORM';
update drug_categories set name = 'Kortikosteroid' where code = 'KORT';

-- ---------------------------------------------------------------------------
-- 2) Reassign specific drugs that were filed under the wrong/too-broad
--    category. Matched by their exact `kode` from seed_diseases_drugs.sql,
--    so this only ever touches those known rows.
-- ---------------------------------------------------------------------------
-- Corticosteroids mixed into the antihistamine bucket -> Kortikosteroid.
update drugs set kategori_id = (select id from drug_categories where code = 'KORT')
  where kode in ('AH004', 'AH005', 'AH006');

-- Antigout (Allopurinol) belongs with Analgesik/Antipirai now that AG's
-- title explicitly covers Antipirai (gout), not the old catch-all EM.
update drugs set kategori_id = (select id from drug_categories where code = 'AG')
  where kode = 'EM004';

-- Cardiovascular drugs out of the old EM catch-all -> Kardiovaskular.
update drugs set kategori_id = (select id from drug_categories where code = 'KV')
  where kode in ('EM001', 'EM002', 'EM003', 'EM007');

-- Antidiabetics out of the old EM catch-all -> Hormon/Endokrin/Antidiabetes.
update drugs set kategori_id = (select id from drug_categories where code = 'HORM')
  where kode in ('EM005', 'EM006');

-- The old catch-all category is now empty; remove it so it can't collect
-- new items with no real classification going forward. Guarded so this is
-- a no-op if anything still references it (e.g. an item added by hand
-- since this migration was written).
delete from drug_categories where code = 'EM' and not exists (select 1 from drugs where kategori_id = drug_categories.id);

-- ---------------------------------------------------------------------------
-- 3) Drop migration_004's categories that turned out to duplicate one of
--    the (now renamed) categories above in scope. Guarded the same way —
--    only deletes if nothing has been filed under it yet.
-- ---------------------------------------------------------------------------
delete from drug_categories where code in ('ANLG', 'GIT', 'NAPS', 'THT', 'MATA')
  and not exists (select 1 from drugs where kategori_id = drug_categories.id);

-- ---------------------------------------------------------------------------
-- 4) File the seeded Alkes/BHP items (still under the generic catch-all
--    "ALK"/"BHP" from seed_diseases_drugs.sql) into migration_004's
--    functional subcategories. Matched by exact seeded `kode`.
-- ---------------------------------------------------------------------------
-- IV access consumables were seeded as jenis 'alkes' but are single-use —
-- real apotek/klinik stock-opname practice tracks these as BHP Injeksi &
-- Infus, not as reusable alat kesehatan.
update drugs set jenis = 'bhp', kategori_id = (select id from drug_categories where code = 'INJEK')
  where kode in ('ALK001', 'ALK002', 'ALK003', 'ALK004', 'ALK005');

update drugs set kategori_id = (select id from drug_categories where code = 'DIAG')
  where kode in ('ALK006', 'ALK007', 'ALK008');
update drugs set kategori_id = (select id from drug_categories where code = 'EMERG')
  where kode in ('ALK009', 'ALK012', 'ALK013');
update drugs set kategori_id = (select id from drug_categories where code = 'IMOB')
  where kode in ('ALK010', 'ALK011');

update drugs set kategori_id = (select id from drug_categories where code = 'LUKA')
  where kode in ('BHP001', 'BHP002', 'BHP003', 'BHP004', 'BHP006');
update drugs set kategori_id = (select id from drug_categories where code = 'APD')
  where kode in ('BHP007', 'BHP008', 'BHP009');
update drugs set kategori_id = (select id from drug_categories where code = 'INJEK')
  where kode in ('BHP010', 'BHP011', 'BHP012');
update drugs set kategori_id = (select id from drug_categories where code = 'STERBHP')
  where kode in ('BHP005', 'BHP013', 'BHP014', 'BHP015');

-- The generic catch-alls are now empty; drop them so future items are
-- always filed under a real functional category instead of falling back
-- to an undifferentiated bucket. Guarded: no-op if anything still points
-- at them.
delete from drug_categories where code in ('ALK', 'BHP')
  and not exists (select 1 from drugs where kategori_id = drug_categories.id);
