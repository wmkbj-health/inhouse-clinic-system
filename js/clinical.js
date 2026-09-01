// Standard adult clinical reference thresholds (WHO / general nursing triage
// guidelines) used to flag abnormal vital signs. Not a diagnostic tool —
// purely a visibility aid so abnormal results surface automatically instead
// of relying on manual review.
export const VITAL_FIELDS = [
  { key: 'td_sistol', label: 'TD Sistol', unit: 'mmHg', min: 90, max: 139 },
  { key: 'td_diastol', label: 'TD Diastol', unit: 'mmHg', min: 60, max: 89 },
  { key: 'nadi', label: 'Nadi', unit: 'x/menit', min: 60, max: 100 },
  { key: 'suhu', label: 'Suhu', unit: '°C', min: 36.1, max: 37.4 },
  { key: 'rr', label: 'Laju Napas', unit: 'x/menit', min: 12, max: 20 },
  { key: 'gds', label: 'Gula Darah Sewaktu', unit: 'mg/dL', min: 70, max: 199 },
  { key: 'spo2', label: 'SpO2', unit: '%', min: 95, max: 100 }
];

export function evaluateVitals(vitals = {}) {
  const flags = [];
  for (const f of VITAL_FIELDS) {
    const v = vitals[f.key];
    if (v === undefined || v === null || v === '') continue;
    const num = Number(v);
    if (Number.isNaN(num)) continue;
    if (num < f.min) flags.push({ ...f, value: num, direction: 'low' });
    else if (num > f.max) flags.push({ ...f, value: num, direction: 'high' });
  }
  return flags;
}

export const CHRONIC_DISEASE_OPTIONS = [
  'Diabetes Melitus', 'Hipertensi', 'Penyakit Jantung', 'Asma', 'PPOK',
  'Penyakit Ginjal Kronik', 'Stroke (Riwayat)', 'Epilepsi', 'Gangguan Jiwa', 'TB Paru (Riwayat)'
];
