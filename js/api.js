import { supabase } from './supabaseClient.js';
import { setCompanies, setDiseaseCategories, setDiseaseCodes, setDrugCategories, getSelectedCompanyId, isAllCompanies } from './state.js';
import { getProfile } from './auth.js';
import { todayStr } from './util.js';

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
    supabase.from('drug_categories').select('*').order('code').then(unwrap)
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

export async function listPatients(search) {
  let q = supabase.from('patients').select('*, companies(code, name)').order('created_at', { ascending: false });
  q = companyFilter(q);
  if (search) q = q.or(`nama.ilike.%${search}%,no_rm.ilike.%${search}%,nik.ilike.%${search}%`);
  return unwrap(await q);
}

export async function createPatient(payload) {
  const row = await unwrap(await supabase.from('patients').insert(payload).select().single());
  logActivity(payload.company_id, 'create_patient', 'patients', row.id, { nama: payload.nama, no_rm: payload.no_rm });
  return row;
}

export async function getPatient(id) {
  return unwrap(await supabase.from('patients').select('*, companies(code, name)').eq('id', id).single());
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
export async function listDrugsWithStock() {
  const drugs = unwrap(await supabase.from('drugs').select('*, drug_categories(name)').order('kode'));
  const sel = getSelectedCompanyId();
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

export async function createDrug(payload) {
  return unwrap(await supabase.from('drugs').insert(payload).select().single());
}

export async function updateDrug(id, payload) {
  return unwrap(await supabase.from('drugs').update(payload).eq('id', id));
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
  logActivity(companyId, 'receive_batch', 'drug_batches', row.id, { drugId, qty: payload.qty, noBatch: payload.noBatch });
  return row;
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

// ---------------- Visits (SOAP) ----------------
export async function createVisit(visitPayload, obatLines) {
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

export async function getVisitsByPatient(patientId) {
  return unwrap(await supabase.from('visits').select('*, visit_obat(*, drugs(nama))').eq('patient_id', patientId).order('tanggal', { ascending: false }));
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

export async function nextNomorSurat(companyId, prefix) {
  const { count } = await supabase.from('sick_notes').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const year = new Date().getFullYear();
  return `${prefix}/${String((count || 0) + 1).padStart(4, '0')}/${year}`;
}

export async function listSickNotes() {
  let q = supabase.from('sick_notes').select('*, patients(nama, no_rm)').order('tanggal', { ascending: false });
  q = companyFilter(q);
  return unwrap(await q);
}
export async function createSickNote(payload) {
  const row = await unwrap(await supabase.from('sick_notes').insert(payload).select().single());
  logActivity(payload.company_id, 'create_sick_note', 'sick_notes', row.id, { patientId: payload.patient_id, nomorSurat: payload.nomor_surat });
  return row;
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
