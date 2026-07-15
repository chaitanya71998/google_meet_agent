import cron from 'node-cron';
import { joinMeet } from './meet.js';
import { startTranscription } from './audio.js';
import { setPage } from './pageHolder.js';
import { SCHEDULES_FILE } from './config.js';
import fs from 'fs';

/**
 * Reads the JSON schedule file and registers cron jobs that will automatically
 * invoke the /join flow at the specified times.
 *
 * Expected format (array of objects):
 * [
 *   { "cron": "0 10 * * MON-FRI", "url": "https://meet.google.com/...", "mute": true, "video": false },
 *   { "cron": "30 14 * * *", "url": "https://meet.google.com/..." }
 * ]
 */
export function scheduleAutoJoins() {
  let schedules: any[] = [];
  try {
    const raw = fs.readFileSync(SCHEDULES_FILE, 'utf-8');
    schedules = JSON.parse(raw);
  } catch (e) {
    console.warn('No schedules file or invalid JSON, skipping auto‑join scheduling');
    return;
  }

  schedules.forEach((job) => {
    if (!job.cron || !job.url) {
      console.warn('Invalid schedule entry (missing cron or url):', job);
      return;
    }
    cron.schedule(job.cron, async () => {
      console.log(`Auto‑joining Meet at ${new Date().toISOString()} – ${job.url}`);
      try {
        const page = await joinMeet(job.url, { mute: job.mute ?? true, video: job.video ?? false });
        setPage(page);
        await startTranscription(page);
        console.log('Auto‑join successful');
      } catch (err) {
        console.error('Auto‑join failed', err);
      }
    });
    console.log(`Scheduled auto‑join: cron='${job.cron}' url='${job.url}'`);
  });
}
