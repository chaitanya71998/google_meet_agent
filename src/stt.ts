import fetch from 'node-fetch';
import { logger } from './logger.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';
const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

/**
 * Transcribe raw audio (webm/ogg/mp3/etc.) to text using OpenAI's Whisper endpoint.
 * Returns null if no API key is configured or the request fails.
 */
export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    logger.warn('No OPENAI_API_KEY set; skipping cloud STT');
    return null;
  }

  const form: any = new FormData();
  const ext = (mimeType.split('/')[1] || 'webm').split(';')[0] || 'webm';
  const bytes = new Uint8Array(buffer);
  form.append('file', new Blob([bytes], { type: mimeType }), `chunk.${ext}`);
  form.append('model', OPENAI_STT_MODEL);
  form.append('language', process.env.STT_LANGUAGE || 'en');

  try {
    const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form as any,
    });
    if (!res.ok) {
      const txt = await res.text();
      logger.error('STT error', { status: res.status, detail: txt.slice(0, 200) });
      return null;
    }
    const data: any = await res.json();
    return typeof data?.text === 'string' ? data.text.trim() : null;
  } catch (e) {
    logger.error('STT request failed', { error: (e as Error).message });
    return null;
  }
}
