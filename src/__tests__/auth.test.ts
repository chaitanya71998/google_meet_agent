import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractBearer, verifyToken } from '../auth.js';

vi.mock('../db.js', () => ({
  getSupabaseAnon: () => ({
    auth: {
      getUser: vi.fn(),
    },
  }),
}));

describe('extractBearer', () => {
  it('returns undefined for missing header', () => {
    expect(extractBearer({ headers: {} })).toBeUndefined();
  });

  it('returns undefined for header without Bearer prefix', () => {
    expect(extractBearer({ headers: { authorization: 'Token xyz' } })).toBeUndefined();
  });

  it('extracts token after Bearer', () => {
    expect(extractBearer({ headers: { authorization: 'Bearer my-jwt-token' } })).toBe('my-jwt-token');
  });

  it('handles empty Bearer token', () => {
    expect(extractBearer({ headers: { authorization: 'Bearer ' } })).toBe('');
  });
});

describe('verifyToken', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null for undefined token', async () => {
    expect(await verifyToken(undefined)).toBeNull();
  });

  it('returns null for empty token', async () => {
    expect(await verifyToken('')).toBeNull();
  });
});
