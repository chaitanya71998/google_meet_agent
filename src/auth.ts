import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

/**
 * Simple token storage helper.
 * In a real implementation you would perform the OAuth 2.0 device flow
 * and store the refresh token securely (e.g., keytar or OS keychain).
 */
const HOME_TOKEN_FILE = path.join(os.homedir(), '.google_meet_agent', 'token.json');
const PROJECT_TOKEN_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.google_meet_agent',
  'token.json'
);

function resolveTokenFile(): string {
  if (fs.existsSync(HOME_TOKEN_FILE)) return HOME_TOKEN_FILE;
  if (fs.existsSync(PROJECT_TOKEN_FILE)) return PROJECT_TOKEN_FILE;
  return HOME_TOKEN_FILE;
}

function parseTokenPayload(raw: string): { access_token?: string; refresh_token?: string; expires_in?: number } | null {
  const trimmed = raw.trim();
  // Prefer plaintext JSON (convenient for local setup)
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall back to encrypted blob written by saveToken
    try {
      return JSON.parse(decrypt(trimmed));
    } catch {
      return null;
    }
  }
}

/** Load stored token if it exists */
export function loadToken(): string | null {
  try {
    const data = fs.readFileSync(resolveTokenFile(), 'utf-8');
    const obj = parseTokenPayload(data);
    return obj?.access_token || null;
  } catch {
    return null;
  }
}

/** Save token (access and refresh) — always written to the home-dir path */
export function saveToken(token: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const dir = path.dirname(HOME_TOKEN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const encrypted = encrypt(JSON.stringify(token));
  fs.writeFileSync(HOME_TOKEN_FILE, encrypted, { mode: 0o600 });
}

/** Simple symmetric encryption using a derived key from the user’s OS username */
function getKey(): Buffer {
  const secret = os.userInfo().username + '_google_meet_agent_secret';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(blob: string): string {
  const [ivHex, encHex] = blob.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Retrieve the stored token (supports plaintext JSON or encrypted blob) */
export function getOAuthToken(): string | null {
  return loadToken();
}

/** Placeholder for a full OAuth device flow – to be implemented later */
export async function performDeviceAuth(): Promise<void> {
  console.warn(
    'OAuth device flow not implemented. Place a JSON token file at ~/.google_meet_agent/token.json ' +
      'or ./.google_meet_agent/token.json with { "access_token": "..." }.'
  );
}
