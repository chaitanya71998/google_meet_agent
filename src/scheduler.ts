import cron from 'node-cron';
import { joinMeet } from './meet.js';
import { startTranscription, startTabAudioCapture } from './audio.js';
import { sessionStore } from './sessions.js';
import { SCHEDULES_FILE } from './config.js';
import fs from 'fs';
import { logger } from './logger.js';

/**
 * Reads the JSON schedule file and registers cron jobs that automatically create
 * a session and join the Meet at the specified times.
 *
 * Scheduled joins are owned by the user configured via SCHEDULER_USER_ID
 * (set it to your Supabase auth user id), since sessions are scoped per-user.
 *
 * Expected format (array of objects):
 * [
 *   { "cron": "0 10 * * MON-FRI", "url": "https://meet.google.com/...", "mute": true, "video": false, "name": "Meet Agent" },
 *   { "cron": "30 14 * * *", "url": "https://meet.google.com/..." }
 * ]
 */
export function scheduleAutoJoins() {
  const owner = process.env.SCHEDULER_USER_ID;
  if (!owner) {
    logger.warn('SCHEDULER_USER_ID not set; skipping auto-join scheduling');
    return;
  }

  let schedules: any[] = [];
  try {
    const raw = fs.readFileSync(SCHEDULES_FILE, 'utf-8');
    schedules = JSON.parse(raw);
  } catch (e) {
    logger.warn('No schedules file or invalid JSON, skipping auto-join scheduling', {
      file: SCHEDULES_FILE,
    });
    return;
  }

  schedules.forEach((job) => {
    if (!job.cron || !job.url) {
      logger.warn('Invalid schedule entry (missing cron or url)', { job });
      return;
    }
    cron.schedule(job.cron, async () => {
      logger.info('Auto-joining Meet (scheduled)', { url: job.url, cron: job.cron });
      try {
        const id = await sessionStore.create({
          userId: owner,
          url: job.url,
          name: job.name || 'Meet Agent',
          mute: job.mute ?? true,
          video: job.video ?? false,
        });
        await sessionStore.update(id, owner, { status: 'joining' });
        const page = await joinMeet(
          job.url,
          { mute: job.mute ?? true, video: job.video ?? false, name: job.name || 'Meet Agent' },
          id,
        );
        sessionStore.setPage(id, page);
        await sessionStore.update(id, owner, { status: 'in-call' });
        await startTranscription(page, id);
        try {
          await startTabAudioCapture(page, id);
        } catch { /* optional */ }
        await sessionStore.update(id, owner, { status: 'transcribing' });
        logger.info('Auto-join successful', { sessionId: id });
      } catch (err) {
        logger.error('Auto-join failed', { error: (err as Error).message });
      }
    });
    logger.info('Scheduled auto-join', { cron: job.cron, url: job.url });
  });
}
