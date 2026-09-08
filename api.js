import { supabase } from './supabaseClient.js';
import { setCompanies, setDiseaseCategories, setDiseaseCodes, setDrugCategories, getSelectedCompanyId, isAllCompanies } from './state.js';
import { getProfile } from './auth.js';
import { todayStr } from './util.js';
import { evaluateVitals } from './clinical.js';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function logActivity(companyId, action, entity, entityId, detail) {
  supabase.rpc('fn_log_activity', { p_company: companyId || null, p_action: action, p_entity: entity, p_entity_id: String(entityId), p_detail: detail || {} }).then(() => {});
}

export async function loadReferenceData() {
  const [companies, cats, codes, drugCats] = await Promise.all([
    supabase.from('companies').select('*').order('name').then(unwrap),
    supabase.from('disease_categories').select('*').order('num').then(unwrap),
    supabase.from('disease_codes').select('*, disease_categories(num, name)').order('code').then(unwrap),
    supabase.from('drug_categories').select('*').order('name').then(unwrap)
  ]);
  setCompanies(companies);
  setDiseaseCategories(cats);
  setDiseaseCodes(codes.map(c => ({ code: c.code, desc: c.description, category: c.disease_categories?.name || '' })));
  setDrugCategories(drugCats);
}

function companyFilter(query, column = 'company_id') {
  const sel = getSelectedCompanyId();
  if (sel && sel !== 'all') return query.eq(column, sel);
  return query;
}

export function searchDiseaseCodes(list, q, limit = 15) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return [];
  const starts = [], contains = [];
  for (const d of list) {
    const hay1 = d.code.toLowerCase(), hay2 = d.desc.toLowerCase();
    if (hay1.startsWith(query) || hay2.startsWith(query)) starts.push(d);
    else if (hay1.includes(query) || hay2.includes(query)) contains.push(d);
  }
  return starts.concat(contains).slice(0, limit);
}

// ---------------- Patients ----------------
export async function nextRmNumber(companyId) {
  const { count } = await supabase.from('patients').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const year = new Date().getFullYear();
  return `RM-${year}-${String((count || 0) + 1).padStart(5, '0')}`;
}

// Backs the global search box in the sidebar — same nama/no_rm/nik match as
// listPatients, just capped small since it's a live-typing dropdown, not a
// browsable list.
export async function searchPatientsGlobal(query) {
  if (!query || query.trim().length < 2) return [];
  let q = supabase.from('patients').select('id, nama, no_rm, nik, tgl_lahir, departemen, company_id, companies(code, name)')
    .is('deleted_at', null)
    .or(`nama.ilike.%${query}%,no_rm.ilike.%${query}%,nik.ilike.%${query}%`)
    .limit(8);
  q = companyFilter(q);
  return unwrap(await q);
}

export async function listPatients(search) {
  let q = supabase.from('patients').select('*, companies(code, name)').order('created_at', { ascending: false }).is('deleted_at', null);
  q = companyFilter(q);
  if (search) q = q.or(`nama.ilike.%${search}%,no_rm.ilike.%${search}%,nik.ilike.%${search}%`);
  return unwrap(await q);
}

// Paginated variant for the "Daftar Pasien" table — separate from
// listPatients() (which several other views use to fetch the full active
// list for an inline patient picker, where pagination doesn't apply).
export async function listPatientsPage(search, { includeArchived = false, page = 0, pageSize = 25 } = {}) {
  let q = supabase.from('patients').select('*, companies(code, name)', { count: 'exact' }).order('created_at', { ascending: false });
  q = companyFilter(q);
  if (!includeArchived) q = q.is('deleted_at', null);
  if (search) q = q.or(`nama.ilike.%${search}%,no_rm.ilike.%${search}%,nik.ilike.%${search}%`);
  q = q.range(page * pageSize, page * pageSize + pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data, total: count || 0 };
}

export async function listArchivedPatients() {
  let q = supabase.from('patients').select('*, companies(code, name)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}

export async function restorePatient(id) {
  await unwrap(await supabase.from('patients').update({ deleted_at: null }).eq('id', id).select().single());
  logActivity(null, 'restore_patient', 'patients', id, {});
}

export async function createPatient(payload) {
  const row = await unwrap(await supabase.from('patients').insert(payload).select().single());
  logActivity(payload.company_id, 'create_patient', 'patients', row.id, { nama: payload.nama, no_rm: payload.no_rm });
  return row;
}

// No. RM is this app's one canonical identifier for "this is the same
// patient" — a name alone never is, since two different people can share a
// name. So before registering, surface every existing patient with the
// same name (or the same NIK, which IS unique to a person) and let the
// user pick: reuse that RM (same person, just add a new visit under their
// existing record) or confirm it's a different person and register fresh.
// Same name + different RM is explicitly fine — it only becomes "the same
// patient twice" if staff pick the wrong branch here.
export async function findPossibleDuplicatePatients(companyId, { nik, nama }) {
  const matches = new Map();
  if (nik) {
    const byNik = unwrap(await supabase.from('patients').select('id, nama, no_rm, nik, tgl_lahir, jenis_kelamin, departemen').eq('company_id', companyId).eq('nik', nik));
    byNik.forEach(p => matches.set(p.id, p));
  }
  if (nama) {
    const byName = unwrap(await supabase.from('patients').select('id, nama, no_rm, nik, tgl_lahir, jenis_kelamin, departemen').eq('company_id', companyId).ilike('nama', nama));
    byName.forEach(p => matches.set(p.id, p));
  }
  return Array.from(matches.values());
}

export async function getPatient(id) {
  return unwrap(await supabase.from('patients').select('*, companies(code, name)').eq('id', id).single());
}

export async function updatePatient(id, payload) {
  const row = await unwrap(await supabase.from('patients').update(payload).eq('id', id).select().single());
  logActivity(row.company_id, 'update_patient', 'patients', id, { nama: row.nama });
  return row;
}

// Soft-delete (arsip): patients are never hard-deleted from the app so a
// medical record is never permanently lost by accident. Archived patients
// disappear from the active list/search but stay in the database (and can
// be restored) — separate from the pre-existing FK protection that already
// blocks deleting a patient with real clinical history.
export async function deletePatient(id) {
  await unwrap(await supabase.from('patients').update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single());
  logActivity(null, 'archive_patient', 'patients', id, {});
}

// True permanent delete — only ever offered from the "diarsipkan" view, on a
// patient that's already been archived, as a deliberate second step for
// genuine data-entry mistakes (a same-day duplicate registration, a typo'd
// name) rather than the default action. Still blocked by the same FK
// constraints as before on any patient with real clinical history (visits,
// queue, referrals, sick_notes, consent_forms all reference patients(id)),
// so this can't be used to erase an actual medical record.
export async function hardDeletePatient(id) {
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('Pasien ini tidak dapat dihapus permanen karena sudah memiliki riwayat kunjungan/antrian/rujukan/persetujuan medis. Data medis tidak boleh dihapus demi keamanan rekam medis — biarkan tetap diarsipkan.');
    throw error;
  }
  logActivity(null, 'hard_delete_patient', 'patients', id, {});
}

export async function queuePositionToday(companyId, queueId) {
  const list = await unwrap(await supabase.from('queue').select('id').eq('company_id', companyId).eq('tanggal', todayStr()).order('created_at'));
  const idx = list.findIndex(q => q.id === queueId);
  return idx >= 0 ? idx + 1 : list.length;
}

// ---------------- Queue ----------------
export async function listQueueToday() {
  let q = supabase.from('queue').select('*, patients(nama, no_rm, jenis_kelamin, tgl_lahir)').eq('tanggal', todayStr()).order('created_at');
  q = companyFilter(q);
  return unwrap(await q);
}

export async function addToQueue(companyId, patient, keluhan, poli) {
  return unwrap(await supabase.from('queue').insert({
    company_id: companyId, patient_id: patient.id, tanggal: todayStr(),
    poli: poli || 'Poli Umum', keluhan: keluhan || '', status: 'menunggu'
  }).select().single());
}

export async function updateQueueStatus(id, status) {
  return unwrap(await supabase.from('queue').update({ status }).eq('id', id));
}

export async function deleteQueueItem(id) {
  return unwrap(await supabase.from('queue').delete().eq('id', id));
}

// ---------------- Medical alerts (expired / safety stock / reorder) ----------------
export async function stockAlerts() {
  const drugs = await listDrugsWithStock();
  const now = new Date();
  const expired = [];
  const expiringSoon = [];
  const reorder = [];
  for (const d of drugs) {
    const isLow = d.stok <= d.stok_minimum;
    let isExpired = false, isExpiringSoon = false;
    if (d.nextExpiry) {
      const days = Math.round((new Date(d.nextExpiry) - now) / 86400000);
      if (days < 0) isExpired = true;
      else if (days <= 30) isExpiringSoon = true;
    }
    if (isExpired) expired.push(d);
    else if (isExpiringSoon) expiringSoon.push(d);
    if (isLow) reorder.push(d);
  }
  return { expired, expiringSoon, reorder, total: expired.length + expiringSoon.length + reorder.length };
}

// ---------------- Drugs / FEFO ----------------
// companyId: scopes which PT's batches count toward `stok` — defaults to
// whatever the sidebar's PT switcher is currently set to (including "all",
// which sums every accessible PT's batches together for an overview). Pass
// a specific patient's company_id explicitly wherever the stock number is
// about to be used to decide what can actually be dispensed to THAT
// patient (e.g. the SOAP obat picker) — a visit can only draw from its own
// patient's PT, so under "Semua PT" the sidebar-scoped total silently
// overstates what's really available and dispenseFefo() (which always
// filters by the visit's own company_id) then fails with "stok tidak
// mencukupi" even though the picker just showed plenty of stock.
export async function listDrugsWithStock({ includeArchived = false, companyId } = {}) {
  let drugQ = supabase.from('drugs').select('*, drug_categories(name)').order('nama');
  if (!includeArchived) drugQ = drugQ.is('deleted_at', null);
  const drugs = unwrap(await drugQ);
  const sel = companyId || getSelectedCompanyId();
  let batchQ = supabase.from('drug_batches').select('*').gt('qty_sisa', 0).order('tanggal_expired', { ascending: true, nullsFirst: false });
  if (sel !== 'all') batchQ = batchQ.eq('company_id', sel);
  const batches = unwrap(await batchQ);
  return drugs.map(d => {
    const dBatches = batches.filter(b => b.drug_id === d.id);
    const stok = dBatches.reduce((s, b) => s + Number(b.qty_sisa), 0);
    const nextExpiry = dBatches.length ? dBatches[0].tanggal_expired : null;
    const hargaJual = dBatches.length ? dBatches[0].harga_jual : 0;
    return { ...d, batches: dBatches, stok, nextExpiry, hargaJual };
  });
}

// Aggregates stock_transactions in [fromDate, toDate] per drug. Used to show
// "Penerimaan", "Pemakaian", and "Rata-rata/hari" for a chosen bulan/tahun.
// Note: qty_sisa (current stock) is always the live figure — there is no
// historical daily snapshot table, so "Stok Awal" for a period is derived as
// current stock minus net movement since the period started, which is exact
// when the period includes today and an approximation for fully past months.
export async function drugPeriodStats(fromDate, toDate) {
  const sel = getSelectedCompanyId();
  let q = supabase.from('stock_transactions').select('drug_id, tipe, qty, tanggal').gte('tanggal', fromDate).lte('tanggal', toDate);
  if (sel !== 'all') q = q.eq('company_id', sel);
  const rows = unwrap(await q);
  const stats = {};
  for (const r of rows) {
    if (!stats[r.drug_id]) stats[r.drug_id] = { penerimaan: 0, pemakaian: 0 };
    const qty = Number(r.qty);
    if (r.tipe === 'masuk') stats[r.drug_id].penerimaan += qty;
    else if (r.tipe === 'keluar') stats[r.drug_id].pemakaian += qty;
    else if (qty < 0) stats[r.drug_id].pemakaian += Math.abs(qty);
    else stats[r.drug_id].penerimaan += qty;
  }
  return stats;
}

// Every batch received on or before the period end — unlike
// listDrugsWithStock() (which only returns batches with qty_sisa > 0, since
// that list drives FEFO dispensing), a stocktake report needs to show
// depleted/emptied batches too so the period's history reconciles.
export async function stocktakeBatches(periodTo) {
  const sel = getSelectedCompanyId();
  let bq = supabase.from('drug_batches').select('*').lte('tanggal_terima', periodTo);
  if (sel !== 'all') bq = bq.eq('company_id', sel);
  const [batches, drugs] = await Promise.all([
    unwrap(await bq),
    unwrap(await supabase.from('drugs').select('*, drug_categories(name)').order('nama'))
  ]);
  return drugs.map(d => ({ ...d, batches: batches.filter(b => b.drug_id === d.id) }));
}

// Per-BATCH movement for a period (used by the per-batch stocktake report,
// so two batches of the same drug with different expiry dates each get
// their own accurate Stok Awal/Masuk/Keluar/Akhir instead of one merged
// row). Reconciles fully: masuk includes positive koreksi, keluar includes
// pemakaian pasien + pemusnahan kadaluarsa + negative koreksi, so
// Stok Awal + Masuk - Keluar always equals Stok Akhir (qty_sisa).
export async function batchPeriodStats(fromDate, toDate) {
  const sel = getSelectedCompanyId();
  let q = supabase.from('stock_transactions').select('batch_id, tipe, qty, tanggal').gte('tanggal', fromDate).lte('tanggal', toDate).not('batch_id', 'is', null);
  if (sel !== 'all') q = q.eq('company_id', sel);
  const rows = unwrap(await q);
  const stats = {};
  for (const r of rows) {
    if (!stats[r.batch_id]) stats[r.batch_id] = { masuk: 0, keluar: 0 };
    const qty = Number(r.qty);
    if (r.tipe === 'masuk') stats[r.batch_id].masuk += qty;
    else if (r.tipe === 'keluar' || r.tipe === 'kadaluarsa') stats[r.batch_id].keluar += qty;
    else if (qty < 0) stats[r.batch_id].keluar += Math.abs(qty);
    else stats[r.batch_id].masuk += qty;
  }
  return stats;
}

// Per-drug monthly usage for the last 12 full months — the basis for RKO
// (Rencana Kebutuhan Obat): rata-rata pemakaian/bulan, and from that a
// min/max reorder range (industry-standard min-max stock formula, matching
// the min = avg x 2 / max = avg x 5 buffer already used in this klinik's
// own RKO worksheet: 2 months of safety stock, 5 months as the order
// ceiling so restocking doesn't need to happen again before the next
// review cycle).
export async function rkoUsageStats() {
  const sel = getSelectedCompanyId();
  const since = new Date(); since.setMonth(since.getMonth() - 11); since.setDate(1);
  const sinceStr = since.toISOString().slice(0, 10);
  let q = supabase.from('stock_transactions').select('drug_id, tipe, qty, tanggal').gte('tanggal', sinceStr);
  if (sel !== 'all') q = q.eq('company_id', sel);
  const rows = unwrap(await q);
  const perDrug = {};
  for (const r of rows) {
    if (r.tipe !== 'keluar') continue;
    perDrug[r.drug_id] = (perDrug[r.drug_id] || 0) + Number(r.qty);
  }
  const stats = {};
  for (const [drugId, total] of Object.entries(perDrug)) {
    const rataRata = total / 12;
    stats[drugId] = { totalSetahun: total, rataRata, stokMinimal: rataRata * 2, stokMaksimal: rataRata * 5 };
  }
  return stats;
}

export async function createDrug(payload) {
  return unwrap(await supabase.from('drugs').insert(payload).select().single());
}

export async function updateDrug(id, payload) {
  return unwrap(await supabase.from('drugs').update(payload).eq('id', id));
}

// Soft-delete (arsip): keeps the master-data row (nama_paten, kategori, kode,
// ...) intact so historical stocktake/resep reports referencing this drug
// still resolve its name correctly, and the item can be restored if archived
// by mistake — archiving just hides it from the active Apotek list.
export async function deleteDrug(id) {
  await unwrap(await supabase.from('drugs').update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single());
}

// True permanent delete — only offered from the "diarsipkan" view, for a
// drug entered by mistake (wrong name/duplicate SKU) rather than the default
// action. Still blocked by FK constraints if any batch/transaction/resep
// already references it.
export async function hardDeleteDrug(id) {
  const { error } = await supabase.from('drugs').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('Item ini tidak dapat dihapus permanen karena sudah memiliki riwayat batch/transaksi/resep. Biarkan tetap diarsipkan.');
    throw error;
  }
}

export async function listArchivedDrugs() {
  return unwrap(await supabase.from('drugs').select('*, drug_categories(name)').not('deleted_at', 'is', null).order('nama'));
}

export async function restoreDrug(id) {
  await unwrap(await supabase.from('drugs').update({ deleted_at: null }).eq('id', id).select().single());
}

export async function receiveBatch(companyId, drugId, payload) {
  const row = await unwrap(await supabase.from('drug_batches').insert({
    company_id: companyId, drug_id: drugId, qty_diterima: payload.qty, qty_sisa: payload.qty,
    tanggal_terima: payload.tanggal || todayStr(), tanggal_expired: payload.tanggalExpired || null,
    no_batch: payload.noBatch || null, harga_beli: payload.hargaBeli || 0, harga_jual: payload.hargaJual || 0,
    supplier: payload.supplier || null
  }).select().single());
  await unwrap(await supabase.from('stock_transactions').insert({
    company_id: companyId, drug_id: drugId, batch_id: row.id, tipe: 'masuk',
    qty: payload.qty, tanggal: payload.tanggal || todayStr(), keterangan: payload.keterangan || 'Penerimaan obat'
  }));
  await unwrap(await supabase.from('drug_receipts').insert({
    company_id: companyId, drug_id: drugId, batch_id: row.id, tanggal: payload.tanggal || todayStr(),
    jumlah: payload.qty, nama_penerima: payload.namaPenerima || '-', sumber: payload.supplier || null,
    keterangan: payload.keterangan || null
  }));
  logActivity(companyId, 'receive_batch', 'drug_batches', row.id, { drugId, qty: payload.qty, noBatch: payload.noBatch, namaPenerima: payload.namaPenerima });
  return row;
}

// Riwayat penerimaan obat: quantity + recipient name for each stock receipt.
export async function listDrugReceipts(fromDate, toDate) {
  let q = supabase.from('drug_receipts').select('*, drugs(nama, kode, satuan)').order('tanggal', { ascending: false }).order('created_at', { ascending: false });
  q = companyFilter(q);
  if (fromDate) q = q.gte('tanggal', fromDate);
  if (toDate) q = q.lte('tanggal', toDate);
  return unwrap(await q);
}

// FEFO deduction: consumes earliest-expiry batches first. Returns line items
// [{batchId, qty, hargaSatuan}] actually consumed (may span multiple batches).
export async function dispenseFefo(companyId, drugId, qty, opts = {}) {
  let remaining = qty;
  const { data: batches, error } = await supabase.from('drug_batches')
    .select('*').eq('company_id', companyId).eq('drug_id', drugId).gt('qty_sisa', 0)
    .order('tanggal_expired', { ascending: true, nullsFirst: false });
  if (error) throw error;
  const consumed = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(b.qty_sisa));
    await unwrap(await supabase.from('drug_batches').update({ qty_sisa: Number(b.qty_sisa) - take }).eq('id', b.id));
    await unwrap(await supabase.from('stock_transactions').insert({
      company_id: companyId, drug_id: drugId, batch_id: b.id, tipe: 'keluar',
      qty: take, tanggal: todayStr(), keterangan: opts.keterangan || 'Pemakaian pasien', visit_id: opts.visitId || null
    }));
    consumed.push({ batchId: b.id, qty: take, hargaSatuan: Number(b.harga_jual) });
    remaining -= take;
  }
  if (remaining > 0) throw new Error('Stok tidak mencukupi untuk memenuhi jumlah yang diminta');
  return consumed;
}

export async function adjustStock(companyId, drugId, batchId, qty, keterangan) {
  const batch = unwrap(await supabase.from('drug_batches').select('*').eq('id', batchId).single());
  const newQty = Number(batch.qty_sisa) + qty;
  if (newQty < 0) throw new Error('Hasil koreksi tidak boleh membuat stok batch menjadi negatif');
  await unwrap(await supabase.from('drug_batches').update({ qty_sisa: newQty }).eq('id', batchId));
  await unwrap(await supabase.from('stock_transactions').insert({
    company_id: companyId, drug_id: drugId, batch_id: batchId, tipe: 'penyesuaian', qty, tanggal: todayStr(), keterangan
  }));
  logActivity(companyId, 'adjust_stock', 'drug_batches', batchId, { qty, keterangan });
}

// ---------------- Berita Acara Kadaluwarsa (expiry write-off) ----------------
export async function nextNomorBeritaAcara(companyId) {
  const { count } = await supabase.from('expiry_writeoffs').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const year = new Date().getFullYear();
  return `BA-EXP/${String((count || 0) + 1).padStart(4, '0')}/${year}`;
}

// Writes off expired stock in one document: each line deducts its batch's
// qty_sisa and logs a 'kadaluarsa' stock_transaction, so Apotek stock and
// the usage/stocktake reports never drift out of sync with what was
// actually destroyed, and every deduction stays traceable back to this
// Berita Acara via expiry_writeoff_items.
export async function createExpiryWriteoff(payload, items) {
  const writeoff = await unwrap(await supabase.from('expiry_writeoffs').insert(payload).select().single());
  for (const line of items) {
    const batch = await unwrap(await supabase.from('drug_batches').select('*').eq('id', line.batchId).single());
    const newQty = Number(batch.qty_sisa) - line.qty;
    if (newQty < 0) throw new Error(`Jumlah melebihi stok batch yang tersisa untuk ${line.nama || 'item ini'}`);
    await unwrap(await supabase.from('drug_batches').update({ qty_sisa: newQty }).eq('id', line.batchId));
    await unwrap(await supabase.from('stock_transactions').insert({
      company_id: payload.company_id, drug_id: line.drugId, batch_id: line.batchId, tipe: 'kadaluarsa',
      qty: line.qty, tanggal: payload.tanggal, keterangan: `Pemusnahan kadaluarsa — ${payload.nomor_berita_acara}`
    }));
    await unwrap(await supabase.from('expiry_writeoff_items').insert({
      writeoff_id: writeoff.id, drug_id: line.drugId, batch_id: line.batchId, no_batch: batch.no_batch,
      qty: line.qty, satuan: line.satuan || null, tanggal_expired: batch.tanggal_expired, harga_satuan: batch.harga_jual || 0
    }));
  }
  logActivity(payload.company_id, 'expiry_writeoff', 'expiry_writeoffs', writeoff.id, { nomor: payload.nomor_berita_acara, items: items.length });
  return writeoff;
}

export async function listExpiryWriteoffs() {
  let q = supabase.from('expiry_writeoffs').select('*, expiry_writeoff_items(*, drugs(nama, kode, satuan))').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}

// ---------------- Visits (SOAP) ----------------
// Sums each requested drug's available qty_sisa for this company and throws
// up front, naming which item is short, if any line can't be fully filled —
// called before the visit row exists or anything is dispensed, so a failed
// save never leaves an orphan visit or a partially-deducted batch behind
// (dispenseFefo() itself deducts+throws mid-loop on a real shortfall, which
// is fine once we know every line can actually be filled).
async function checkObatAvailability(companyId, obatLines) {
  for (const line of obatLines) {
    const { data, error } = await supabase.from('drug_batches').select('qty_sisa, drugs(nama)')
      .eq('company_id', companyId).eq('drug_id', line.drugId).gt('qty_sisa', 0);
    if (error) throw error;
    const available = (data || []).reduce((s, b) => s + Number(b.qty_sisa), 0);
    if (available < line.qty) {
      const nama = data?.[0]?.drugs?.nama || 'Obat';
      throw new Error(`Stok ${nama} tidak mencukupi untuk PT pasien ini (tersedia ${available}, diminta ${line.qty}). Stok yang ditampilkan di halaman lain bisa mencakup PT lain bila filter "Semua PT" aktif.`);
    }
  }
}

export async function createVisit(visitPayload, obatLines) {
  if (obatLines.length) await checkObatAvailability(visitPayload.company_id, obatLines);
  const visit = await unwrap(await supabase.from('visits').insert(visitPayload).select().single());
  let biayaTotal = 0;
  for (const line of obatLines) {
    const consumed = await dispenseFefo(visitPayload.company_id, line.drugId, line.qty, { visitId: visit.id, keterangan: `Resep visit ${visit.id}` });
    for (const c of consumed) {
      const subtotal = c.qty * c.hargaSatuan;
      biayaTotal += subtotal;
      await unwrap(await supabase.from('visit_obat').insert({
        visit_id: visit.id, drug_id: line.drugId, batch_id: c.batchId, qty: c.qty, harga_satuan: c.hargaSatuan, subtotal
      }));
    }
  }
  if (biayaTotal > 0) {
    await unwrap(await supabase.from('visits').update({ biaya_total: biayaTotal }).eq('id', visit.id));
    visit.biaya_total = biayaTotal;
  }
  logActivity(visitPayload.company_id, 'create_visit', 'visits', visit.id, { patientId: visitPayload.patient_id, jenisKunjungan: visitPayload.jenis_kunjungan });
  return visit;
}

// Corrects a saved SOAP record (subjective/objective/plan, diagnosa,
// disposisi, vitals, jenis_kunjungan, kecelakaan_kerja detail — this is
// what Kecelakaan Kerja's own "Edit" reuses, since it's the exact same
// visits row, so a correction here shows up everywhere that visit is
// read from). Deliberately does NOT touch obat/visit_obat/biaya_total —
// changing dispensed medication after the fact needs its own stock
// reconciliation (return old batches, FEFO the new ones), which belongs
// in Apotek's "Koreksi Stok" instead of silently happening from here.
export async function updateVisit(id, payload) {
  const row = await unwrap(await supabase.from('visits').update(payload).eq('id', id).select().single());
  logActivity(row.company_id, 'update_visit', 'visits', id, { jenisKunjungan: row.jenis_kunjungan });
  return row;
}

export async function getVisitsByPatient(patientId) {
  return unwrap(await supabase.from('visits').select('*, visit_obat(*, drugs(nama))').eq('patient_id', patientId).order('tanggal', { ascending: false }));
}

export async function getVisit(id) {
  return unwrap(await supabase.from('visits').select('*, patients(nama, no_rm, company_id), visit_obat(*, drugs(nama))').eq('id', id).single());
}

export async function listRecentVisits(limit = 200) {
  let q = supabase.from('visits').select('*, patients(nama, no_rm, departemen)').order('tanggal', { ascending: false }).limit(limit);
  q = companyFilter(q);
  return unwrap(await q);
}

export async function listKecelakaanKerja() {
  let q = supabase.from('visits').select('*, patients(nama, no_rm, departemen, status_pegawai)').eq('jenis_kunjungan', 'kecelakaan_kerja').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}

// ---------------- Referrals / Sick notes ----------------
export async function listReferrals() {
  let q = supabase.from('referrals').select('*, patients(nama, no_rm)').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}
export async function createReferral(payload) {
  const row = await unwrap(await supabase.from('referrals').insert(payload).select().single());
  logActivity(payload.company_id, 'create_referral', 'referrals', row.id, { patientId: payload.patient_id, faskesTujuan: payload.faskes_tujuan });
  return row;
}
export async function deleteReferral(id) {
  await unwrap(await supabase.from('referrals').delete().eq('id', id));
  logActivity(null, 'delete_referral', 'referrals', id, {});
}

export async function nextNomorSurat(companyId, prefix) {
  const { count } = await supabase.from('sick_notes').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const year = new Date().getFullYear();
  return `${prefix}/${String((count || 0) + 1).padStart(4, '0')}/${year}`;
}

export async function listSickNotes() {
  let q = supabase.from('sick_notes').select('*, patients(nama, no_rm, jabatan, departemen)').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}
export async function createSickNote(payload) {
  const row = await unwrap(await supabase.from('sick_notes').insert(payload).select().single());
  logActivity(payload.company_id, 'create_sick_note', 'sick_notes', row.id, { patientId: payload.patient_id, nomorSurat: payload.nomor_surat });
  return row;
}
export async function deleteSickNote(id) {
  await unwrap(await supabase.from('sick_notes').delete().eq('id', id));
  logActivity(null, 'delete_sick_note', 'sick_notes', id, {});
}

// ---------------- Dashboard KPI views ----------------
function kpiFilter(query) {
  const sel = getSelectedCompanyId();
  if (sel !== 'all') return query.eq('company_id', sel);
  return query;
}

export async function dashboardKpis(monthStart) {
  const [kunjungan, topDiseases, topDeptDiseases, topDrugs, sks, rujukan, kk, stock] = await Promise.all([
    kpiFilter(supabase.from('v_kpi_kunjungan').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_top_diseases').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_top_diseases_departemen').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_top_drugs').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_kpi_sks').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_kpi_rujukan').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_kpi_kecelakaan_kerja').select('*').eq('bulan', monthStart)).then(unwrap),
    kpiFilter(supabase.from('v_stock_warnings').select('*')).then(unwrap)
  ]);
  return { kunjungan, topDiseases, topDeptDiseases, topDrugs, sks, rujukan, kk, stock };
}

// Year-wide dashboard data. When statusPegawai is 'all', reuses the safe
// aggregate views (works for viewer too, summed across the year's months).
// Otherwise queries visits+patients directly (dokter/perawat only, enforced
// by RLS — a viewer session never calls this branch from the UI) so the
// figures can be filtered by employment status.
export async function dashboardYearData(year, statusPegawai = 'all') {
  const yearPrefix = `${year}-`;
  if (statusPegawai === 'all') {
    const [kunjungan, topDiseases, topDeptDiseases, topDrugs, sks, rujukan, kk, stock, jenisKunjungan, disposisi] = await Promise.all([
      kpiFilter(supabase.from('v_kpi_kunjungan').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_top_diseases').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_top_diseases_departemen').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_top_drugs').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_sks').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_rujukan').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_kecelakaan_kerja').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_stock_warnings').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_jenis_kunjungan').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_disposisi').select('*')).then(unwrap)
    ]);
    const inYear = row => String(row.bulan).startsWith(yearPrefix);
    const kunjunganInYear = kunjungan.filter(inYear);
    const monthTotals = emptyMonthBuckets(year);
    for (const row of kunjunganInYear) monthTotals[String(row.bulan).slice(0, 7)] += Number(row.total_kunjungan);
    return {
      kunjungan: kunjunganInYear, kunjunganBulanan: monthBucketsToArray(monthTotals),
      topDiseases: topDiseases.filter(inYear),
      topDeptDiseases: topDeptDiseases.filter(inYear), topDrugs: topDrugs.filter(inYear),
      sks: sks.filter(inYear), rujukan: rujukan.filter(inYear), kk: kk.filter(inYear), stock,
      jenisKunjungan: sumByKey(jenisKunjungan.filter(inYear), 'jenis_kunjungan', 'jumlah'),
      disposisi: sumByKey(disposisi.filter(inYear), 'disposisi', 'jumlah')
    };
  }

  let vq = supabase.from('visits').select('*, patients!inner(departemen, status_pegawai), visit_obat(qty, drugs(nama))')
    .gte('tanggal', `${year}-01-01`).lte('tanggal', `${year}-12-31`).eq('patients.status_pegawai', statusPegawai);
  vq = companyFilter(vq);
  const visits = unwrap(await vq);

  const diseaseMap = {}, deptDiseaseMap = {}, drugMap = {};
  const jenisKunjunganMap = {}, disposisiMap = {};
  let totalKunjungan = 0, totalKk = 0;
  const kkByTingkat = { FA: 0, MA: 0, LTI: 0 };
  const monthTotals = emptyMonthBuckets(year);
  for (const v of visits) {
    totalKunjungan++;
    const bucket = String(v.tanggal).slice(0, 7);
    if (bucket in monthTotals) monthTotals[bucket]++;
    if (v.jenis_kunjungan) jenisKunjunganMap[v.jenis_kunjungan] = (jenisKunjunganMap[v.jenis_kunjungan] || 0) + 1;
    if (v.disposisi) disposisiMap[v.disposisi] = (disposisiMap[v.disposisi] || 0) + 1;
    for (const d of v.diagnosa || []) {
      diseaseMap[d.code] = diseaseMap[d.code] || { kode: d.code, penyakit: d.desc, jumlah: 0 };
      diseaseMap[d.code].jumlah++;
      const dept = v.patients?.departemen || 'Tidak diketahui';
      deptDiseaseMap[dept] = deptDiseaseMap[dept] || {};
      deptDiseaseMap[dept][d.code] = deptDiseaseMap[dept][d.code] || { penyakit: d.desc, jumlah: 0 };
      deptDiseaseMap[dept][d.code].jumlah++;
    }
    for (const vo of v.visit_obat || []) {
      const nama = vo.drugs?.nama || '-';
      drugMap[nama] = (drugMap[nama] || 0) + Number(vo.qty);
    }
    if (v.jenis_kunjungan === 'kecelakaan_kerja') {
      totalKk++;
      const t = v.kecelakaan_kerja?.tingkat;
      if (t) kkByTingkat[t] = (kkByTingkat[t] || 0) + 1;
    }
  }

  let sksQ = supabase.from('sick_notes').select('id, patients!inner(status_pegawai)').gte('tanggal', `${year}-01-01`).lte('tanggal', `${year}-12-31`).eq('patients.status_pegawai', statusPegawai);
  sksQ = companyFilter(sksQ);
  let rujQ = supabase.from('referrals').select('id, patients!inner(status_pegawai)').gte('tanggal', `${year}-01-01`).lte('tanggal', `${year}-12-31`).eq('patients.status_pegawai', statusPegawai);
  rujQ = companyFilter(rujQ);
  const [sksRows, rujRows, stock] = await Promise.all([unwrap(await sksQ), unwrap(await rujQ), kpiFilter(supabase.from('v_stock_warnings').select('*')).then(unwrap)]);

  return {
    kunjungan: [{ total_kunjungan: totalKunjungan }], kunjunganBulanan: monthBucketsToArray(monthTotals),
    topDiseases: Object.entries(diseaseMap).map(([kode, v]) => ({ kode, ...v })),
    topDeptDiseases: Object.entries(deptDiseaseMap).flatMap(([departemen, diseases]) => Object.entries(diseases).map(([kode, v]) => ({ departemen, kode, ...v }))),
    topDrugs: Object.entries(drugMap).map(([nama, jumlah]) => ({ nama, jumlah })),
    sks: [{ total_sks: sksRows.length }], rujukan: [{ total_rujukan: rujRows.length }],
    kk: Object.entries(kkByTingkat).map(([tingkat, jumlah]) => ({ tingkat, jumlah })), stock,
    jenisKunjungan: jenisKunjunganMap, disposisi: disposisiMap
  };
}

// Per-PT comparison for the year, ignoring the currently-selected company
// filter (RLS still limits results to whatever companies this profile can
// see — a single-PT user just gets one row back). Used by the "Perbandingan
// Antar PT" dashboard panel, shown only when "Semua PT" is selected.
export async function dashboardCompanyComparison(year) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [visits, sks, rujukan] = await Promise.all([
    unwrap(await supabase.from('visits').select('company_id, jenis_kunjungan, kecelakaan_kerja').gte('tanggal', from).lte('tanggal', to)),
    unwrap(await supabase.from('sick_notes').select('company_id').gte('tanggal', from).lte('tanggal', to)),
    unwrap(await supabase.from('referrals').select('company_id').gte('tanggal', from).lte('tanggal', to))
  ]);
  const byCompany = {};
  const ensure = id => byCompany[id] || (byCompany[id] = { kunjungan: 0, sks: 0, rujukan: 0, kk: 0, kkLti: 0 });
  for (const v of visits) {
    const row = ensure(v.company_id);
    row.kunjungan++;
    if (v.jenis_kunjungan === 'kecelakaan_kerja') {
      row.kk++;
      if (v.kecelakaan_kerja?.tingkat === 'LTI') row.kkLti++;
    }
  }
  for (const s of sks) ensure(s.company_id).sks++;
  for (const r of rujukan) ensure(r.company_id).rujukan++;
  return byCompany;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function emptyMonthBuckets(year) {
  const buckets = {};
  for (let m = 0; m < 12; m++) buckets[`${year}-${String(m + 1).padStart(2, '0')}`] = 0;
  return buckets;
}

function monthBucketsToArray(buckets) {
  return Object.entries(buckets).map(([bulan, total], i) => ({ bulan, label: MONTH_ABBR[i], total }));
}

// Collapses rows like [{jenis_kunjungan:'sakit', jumlah:5}, ...] (one row
// per company per month when "Semua PT" is selected) into a single
// {sakit: total, ...} map summed across every matching row.
function sumByKey(rows, keyField, valueField) {
  const out = {};
  for (const r of rows) {
    const k = r[keyField];
    if (!k) continue;
    out[k] = (out[k] || 0) + Number(r[valueField]);
  }
  return out;
}

// "Perlu Perhatian": patients flagged for follow-up — abnormal vitals on
// their most recent visit, a chronic-disease tag, a still-open SKS, an
// LTI work-accident case, or an unresolved observasi/rawat_inap visit in
// the last 30 days. Dokter/perawat only (relies on direct table RLS).
export async function patientsNeedingAttention() {
  const since = new Date(); since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().slice(0, 10);

  let vq = supabase.from('visits').select('*, patients(id, nama, no_rm, departemen, riwayat_kronis)').gte('tanggal', sinceStr).order('tanggal', { ascending: false });
  vq = companyFilter(vq);
  const visits = unwrap(await vq);

  let snq = supabase.from('sick_notes').select('patient_id, tanggal_selesai, patients(nama, no_rm, departemen)').gte('tanggal_selesai', todayStr());
  snq = companyFilter(snq);
  const activeSickNotes = unwrap(await snq);

  const byPatient = {};
  function flag(patient, reason) {
    if (!patient) return;
    if (!byPatient[patient.id]) byPatient[patient.id] = { patient, reasons: [] };
    if (!byPatient[patient.id].reasons.includes(reason)) byPatient[patient.id].reasons.push(reason);
  }

  const seenLatestVisit = new Set();
  for (const v of visits) {
    const p = v.patients;
    if (!p) continue;
    if (!seenLatestVisit.has(p.id)) {
      seenLatestVisit.add(p.id);
      const flags = evaluateVitals(v.vitals || {});
      if (flags.length) flag(p, `Tanda vital abnormal (${flags.map(f => `${f.label}: ${f.category}`).join(', ')})`);
    }
    if (p.riwayat_kronis?.length) flag(p, `Riwayat kronis: ${p.riwayat_kronis.join(', ')}`);
    if (['observasi', 'rawat_inap'].includes(v.disposisi)) {
      const days = Math.round((new Date() - new Date(v.tanggal)) / 86400000);
      if (days <= 30) flag(p, `${v.disposisi === 'rawat_inap' ? 'Rawat inap' : 'Observasi'} ${days} hari lalu`);
    }
    if (v.jenis_kunjungan === 'kecelakaan_kerja' && v.kecelakaan_kerja?.tingkat === 'LTI') {
      flag(p, 'Kasus LTI — perlu tindak lanjut');
    }
  }
  for (const sn of activeSickNotes) {
    if (sn.patients) flag(sn.patients, `Masih dalam masa istirahat s/d ${fmtDateShort(sn.tanggal_selesai)}`);
  }

  return Object.values(byPatient);
}

function fmtDateShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

// ---------------- Users / activity log (dokter only) ----------------
export async function listProfiles() {
  return unwrap(await supabase.from('profiles').select('*').order('created_at'));
}

export async function updateProfile(id, payload) {
  return unwrap(await supabase.from('profiles').update(payload).eq('id', id));
}

export async function createUserAccount(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/create-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: supabase.supabaseKey },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Gagal membuat akun');
  return json;
}

export async function listActivityLog(limit = 200) {
  let q = supabase.from('activity_log').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(limit);
  return unwrap(await q);
}

// ---------------- Manual backup snapshot (dokter-only) ----------------
const BACKUP_TABLES = ['companies', 'patients', 'queue', 'visits', 'visit_obat', 'drugs', 'drug_batches', 'stock_transactions', 'referrals', 'sick_notes'];

export async function exportSnapshot() {
  const data = {};
  for (const table of BACKUP_TABLES) {
    data[table] = unwrap(await supabase.from(table).select('*'));
  }
  return { exportedAt: new Date().toISOString(), app: 'inhouse-clinic-system', data };
}

// ---------------- Print signatures (editable names shown on printed docs) ----------------
// `signatures` is stored as an object keyed by document type (rujukan, sks,
// consent, stocktake, drug_request) so each surat/laporan keeps its own
// independent set of signer rows. Older rows saved it as a flat array
// (one shared list for every document) or the original fixed
// nama_dokter/nama_apoteker/nama_admin_hrd columns — both are migrated
// transparently into a "default" bucket used for any type not yet
// customized individually.
export async function getPrintSignatures(companyId) {
  const { data } = await supabase.from('print_signatures').select('*').eq('company_id', companyId).maybeSingle();
  if (!data) return { company_id: companyId, signatures: {} };
  if (data.signatures && !Array.isArray(data.signatures)) return { ...data, signatures: data.signatures };
  if (Array.isArray(data.signatures) && data.signatures.length) return { ...data, signatures: { default: data.signatures } };
  const legacy = [
    data.nama_dokter && { label: 'Dokter', nama: data.nama_dokter },
    data.nama_apoteker && { label: 'Apoteker / Petugas Farmasi', nama: data.nama_apoteker },
    data.nama_admin_hrd && { label: 'Admin/HRD', nama: data.nama_admin_hrd }
  ].filter(Boolean);
  return { ...data, signatures: legacy.length ? { default: legacy } : {} };
}

export async function savePrintSignatures(companyId, payload) {
  return unwrap(await supabase.from('print_signatures').upsert({ company_id: companyId, ...payload }).select().single());
}

// ---------------- Consent / refusal forms ----------------
export async function listConsentForms() {
  let q = supabase.from('consent_forms').select('*, patients(nama, no_rm)').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}
export async function createConsentForm(payload) {
  const row = await unwrap(await supabase.from('consent_forms').insert(payload).select().single());
  logActivity(payload.company_id, 'create_consent_form', 'consent_forms', row.id, { tipe: payload.tipe });
  return row;
}

// ---------------- Drug requests (permintaan pengadaan obat) ----------------
export async function listDrugRequests() {
  let q = supabase.from('drug_requests').select('*').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}
export async function nextNomorPermintaan(companyId) {
  const { count } = await supabase.from('drug_requests').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const year = new Date().getFullYear();
  return `PO/${String((count || 0) + 1).padStart(4, '0')}/${year}`;
}
export async function createDrugRequest(payload) {
  const row = await unwrap(await supabase.from('drug_requests').insert(payload).select().single());
  logActivity(payload.company_id, 'create_drug_request', 'drug_requests', row.id, { nomor: payload.nomor_permintaan });
  return row;
}

// ---------------- Data completeness notifications ----------------
export async function dataCompletenessIssues() {
  let pq = supabase.from('patients').select('id, nama, no_rm, nik, no_hp, departemen, jabatan');
  pq = companyFilter(pq);
  const patients = unwrap(await pq);
  const missingNik = patients.filter(p => !p.nik);
  const missingDept = patients.filter(p => !p.departemen);
  const missingPhone = patients.filter(p => !p.no_hp);

  let dq = supabase.from('drugs').select('id, nama, kategori_id');
  const drugs = unwrap(await dq);
  const missingCategory = drugs.filter(d => !d.kategori_id);

  return {
    missingNik, missingDept, missingPhone, missingCategory,
    total: missingNik.length + missingDept.length + missingPhone.length + missingCategory.length
  };
}
