import { Page } from 'puppeteer';
import fetch from 'node-fetch';
import { logger } from './logger.js';

const BACKEND_BASE = process.env.BACKEND_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Injects a SpeechRecognition script into the Meet page that captures spoken words
 * and forwards them to the backend `/api/transcript` endpoint along with the session id.
 *
 * IMPORTANT: the in-page script is passed as a STRING to page.evaluate so the
 * tsx/esbuild transform does NOT inject a `__name()` helper (which does not exist
 * in the browser context and throws "__name is not defined").
 */
export async function startTranscription(page: Page, sessionId: string): Promise<void> {
  await page.exposeFunction('__sendTranscript', async (text: string) => {
    try {
      await fetch(`${BACKEND_BASE}/api/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId }),
      });
    } catch (e) {
      logger.error('Failed to send transcript', { error: (e as Error).message, sessionId });
    }
  });

  await page.exposeFunction('__transcriptEvent', async (kind: string, detail: string) => {
    logger.info('Transcript recognizer event', { kind, detail, sessionId });
    if (kind === 'error' || kind === 'end') {
      try {
        await fetch(`${BACKEND_BASE}/api/transcript-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, detail, sessionId }),
        });
      } catch { /* ignore */ }
    }
  });

  const script = `
    (function () {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        window.__transcriptEvent('error', 'SpeechRecognition API not available in this browser');
        return;
      }
      var recognizer = new SpeechRecognition();
      recognizer.continuous = true;
      recognizer.interimResults = false;
      recognizer.lang = 'en-US';
      var stopped = false;
      var starting = false;
      var benign = { 'no-speech': 1, 'aborted': 1, 'audio-capture': 1 };
      function safeStart() {
        if (stopped || starting) return;
        starting = true;
        try { recognizer.start(); } catch (e) {
          var msg = (e && e.message) || '';
          if (!/already started|invalidstate/i.test(msg)) {
            window.__transcriptEvent('error', msg || 'start failed');
          }
        } finally { starting = false; }
      }
      recognizer.onresult = function (event) {
        for (var i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            var transcript = event.results[i][0].transcript.trim();
            if (transcript) window.__sendTranscript(transcript);
          }
        }
      };
      recognizer.onerror = function (e) {
        var err = (e && e.error) || 'unknown';
        if (!benign[err]) window.__transcriptEvent('error', err);
        if (benign[err]) setTimeout(safeStart, 300);
      };
      recognizer.onend = function () {
        if (!stopped) setTimeout(safeStart, 200);
      };
      try { recognizer.start(); } catch (e) {
        window.__transcriptEvent('error', (e && e.message) || 'start failed');
      }
      window.__stopTranscription = function () {
        stopped = true;
        try { recognizer.stop(); } catch (e) {}
      };
    })();
  `;
  await page.evaluate(script);

  logger.info('Transcription started', { sessionId });
}

const BACKEND_AUDIO = process.env.BACKEND_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Captures the Meet tab's actual audio output via getDisplayMedia (audio only)
 * and streams it to the backend /api/audio endpoint for transcription. This lets
 * the agent "hear" all participants (not just the local mic).
 *
 * The script is passed as a STRING (see note in startTranscription) to avoid the
 * "__name is not defined" transform artifact.
 */
export async function startTabAudioCapture(page: Page, sessionId: string): Promise<void> {
  await page.exposeFunction('__sendAudioChunk', async (b64: string, mime: string) => {
    try {
      await fetch(`${BACKEND_AUDIO}/api/audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, mime, sessionId }),
      });
    } catch (e) {
      logger.error('Failed to send audio chunk', { error: (e as Error).message, sessionId });
    }
  });

  const script = `
    (function () {
      var CHUNK_MS = 8000;
      function b64from(buf) {
        var bytes = new Uint8Array(buf);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }
      (async function () {
        var md = navigator.mediaDevices;
        var stream = null;
        try {
          stream = await md.getDisplayMedia({ audio: true });
        } catch (e) {
          try { stream = await md.getDisplayMedia({ video: true, audio: true }); }
          catch (e2) {
            window.__transcriptEvent('error', 'tab-audio: ' + ((e2 && e2.message) || 'denied'));
            return;
          }
        }
        var audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) {
          window.__transcriptEvent('error', 'tab-audio: no audio track (share with audio)');
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        var audioStream = new MediaStream(audioTracks);
        var recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
        recorder.ondataavailable = async function (ev) {
          if (!ev.data || !ev.data.size) return;
          var buf = await ev.data.arrayBuffer();
          window.__sendAudioChunk(b64from(buf), ev.data.type || 'audio/webm');
        };
        recorder.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); };
        recorder.start(CHUNK_MS);
        window.__transcriptEvent('info', 'tab-audio: recording started');
      })();
    })();
  `;
  await page.evaluate(script);

  logger.info('Tab audio capture requested', { sessionId });
}
