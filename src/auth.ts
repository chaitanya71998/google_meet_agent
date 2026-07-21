import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnon } from './db.js';
import { logger } from './logger.js';

export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * Verify a Supabase JWT (the access token returned by Supabase Auth on the
 * frontend). Returns the user, or null if invalid/missing.
 *
 * We verify with the anon client's `getUser(jwt)` which validates the token
 * signature + expiry against Supabase's JWKS.
 */
export async function verifyToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const anon: SupabaseClient = getSupabaseAnon();
  try {
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch (e) {
    logger.error('Token verification failed', { error: (e as Error).message });
    return null;
  }
}

/** Express-style helper: extract bearer token from Authorization header. */
export function extractBearer(req: { headers: { authorization?: string } }): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  return h.startsWith('Bearer ') ? h.slice(7) : undefined;
}
