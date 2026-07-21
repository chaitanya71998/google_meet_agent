import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} from './config.js';
import { logger } from './logger.js';

/**
 * Admin client: uses the service-role key and bypasses Row Level Security.
 * Use ONLY on the server (agent backend), never in the browser.
 *
 * The agent backend runs as a privileged worker: it reads/writes sessions and
 * messages on behalf of users. We scope every query by `user_id` explicitly.
 */
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the database.',
    );
  }
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    logger.info('Supabase admin client initialized', { url: SUPABASE_URL });
  }
  return adminClient;
}

/** Anon client for verifying auth tokens / exposing to non-privileged use. */
export function getSupabaseAnon(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set.');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}
