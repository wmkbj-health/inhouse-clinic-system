// Admin-only user creation. Deployed as a Supabase Edge Function so the
// service-role key never reaches the browser. Only a caller whose profile
// has role = 'dokter' may invoke this successfully.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Tidak terautentikasi' }, 401, cors);

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role, active').eq('id', user.id).single();
    if (!callerProfile?.active || callerProfile.role !== 'dokter') {
      return json({ error: 'Hanya akun dokter yang dapat membuat akun baru' }, 403, cors);
    }

    const body = await req.json();
    const { email, password, full_name, role, company_scope } = body;
    if (!email || !password || !full_name || !role) {
      return json({ error: 'Data tidak lengkap' }, 400, cors);
    }
    if (!['dokter', 'perawat', 'viewer'].includes(role)) {
      return json({ error: 'Role tidak valid' }, 400, cors);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if (createErr) return json({ error: createErr.message }, 400, cors);

    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id,
      full_name,
      role,
      company_scope: company_scope && company_scope.length ? company_scope : null
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: profileErr.message }, 400, cors);
    }

    await admin.rpc('fn_log_activity', {
      p_company: null, p_action: 'create_user', p_entity: 'profiles',
      p_entity_id: created.user.id, p_detail: { email, role, full_name }
    });

    return json({ ok: true, user_id: created.user.id }, 200, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
