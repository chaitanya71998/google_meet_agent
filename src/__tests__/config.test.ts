import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads env variables with defaults', async () => {
    const oldModel = process.env.OPENROUTER_MODEL;
    const oldPort = process.env.PORT;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.PORT;
    const { OPENROUTER_MODEL, PORT, LOG_LEVEL } = await import('../config.js');
    expect(OPENROUTER_MODEL).toBe('openrouter/auto');
    expect(PORT).toBe(3000);
    expect(LOG_LEVEL).toBe('info');
    if (oldModel) process.env.OPENROUTER_MODEL = oldModel;
    if (oldPort) process.env.PORT = oldPort;
  });

  it('SCHEDULES_FILE ends with schedules.json', async () => {
    const { SCHEDULES_FILE } = await import('../config.js');
    expect(SCHEDULES_FILE).toMatch(/schedules\.json$/);
  });
});
