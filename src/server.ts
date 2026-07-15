import express, { Request, Response } from 'express';
import { joinMeet } from './meet.js';
import { startTranscription } from './audio.js';
import { getResponseFromLLM } from './llm.js';
import { speak } from './tts.js';
import { setPage } from './pageHolder.js';
import { scheduleAutoJoins } from './scheduler.js';
import './config.js';

const app = express();
app.use(express.json());

// Global reference to the current Meet page (if any)
let meetPage: any = null;

// Health check
app.get('/status', (_req: Request, res: Response) => {
  res.json({ status: 'running', uptime: process.uptime() });
});
/**
 * POST /join
 * Body: { url: string, mute?: boolean, video?: boolean }
 * Launches a Chromium instance, signs in, and joins the Meet.
 */
app.post('/join', async (req: Request, res: Response) => {
  const { url, mute = true, video = false, name } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing Meet URL' });
  }
  try {
    const page = await joinMeet(url, { mute, video, name });
    // Store the page for TTS later
    setPage(page);
    meetPage = page;
    // Attach transcription stream to this page
    await startTranscription(page);
    res.json({ message: 'Joined Meet', pageId: (page.target() as any)._targetId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * POST /transcript
 * Body: { text: string }
 * Called by the injected SpeechRecognition script inside the Meet tab.
 * Forwards the transcript to the LLM and speaks the reply.
 */
app.post('/transcript', async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing transcript text' });
  }
  try {
    const reply = await getResponseFromLLM(text);
    await speak(reply);
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * POST /message
 * Body: { text: string }
 * Allows external manual messages to be sent to the LLM.
 */
app.post('/message', async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }
  try {
    const reply = await getResponseFromLLM(text);
    await speak(reply);
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Initialize scheduled auto‑joins (cron definitions are read from schedules.json)
scheduleAutoJoins();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Google‑Meet‑Agent server listening on port ${PORT}`);
});
