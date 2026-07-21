import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Allow build to succeed without env; runtime will warn.
  console.warn('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set');
}

export const supabase = createClient(url || 'http://localhost:54321', anon || 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL as string) || 'http://localhost:3000';

/** Get the current session's access token (or null). */
export async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

/** Authenticated fetch to the agent backend. */
export async function api(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server returned a non-JSON response. Path: ' + path);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
