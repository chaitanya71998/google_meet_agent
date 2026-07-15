import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';
export const SCHEDULES_FILE = process.env.SCHEDULES_FILE || path.join(projectRoot, 'schedules.json');
