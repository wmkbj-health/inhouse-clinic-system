const STORAGE_KEY = 'ics_selected_company';

let companies = [];
let diseaseCategories = [];
let diseaseCodes = [];
let drugCategories = [];
let selectedCompanyId = localStorage.getItem(STORAGE_KEY) || 'all';

export function setCompanies(list) { companies = list; }
export function getCompanies() { return companies; }
export function getCompanyById(id) { return companies.find(c => c.id === id); }

export function setDiseaseCategories(list) { diseaseCategories = list; }
export function getDiseaseCategories() { return diseaseCategories; }
export function setDiseaseCodes(list) { diseaseCodes = list; }
export function getDiseaseCodes() { return diseaseCodes; }
export function setDrugCategories(list) { drugCategories = list; }
export function getDrugCategories() { return drugCategories; }

export function getSelectedCompanyId() { return selectedCompanyId; }
export function setSelectedCompanyId(id) {
  selectedCompanyId = id;
  localStorage.setItem(STORAGE_KEY, id);
}
export function isAllCompanies() { return selectedCompanyId === 'all'; }

export const COMPANY_ORDER = ['WSL', 'MTI', 'KMF', 'BIOS', 'JLA'];

export function companyLogoUrl(codeOrCompany) {
  const code = (typeof codeOrCompany === 'string' ? codeOrCompany : codeOrCompany?.code || '').toLowerCase();
  if (!code) return 'assets/icon.svg';
  return `assets/logos/${code}.png`;
}

export function sortByCompanyOrder(list, keyFn = c => c.code) {
  return list.slice().sort((a, b) => COMPANY_ORDER.indexOf(keyFn(a)) - COMPANY_ORDER.indexOf(keyFn(b)));
}

let pendingApotekFilter = null;
export function setPendingApotekFilter(type) { pendingApotekFilter = type; }
export function consumePendingApotekFilter() { const v = pendingApotekFilter; pendingApotekFilter = null; return v; }

export function calcAge(tglLahir) {
  if (!tglLahir) return null;
  const dob = new Date(tglLahir + 'T00:00:00');
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  if (now.getDate() < dob.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years, months };
}

export function fmtAge(tglLahir) {
  const a = calcAge(tglLahir);
  if (!a) return '-';
  return `${a.years} th ${a.months} bln`;
}
