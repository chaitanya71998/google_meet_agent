import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';
export const SCHEDULES_FILE = process.env.SCHEDULES_FILE || path.join(projectRoot, 'schedules.json');

// Supabase
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
// Service role key is used server-side ONLY (bypasses RLS). Never expose to the browser.
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Speech-to-text (tab-audio capture). Uses OpenAI Whisper by default.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';
export const STT_LANGUAGE = process.env.STT_LANGUAGE || 'en';

export const PORT = process.env.PORT || 3000;
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL || `http://localhost:${PORT || 3000}`;
