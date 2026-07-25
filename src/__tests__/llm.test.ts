import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

describe('getResponseFromLLM', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns content from OpenRouter response', async () => {
    const mockFetch = (await import('node-fetch')).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello, world!' } }],
      }),
    });

    const { getResponseFromLLM } = await import('../llm.js');
    const result = await getResponseFromLLM('Say hello');
    expect(result).toBe('Hello, world!');
  });

  it('throws on non-ok response', async () => {
    const mockFetch = (await import('node-fetch')).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid API key',
    });

    const { getResponseFromLLM } = await import('../llm.js');
    await expect(getResponseFromLLM('test')).rejects.toThrow('OpenRouter error 401: Invalid API key');
  });

  it('returns empty string when no content is returned', async () => {
    const mockFetch = (await import('node-fetch')).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    });

    const { getResponseFromLLM } = await import('../llm.js');
    const result = await getResponseFromLLM('test');
    expect(result).toBe('');
  });
});
