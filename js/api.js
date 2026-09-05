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

export async function updatePatient(id, payload) {
  const row = await unwrap(await supabase.from('patients').update(payload).eq('id', id).select().single());
  logActivity(row.company_id, 'update_patient', 'patients', id, { nama: row.nama });
  return row;
}

export async function deletePatient(id) {
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('Pasien ini tidak dapat dihapus karena sudah memiliki riwayat kunjungan/antrian/rujukan. Data medis tidak boleh dihapus demi keamanan rekam medis.');
    throw error;
  }
  logActivity(null, 'delete_patient', 'patients', id, {});
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

export async function createDrug(payload) {
  return unwrap(await supabase.from('drugs').insert(payload).select().single());
}

export async function updateDrug(id, payload) {
  return unwrap(await supabase.from('drugs').update(payload).eq('id', id));
}

export async function deleteDrug(id) {
  const { error } = await supabase.from('drugs').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('Item ini tidak dapat dihapus karena sudah memiliki riwayat batch/transaksi/resep. Nonaktifkan dengan mengosongkan stok, atau ganti namanya.');
    throw error;
  }
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
  let q = supabase.from('sick_notes').select('*, patients(nama, no_rm, jabatan, departemen)').order('tanggal', { ascending: false });
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

// Year-wide dashboard data. When statusPegawai is 'all', reuses the safe
// aggregate views (works for viewer too, summed across the year's months).
// Otherwise queries visits+patients directly (dokter/perawat only, enforced
// by RLS — a viewer session never calls this branch from the UI) so the
// figures can be filtered by employment status.
export async function dashboardYearData(year, statusPegawai = 'all') {
  const yearPrefix = `${year}-`;
  if (statusPegawai === 'all') {
    const [kunjungan, topDiseases, topDeptDiseases, topDrugs, sks, rujukan, kk, stock] = await Promise.all([
      kpiFilter(supabase.from('v_kpi_kunjungan').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_top_diseases').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_top_diseases_departemen').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_top_drugs').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_sks').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_rujukan').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_kpi_kecelakaan_kerja').select('*')).then(unwrap),
      kpiFilter(supabase.from('v_stock_warnings').select('*')).then(unwrap)
    ]);
    const inYear = row => String(row.bulan).startsWith(yearPrefix);
    return {
      kunjungan: kunjungan.filter(inYear), topDiseases: topDiseases.filter(inYear),
      topDeptDiseases: topDeptDiseases.filter(inYear), topDrugs: topDrugs.filter(inYear),
      sks: sks.filter(inYear), rujukan: rujukan.filter(inYear), kk: kk.filter(inYear), stock
    };
  }

  let vq = supabase.from('visits').select('*, patients!inner(departemen, status_pegawai), visit_obat(qty, drugs(nama))')
    .gte('tanggal', `${year}-01-01`).lte('tanggal', `${year}-12-31`).eq('patients.status_pegawai', statusPegawai);
  vq = companyFilter(vq);
  const visits = unwrap(await vq);

  const diseaseMap = {}, deptDiseaseMap = {}, drugMap = {};
  let totalKunjungan = 0, totalKk = 0;
  const kkByTingkat = { FA: 0, MA: 0, LTI: 0 };
  for (const v of visits) {
    totalKunjungan++;
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
    kunjungan: [{ total_kunjungan: totalKunjungan }],
    topDiseases: Object.entries(diseaseMap).map(([kode, v]) => ({ kode, ...v })),
    topDeptDiseases: Object.entries(deptDiseaseMap).flatMap(([departemen, diseases]) => Object.entries(diseases).map(([kode, v]) => ({ departemen, kode, ...v }))),
    topDrugs: Object.entries(drugMap).map(([nama, jumlah]) => ({ nama, jumlah })),
    sks: [{ total_sks: sksRows.length }], rujukan: [{ total_rujukan: rujRows.length }],
    kk: Object.entries(kkByTingkat).map(([tingkat, jumlah]) => ({ tingkat, jumlah })), stock
  };
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
      if (flags.length) flag(p, `Tanda vital abnormal (${flags.map(f => f.label).join(', ')})`);
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
export async function getPrintSignatures(companyId) {
  const { data } = await supabase.from('print_signatures').select('*').eq('company_id', companyId).maybeSingle();
  if (!data) return { company_id: companyId, signatures: [] };
  if (data.signatures && data.signatures.length) return data;
  // Back-compat: migrate old fixed nama_dokter/nama_apoteker/nama_admin_hrd fields into the new dynamic list.
  const legacy = [
    data.nama_dokter && { label: 'Dokter', nama: data.nama_dokter },
    data.nama_apoteker && { label: 'Apoteker / Petugas Farmasi', nama: data.nama_apoteker },
    data.nama_admin_hrd && { label: 'Admin/HRD', nama: data.nama_admin_hrd }
  ].filter(Boolean);
  return { ...data, signatures: legacy };
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
