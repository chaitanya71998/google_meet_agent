export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  time: string;
  msg: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class Logger {
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info') {
    this.minLevel = minLevel;
  }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry: LogEntry = {
      level,
      time: new Date().toISOString(),
      msg,
      ...(meta ? { meta } : {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
    if (process.env.SENTRY_DSN) {
      try {
        import('./sentry.js').then(({ captureLog }) => captureLog(level, msg, meta));
      } catch { }
    }
  }

  debug(msg: string, meta?: Record<string, unknown>) {
    this.write('debug', msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>) {
    this.write('info', msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>) {
    this.write('warn', msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    this.write('error', msg, meta);
  }
}

export const logger = new Logger();
