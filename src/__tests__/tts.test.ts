import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sessions.js', () => ({
  sessionStore: {
    getPage: vi.fn(),
  },
}));

describe('speak', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls speechSynthesis.speak on the page', async () => {
    const mockEvaluate = vi.fn().mockResolvedValue(undefined);
    const { sessionStore } = await import('../sessions.js');
    vi.mocked(sessionStore.getPage).mockReturnValue({ evaluate: mockEvaluate } as any);

    const { speak } = await import('../tts.js');
    await speak('Hello', 'session-1');

    expect(mockEvaluate).toHaveBeenCalledOnce();
    const [fn, arg] = mockEvaluate.mock.calls[0];
    expect(fn).toContain('SpeechSynthesisUtterance');
    expect(arg).toBe('Hello');
  });

  it('silently returns when no page is available', async () => {
    const { sessionStore } = await import('../sessions.js');
    vi.mocked(sessionStore.getPage).mockReturnValue(null);

    const { speak } = await import('../tts.js');
    await expect(speak('test', 'no-session')).resolves.toBeUndefined();
  });
});
