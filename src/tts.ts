import { sessionStore } from './sessions.js';
import { logger } from './logger.js';

/**
 * Speak the given text inside the Meet page of the given session using the
 * browser's SpeechSynthesis API. Silently returns if the session/page is gone.
 */
export async function speak(text: string, sessionId?: string): Promise<void> {
  const page = sessionId ? sessionStore.getPage(sessionId) : null;
  if (!page) {
    logger.warn('No active Meet page to speak from', { sessionId });
    return;
  }
  try {
    await page.evaluate(`(function (msg) {
      var utter = new SpeechSynthesisUtterance(msg);
      speechSynthesis.speak(utter);
    })`, text);
  } catch (e) {
    logger.error('Failed to speak inside Meet page', { error: (e as Error).message, sessionId });
  }
}
