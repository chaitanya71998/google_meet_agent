import { getPage } from './pageHolder.js';

/**
 * Speak the given text inside the active Meet page using the browser's SpeechSynthesis API.
 * If no page is currently set, the function silently returns.
 */
export async function speak(text: string): Promise<void> {
  const page = getPage();
  if (!page) {
    console.warn('No active Meet page to speak from');
    return;
  }
  try {
    await page.evaluate((msg: string) => {
      const utter = new SpeechSynthesisUtterance(msg);
      // You can customize voice, rate, pitch here if desired
      speechSynthesis.speak(utter);
    }, text);
  } catch (e) {
    console.error('Failed to speak inside Meet page', e);
  }
}
