-- ============================================================================
-- Migration 008: soft-delete for patients and drugs.
--
-- "Hapus" on patients/drugs previously did a hard DELETE. Because every
-- clinical table (visits, queue, referrals, sick_notes, consent_forms)
-- references patients(id) with the default ON DELETE RESTRICT, a patient
-- who has ever been seen already can't be hard-deleted — but a patient with
-- zero history (a same-day duplicate registration, a typo'd name) CAN be,
-- and that deletion is permanent with no trace, which is a worse default
-- for a medical-record system than simply archiving it. Same reasoning for
-- drugs: a never-stocked drug row can be hard-deleted today, losing the
-- master-data record (and nama_paten, kategori, etc.) with no way back.
--
-- This migration adds a deleted_at column to both tables. Existing rows are
-- unaffected (deleted_at stays null = active). The application (not this
-- migration) switches "Hapus" from DELETE to `update ... set deleted_at =
-- now()`, and every list query adds `.is('deleted_at', null)` unless the
-- caller explicitly asks for archived rows. Safe to run more than once.
-- ============================================================================

alter table patients add column if not exists deleted_at timestamptz;
alter table drugs add column if not exists deleted_at timestamptz;

create index if not exists idx_patients_active on patients(company_id) where deleted_at is null;
create index if not exists idx_drugs_active on drugs(id) where deleted_at is null;
