import { Page } from 'puppeteer';
import fetch from 'node-fetch';

/**
 * Injects a SpeechRecognition script into the Meet page that captures spoken words
 * and forwards them to the backend `/transcript` endpoint.
 *
 * This runs in the context of the Chromium tab.
 */
export async function startTranscription(page: Page): Promise<void> {
  await page.exposeFunction('sendTranscript', async (text: string) => {
    try {
      await fetch('http://localhost:3000/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.error('Failed to send transcript', e);
    }
  });

  await page.evaluate(() => {
    // @ts-ignore – SpeechRecognition may not be globally typed
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported in this browser context');
      return;
    }
    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = 'en-US';
    recognizer.onresult = (event: any) => { // using any to avoid typings
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          // @ts-ignore – the exposed function is available globally
          (window as any).sendTranscript(transcript);
        }
      }
    };
    recognizer.onerror = (e: any) => console.error('SpeechRecognition error', e);
    recognizer.start();
  });
}
