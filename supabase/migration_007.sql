-- ============================================================================
-- Migration 007: fix a multi-tenant data-leak in expiry_writeoffs' RLS.
--
-- migration_004 gave expiry_writeoffs / expiry_writeoff_items policies that
-- check only fn_is_active_user() (and, for writes, the role) with no
-- fn_has_company_access(company_id) check — unlike every other table in
-- this schema (consent_forms, drug_requests, patients, visits, ...), which
-- all scope reads/writes to the companies a user's profile.company_scope
-- actually grants. As written, ANY active dokter/perawat/viewer can read
-- (and dokter/perawat can write) Berita Acara Kadaluwarsa belonging to a
-- PT they have no access to — a cross-tenant leak of write-off records
-- (which drug, batch, quantity, who witnessed/destroyed it).
--
-- This migration replaces those four policies with company-scoped versions
-- matching the rest of the schema. Safe to run more than once.
-- ============================================================================

drop policy if exists p_expiry_writeoffs_select on expiry_writeoffs;
create policy p_expiry_writeoffs_select on expiry_writeoffs for select
  using (fn_is_active_user() and fn_has_company_access(company_id));

drop policy if exists p_expiry_writeoffs_write on expiry_writeoffs;
create policy p_expiry_writeoffs_write on expiry_writeoffs for all
  using (fn_is_active_user() and fn_current_role() in ('dokter', 'perawat') and fn_has_company_access(company_id))
  with check (fn_is_active_user() and fn_current_role() in ('dokter', 'perawat') and fn_has_company_access(company_id));

-- expiry_writeoff_items has no company_id column of its own; scope it via
-- its parent expiry_writeoffs row instead.
drop policy if exists p_expiry_writeoff_items_select on expiry_writeoff_items;
create policy p_expiry_writeoff_items_select on expiry_writeoff_items for select
  using (
    fn_is_active_user()
    and exists (
      select 1 from expiry_writeoffs w
      where w.id = expiry_writeoff_items.writeoff_id and fn_has_company_access(w.company_id)
    )
  );

drop policy if exists p_expiry_writeoff_items_write on expiry_writeoff_items;
create policy p_expiry_writeoff_items_write on expiry_writeoff_items for all
  using (
    fn_is_active_user() and fn_current_role() in ('dokter', 'perawat')
    and exists (
      select 1 from expiry_writeoffs w
      where w.id = expiry_writeoff_items.writeoff_id and fn_has_company_access(w.company_id)
    )
  )
  with check (
    fn_is_active_user() and fn_current_role() in ('dokter', 'perawat')
    and exists (
      select 1 from expiry_writeoffs w
      where w.id = expiry_writeoff_items.writeoff_id and fn_has_company_access(w.company_id)
    )
  );
