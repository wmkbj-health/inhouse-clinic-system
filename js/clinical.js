// Vital-sign reference ranges and staged classifications, aligned to
// published Indonesian/global clinical guidelines rather than ad-hoc
// thresholds. This is a triage visibility aid (flags what needs a closer
// look) — it never suggests a diagnosis or treatment, which stays a
// clinical judgment call for the examining dokter/perawat.
//
// Sources:
// - Tekanan darah: Konsensus Penatalaksanaan Hipertensi 2019, Perhimpunan
//   Dokter Hipertensi Indonesia (InaSH), selaras dengan ACC/AHA 2017.
// - SpO2: WHO Pulse Oximetry Training Manual — hipoksemia <95%, berat <90%.
// - Suhu tubuh: Kemenkes RI (Pedoman Tatalaksana Demam) / WHO — demam bila
//   suhu aksila/oral >=38.0 C.
// - Nadi & laju napas: rentang dewasa normal umum (ACLS/AHA, WHO).
// - Gula Darah Sewaktu: PERKENI — Pengelolaan dan Pencegahan DM Tipe 2 di
//   Indonesia 2021 (kriteria diagnostik GDS >=200 mg/dL).
export const VITAL_FIELDS = [
  { key: 'td_sistol', label: 'TD Sistol', unit: 'mmHg', min: 90, max: 139 },
  { key: 'td_diastol', label: 'TD Diastol', unit: 'mmHg', min: 60, max: 89 },
  { key: 'nadi', label: 'Nadi', unit: 'x/menit', min: 60, max: 100 },
  { key: 'suhu', label: 'Suhu', unit: '°C', min: 36.1, max: 37.4 },
  { key: 'rr', label: 'Laju Napas', unit: 'x/menit', min: 12, max: 20 },
  { key: 'gds', label: 'Gula Darah Sewaktu', unit: 'mg/dL', min: 70, max: 199 },
  { key: 'spo2', label: 'SpO2', unit: '%', min: 95, max: 100 }
];

// Staged classification per vital, most-severe tier first. `test` receives
// the raw number; the first matching tier wins. `normal: true` tiers never
// produce an alert flag — only used to label the value when shown inline.
const CLASSIFIERS = {
  td_sistol: [
    { test: v => v >= 180, label: 'Krisis Hipertensi', severity: 'high' },
    { test: v => v >= 160, label: 'Hipertensi Derajat 2', severity: 'high' },
    { test: v => v >= 140, label: 'Hipertensi Derajat 1', severity: 'high' },
    { test: v => v >= 130, label: 'Normal Tinggi', severity: 'high' },
    { test: v => v >= 120, label: 'Normal', normal: true },
    { test: v => v >= 90, label: 'Optimal', normal: true },
    { test: () => true, label: 'Hipotensi', severity: 'low' }
  ],
  td_diastol: [
    { test: v => v >= 120, label: 'Krisis Hipertensi', severity: 'high' },
    { test: v => v >= 100, label: 'Hipertensi Derajat 2', severity: 'high' },
    { test: v => v >= 90, label: 'Hipertensi Derajat 1', severity: 'high' },
    { test: v => v >= 85, label: 'Normal Tinggi', severity: 'high' },
    { test: v => v >= 80, label: 'Normal', normal: true },
    { test: v => v >= 60, label: 'Optimal', normal: true },
    { test: () => true, label: 'Hipotensi', severity: 'low' }
  ],
  nadi: [
    { test: v => v > 100, label: 'Takikardia', severity: 'high' },
    { test: v => v >= 60, label: 'Normal', normal: true },
    { test: () => true, label: 'Bradikardia', severity: 'low' }
  ],
  suhu: [
    { test: v => v >= 40, label: 'Hiperpireksia', severity: 'high' },
    { test: v => v >= 38, label: 'Demam (Febris)', severity: 'high' },
    { test: v => v >= 37.5, label: 'Subfebris', severity: 'high' },
    { test: v => v >= 36, label: 'Normal', normal: true },
    { test: () => true, label: 'Hipotermia', severity: 'low' }
  ],
  rr: [
    { test: v => v > 20, label: 'Takipnea', severity: 'high' },
    { test: v => v >= 12, label: 'Normal', normal: true },
    { test: () => true, label: 'Bradipnea', severity: 'low' }
  ],
  gds: [
    { test: v => v >= 200, label: 'Indikasi Diabetes (perlu konfirmasi HbA1c/GDP)', severity: 'high' },
    { test: v => v >= 70, label: 'Normal', normal: true },
    { test: () => true, label: 'Hipoglikemia', severity: 'low' }
  ],
  spo2: [
    { test: v => v < 90, label: 'Hipoksemia Berat', severity: 'low' },
    { test: v => v < 95, label: 'Hipoksemia Ringan-Sedang', severity: 'low' },
    { test: () => true, label: 'Normal', normal: true }
  ]
};

function classify(key, value) {
  const tiers = CLASSIFIERS[key];
  if (!tiers) return null;
  return tiers.find(t => t.test(value)) || null;
}

export function evaluateVitals(vitals = {}) {
  const flags = [];
  for (const f of VITAL_FIELDS) {
    const v = vitals[f.key];
    if (v === undefined || v === null || v === '') continue;
    const num = Number(v);
    if (Number.isNaN(num)) continue;
    const tier = classify(f.key, num);
    if (tier && !tier.normal) {
      flags.push({ ...f, value: num, direction: tier.severity, category: tier.label });
    }
  }
  return flags;
}

// Category label for a single value, including normal ones — used to show
// "Normal" / "Hipertensi Derajat 1" / etc. inline next to a vital-sign input
// without needing it to be in the abnormal-flags list.
export function classifyVital(key, value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  const tier = classify(key, num);
  return tier ? tier.label : null;
}

export const CHRONIC_DISEASE_OPTIONS = [
  'Diabetes Melitus', 'Hipertensi', 'Penyakit Jantung', 'Asma', 'PPOK',
  'Penyakit Ginjal Kronik', 'Stroke (Riwayat)', 'Epilepsi', 'Gangguan Jiwa', 'TB Paru (Riwayat)'
];
