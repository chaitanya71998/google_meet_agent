import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Logger', () => {
  it('logs info messages to stdout', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { logger } = await import('../logger.js');
    logger.info('test message');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const line = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('test message');
    expect(parsed.time).toBeDefined();

    writeSpy.mockRestore();
  });

  it('logs warn messages with meta', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { logger } = await import('../logger.js');
    logger.warn('warning', { code: 42 });

    const line = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('warning');
    expect(parsed.meta.code).toBe(42);

    writeSpy.mockRestore();
  });

  it('logs error messages to stderr', async () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { logger } = await import('../logger.js');
    logger.error('error message');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const line = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('error message');

    writeSpy.mockRestore();
  });

  it('debug messages are suppressed at default info level', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { logger } = await import('../logger.js');
    logger.debug('debug message');

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
