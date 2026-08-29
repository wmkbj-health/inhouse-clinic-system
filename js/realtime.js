import { supabase } from './supabaseClient.js';
import { toast, debounce } from './util.js';

const WATCHED_TABLES = ['queue', 'visits', 'drug_batches', 'stock_transactions', 'patients', 'sick_notes', 'referrals'];

let channel = null;

export function startRealtimeSync(onChange) {
  stopRealtimeSync();
  const notify = debounce((table) => {
    toast(`Data ${table} diperbarui oleh pengguna lain`, 'ok');
    onChange(table);
  }, 600);

  channel = supabase.channel('clinic-sync');
  for (const table of WATCHED_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      notify(table);
    });
  }
  channel.subscribe();
}

export function stopRealtimeSync() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
