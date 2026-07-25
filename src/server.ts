import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { joinMeet } from './meet.js';
import { startTranscription, startTabAudioCapture } from './audio.js';
import { getResponseFromLLM } from './llm.js';
import { transcribeAudio } from './stt.js';
import { speak } from './tts.js';
import { scheduleAutoJoins } from './scheduler.js';
import { sessionStore } from './sessions.js';
import { SCHEDULES_FILE } from './config.js';
import { verifyToken, extractBearer, AuthUser } from './auth.js';
import { logger } from './logger.js';
import { initSentry, setupSentryErrorHandler } from './sentry.js';

initSentry();

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { error: String(reason) });
});

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(projectRoot, 'public');

const app = express();
app.use(express.json());

// ---- Helpers ---------------------------------------------------------------

function isValidMeetUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('meet.google.com');
  } catch {
    return false;
  }
}

function body(req: Request): any {
  return (req.body ?? {}) as any;
}

function pid(req: Request): string {
  return String(req.params.id);
}

// Express 4 does not forward async rejections to error middleware automatically.
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Require a valid Supabase session; attach `req.user`. */
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user: AuthUser | null = await verifyToken(extractBearer(req));
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as any).user = user;
  next();
}

// ---- API -------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  res.json({ service: 'google-meet-agent', status: 'running', uptime: process.uptime() });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'running', uptime: process.uptime() });
});

// ---- Unauthenticated routes (called from in-page browser scripts) ------------
// These are called by browser-injected SpeechRecognition / MediaRecorder scripts
// that don't have access to the Supabase JWT. We verify the session exists and
// use its owner as the user context.

app.post('/api/transcript', asyncHandler(async (req: Request, res: Response) => {
  const { text, sessionId } = body(req);
  if (!text || typeof text !== 'string') throw new HttpError(400, 'Missing transcript text');
  if (!sessionId) throw new HttpError(400, 'Missing sessionId');

  const session = await sessionStore.getById(sessionId);
  if (!session) throw new HttpError(404, 'Session not found');
  const userId = session.user_id;

  await sessionStore.addMessage({ sessionId, userId, role: 'user', text });
  logger.info('Transcript received', { sessionId, userId, text: text.slice(0, 80) });

  try {
    const reply = await getResponseFromLLM(text);
    await sessionStore.addMessage({ sessionId, userId, role: 'agent', text: reply });
    await speak(reply, sessionId);
    res.json({ reply });
  } catch (e) {
    const msg = (e as Error).message;
    await sessionStore.addMessage({ sessionId, userId, role: 'agent', text: `⚠️ ${msg}` });
    logger.error('LLM/transcript handling failed', { sessionId, error: msg });
    res.json({ reply: null, error: msg });
  }
}));

app.post('/api/transcript-event', asyncHandler(async (req: Request, res: Response) => {
  const { kind, detail, sessionId } = body(req);
  const benign = ['no-speech', 'aborted', 'audio-capture', 'tab-audio: Could not start video source', 'tab-audio: denied'];
  if (kind === 'error' && detail && !benign.some((b) => detail.includes(b))) {
    logger.warn('Transcript recognizer error', { sessionId, detail });
    const session = sessionId ? await sessionStore.getById(sessionId) : null;
    if (session) {
      await sessionStore.addMessage({ sessionId, userId: session.user_id, role: 'agent', text: `⚠️ Speech recognition error: ${detail}` });
    }
  }
  res.json({ ok: true });
}));

app.post('/api/audio', asyncHandler(async (req: Request, res: Response) => {
  const { data, mime, sessionId } = body(req);
  if (!sessionId) { res.json({ ok: true }); return; }
  const session = await sessionStore.getById(sessionId);
  if (!session) { res.json({ ok: true }); return; }
  const userId = session.user_id;
  if (!data || typeof data !== 'string') { res.json({ ok: true }); return; }
  try {
    const buf = Buffer.from(data, 'base64');
    const text = await transcribeAudio(buf, typeof mime === 'string' ? mime : 'audio/webm');
    if (!text) { res.json({ ok: true, transcribed: false }); return; }
    await sessionStore.addMessage({ sessionId, userId, role: 'user', text });
    logger.info('Tab audio transcribed', { sessionId, text: text.slice(0, 80) });
    try {
      const reply = await getResponseFromLLM(text);
      await sessionStore.addMessage({ sessionId, userId, role: 'agent', text: reply });
      await speak(reply, sessionId);
      res.json({ ok: true, transcribed: true, reply });
    } catch (e) {
      const msg = (e as Error).message;
      await sessionStore.addMessage({ sessionId, userId, role: 'agent', text: `⚠️ ${msg}` });
      res.json({ ok: true, transcribed: true, error: msg });
    }
  } catch (e) {
    logger.error('Audio processing failed', { sessionId, error: (e as Error).message });
    res.json({ ok: true, transcribed: false });
  }
}));

// ---- Authenticated routes ---------------------------------------------------
// All routes below require a valid Supabase JWT.

app.use('/api', requireAuth);

app.get('/api/sessions', asyncHandler(async (req: Request, res: Response) => {
  const sessions = await sessionStore.list((req as any).user.id);
  res.json(
    sessions.map((s: any) => ({
      id: s.id,
      url: s.url,
      name: s.name,
      mute: s.mute,
      video: s.video,
      status: s.status,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      messageCount: undefined,
    })),
  );
}));

app.get('/api/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const session = await sessionStore.get(pid(req), userId);
  if (!session) throw new HttpError(404, 'Session not found');
  const messages = await sessionStore.getMessages(pid(req), userId);
  res.json({
    id: session.id,
    url: session.url,
    name: session.name,
    mute: session.mute,
    video: session.video,
    status: session.status,
    error: session.error,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messages: messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      at: m.created_at,
    })),
  });
}));

app.post('/api/sessions', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { url, mute = true, video = false, name = 'Meet Agent' } = body(req);
  if (!isValidMeetUrl(url)) throw new HttpError(400, 'A valid Google Meet URL is required');

  const id = await sessionStore.create({
    userId,
    url,
    name: String(name).slice(0, 60),
    mute: Boolean(mute),
    video: Boolean(video),
  });

  // Fire-and-forget join; status is persisted to Supabase.
  (async () => {
    try {
      await sessionStore.update(id, userId, { status: 'joining' });
      await sessionStore.addMessage({
        sessionId: id,
        userId,
        role: 'agent',
        text: '🔄 Launching browser and joining meeting…',
      });
      const page = await joinMeet(url, { mute, video, name }, id);
      sessionStore.setPage(id, page);
      await sessionStore.update(id, userId, { status: 'in-call' });
      await sessionStore.addMessage({
        sessionId: id,
        userId,
        role: 'agent',
        text: '✅ Joined the meeting. Listening…',
      });
      await startTranscription(page, id);
      try {
        await startTabAudioCapture(page, id);
      } catch (e) {
        logger.warn('Tab audio capture unavailable', { sessionId: id, error: (e as Error).message });
      }
      await sessionStore.update(id, userId, { status: 'transcribing' });
      logger.info('Joined Meet', { sessionId: id, url });
    } catch (err) {
      const msg = (err as Error).message;
      await sessionStore.update(id, userId, { status: 'error', error: msg });
      await sessionStore.addMessage({
        sessionId: id,
        userId,
        role: 'agent',
        text: `⚠️ Join failed: ${msg}`,
      });
      logger.error('Join failed', { sessionId: id, error: msg });
    }
  })();

  res.status(201).json({ id, url, status: 'joining' });
}));

app.post('/api/sessions/:id/leave', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const session = await sessionStore.get(pid(req), userId);
  if (!session) throw new HttpError(404, 'Session not found');
  const page = sessionStore.getPage(pid(req));
  if (page) {
    page.close().catch(() => undefined);
    sessionStore.clearPage(pid(req));
  }
  await sessionStore.update(pid(req), userId, { status: 'left' });
  res.json({ id: pid(req), status: 'left' });
}));

app.delete('/api/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await sessionStore.delete(pid(req), userId);
  res.status(204).end();
}));

app.post('/api/sessions/:id/message', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { text } = body(req);
  if (!text || typeof text !== 'string') throw new HttpError(400, 'Missing text');
  const session = await sessionStore.get(pid(req), userId);
  if (!session) throw new HttpError(404, 'Session not found');

  await sessionStore.addMessage({ sessionId: pid(req), userId, role: 'user', text });
  try {
    const reply = await getResponseFromLLM(text);
    await sessionStore.addMessage({ sessionId: pid(req), userId, role: 'agent', text: reply });
    await speak(reply, pid(req));
    res.json({ reply });
  } catch (e) {
    const msg = (e as Error).message;
    await sessionStore.addMessage({ sessionId: pid(req), userId, role: 'agent', text: `⚠️ ${msg}` });
    logger.error('Message handling failed', { sessionId: pid(req), error: msg });
    res.json({ reply: null, error: msg });
  }
}));

app.get('/api/schedules', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const raw = fs.readFileSync(SCHEDULES_FILE, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.json([]);
  }
}));

// ---- Static UI (optional; Vercel serves the real frontend) ------------------

if (fs.existsSync(PUBLIC_DIR) && fs.readdirSync(PUBLIC_DIR).length) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (_req: Request, res: Response) => {
    const indexFile = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexFile)) res.sendFile(indexFile);
    else res.status(404).json({ error: 'UI not built' });
  });
}

// ---- Error handling (must be registered last) -------------------------------

setupSentryErrorHandler(app);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    logger.warn('Request error', { status: err.status, message: err.message });
    return res.status(err.status).json({ error: err.message });
  }
  logger.error('Unhandled error', { error: (err as Error).message });
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Startup ----------------------------------------------------------------

scheduleAutoJoins();

// Only start listening when run directly (not when imported by tests).
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;
if (!isTest) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    logger.info(`Google-Meet-Agent server listening on port ${PORT}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error('Failed to start server', { error: err.message, code: err.code });
    process.exit(1);
  });
}

export { app };
