import { supabase } from './supabaseClient.js';

let currentSession = null;
let currentProfile = null;

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  if (session) await loadProfile();
  return currentSession;
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', currentSession.user.id).single();
  if (error) { currentProfile = null; return; }
  currentProfile = data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentSession = data.session;
  await loadProfile();
  if (!currentProfile || !currentProfile.active) {
    await supabase.auth.signOut();
    currentSession = null;
    currentProfile = null;
    throw new Error('Akun tidak ditemukan atau sudah dinonaktifkan. Hubungi dokter/admin klinik.');
  }
  return currentProfile;
}

export async function signOut() {
  await supabase.auth.signOut();
  currentSession = null;
  currentProfile = null;
}

export function getSession() { return currentSession; }
export function getProfile() { return currentProfile; }
export function isLoggedIn() { return !!currentSession && !!currentProfile; }

export function hasRole(...roles) {
  return currentProfile && roles.includes(currentProfile.role);
}

export function canAccessCompany(companyId) {
  if (!currentProfile) return false;
  return !currentProfile.company_scope || currentProfile.company_scope.includes(companyId);
}

export const ROLE_LABEL = { dokter: 'Dokter', perawat: 'Perawat', viewer: 'Viewer' };
