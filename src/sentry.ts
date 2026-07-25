import * as Sentry from '@sentry/node';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENTRY_DSN = process.env.SENTRY_DSN || '';
const ENV = process.env.NODE_ENV || 'development';

const levelMap: Record<LogLevel, 'debug' | 'info' | 'warning' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

export function initSentry() {
  if (!SENTRY_DSN) {
    return;
  }
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
  });
}

export function setupSentryErrorHandler(app: import('express').Application) {
  if (!SENTRY_DSN) return;
  Sentry.setupExpressErrorHandler(app);
}

export function captureLog(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (!SENTRY_DSN) return;
  const severity = levelMap[level] || 'info';
  Sentry.addBreadcrumb({ level: severity, message: msg, data: meta, timestamp: Date.now() / 1000 });
  if (level === 'error') {
    const err = meta?.error
      ? (typeof meta.error === 'string' ? new Error(meta.error) : meta.error as Error)
      : new Error(msg);
    Sentry.captureException(err, { level: severity, extra: { ...meta, msg } });
  }
}
