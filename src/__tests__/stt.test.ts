import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when OPENAI_API_KEY is not set', async () => {
    vi.resetModules();
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const { transcribeAudio } = await import('../stt.js');
    const result = await transcribeAudio(Buffer.from('test'), 'audio/webm');
    expect(result).toBeNull();

    process.env.OPENAI_API_KEY = orig;
  });

  it('returns transcribed text from Whisper API', async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = 'sk-test';
    const mockFetch = (await import('node-fetch')).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    });

    const { transcribeAudio } = await import('../stt.js');
    const result = await transcribeAudio(Buffer.from('fake audio data'), 'audio/webm');
    expect(result).toBe('hello world');
  });

  it('returns null on API error', async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = 'sk-test';
    const mockFetch = (await import('node-fetch')).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server error',
    });

    const { transcribeAudio } = await import('../stt.js');
    const result = await transcribeAudio(Buffer.from('data'), 'audio/webm');
    expect(result).toBeNull();
  });
});
