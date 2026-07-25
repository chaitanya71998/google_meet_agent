import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../meet.js', () => ({
  joinMeet: vi.fn().mockResolvedValue({
    url: () => 'about:blank',
    evaluate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../audio.js', () => ({
  startTranscription: vi.fn().mockResolvedValue(undefined),
  startTabAudioCapture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../llm.js', () => ({
  getResponseFromLLM: vi.fn().mockResolvedValue('Mock LLM reply'),
}));

vi.mock('../stt.js', () => ({
  transcribeAudio: vi.fn().mockResolvedValue('transcribed text'),
}));

vi.mock('../tts.js', () => ({
  speak: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../scheduler.js', () => ({
  scheduleAutoJoins: vi.fn(),
}));

const mockSessions: Record<string, any> = {};
let nextId = 1;

vi.mock('../sessions.js', async () => {
  const actual = await vi.importActual('../sessions.js');
  const SessionStore = actual.SessionStore || actual.sessionStore?.constructor;
  return {
    sessionStore: {
      create: vi.fn(async (input: any) => {
        const id = `test-session-${nextId++}`;
        mockSessions[id] = {
          id,
          user_id: input.userId,
          url: input.url,
          name: input.name,
          mute: input.mute,
          video: input.video,
          status: 'idle',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return id;
      }),
      get: vi.fn(async (id: string, userId: string) => {
        const s = mockSessions[id];
        if (!s || s.user_id !== userId) return null;
        return s;
      }),
      getById: vi.fn(async (id: string) => {
        return mockSessions[id] || null;
      }),
      list: vi.fn(async (userId: string) => {
        return Object.values(mockSessions).filter((s: any) => s.user_id === userId);
      }),
      update: vi.fn(async (id: string, _userId: string, patch: any) => {
        if (mockSessions[id]) {
          mockSessions[id] = { ...mockSessions[id], ...patch, updated_at: new Date().toISOString() };
        }
      }),
      delete: vi.fn(async (id: string, _userId: string) => {
        delete mockSessions[id];
      }),
      addMessage: vi.fn(async (input: any) => {
        return { id: `msg-${Date.now()}` };
      }),
      getMessages: vi.fn(async (sessionId: string, _userId: string) => {
        return [];
      }),
      setPage: vi.fn(),
      getPage: vi.fn(() => null),
      clearPage: vi.fn(),
      attachPage: vi.fn(),
    },
    randomUUID: actual.randomUUID,
  };
});

vi.mock('../auth.js', () => ({
  verifyToken: vi.fn(async (token: string | undefined) => {
    if (token === 'valid-token') {
      return { id: 'test-user-id', email: 'test@example.com' };
    }
    if (token === 'other-user-token') {
      return { id: 'other-user-id', email: 'other@example.com' };
    }
    return null;
  }),
  extractBearer: vi.fn((req: any) => {
    const h = req.headers.authorization;
    if (!h) return undefined;
    return h.startsWith('Bearer ') ? h.slice(7) : undefined;
  }),
}));

vi.mock('../db.js', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn(),
  }),
  getSupabaseAnon: () => ({
    auth: { getUser: vi.fn() },
  }),
}));

vi.mock('../config.js', () => ({
  SCHEDULES_FILE: '/tmp/test-schedules.json',
  OPENROUTER_API_KEY: 'test-key',
  OPENROUTER_MODEL: 'test-model',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  PORT: 0,
  BACKEND_BASE_URL: 'http://localhost:0',
}));

describe('API Server', () => {
  let app: express.Express;

  beforeAll(async () => {
    for (const key of Object.keys(mockSessions)) {
      delete mockSessions[key];
    }
    nextId = 1;
    const serverModule = await import('../server.js');
    app = (serverModule as any).app;
  });

  describe('GET /api/health', () => {
    it('returns 200 with status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('running');
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Authenticated routes', () => {
    it('returns 401 without auth token', async () => {
      const res = await request(app).get('/api/sessions');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/sessions')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });

    describe('with valid auth', () => {
      const auth = { Authorization: 'Bearer valid-token' };

      it('GET /api/sessions returns empty list initially', async () => {
        const res = await request(app).get('/api/sessions').set(auth);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('POST /api/sessions creates a session', async () => {
        const res = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://meet.google.com/abc-defg-hij' });
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.status).toBe('joining');
      });

      it('POST /api/sessions rejects invalid URLs', async () => {
        const res = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://evil.com' });
        expect(res.status).toBe(400);
      });

      it('POST /api/sessions rejects non-https URLs', async () => {
        const res = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'http://meet.google.com/abc' });
        expect(res.status).toBe(400);
      });

      it('GET /api/sessions lists sessions after creation', async () => {
        const res = await request(app).get('/api/sessions').set(auth);
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
      });

      it('GET /api/sessions/:id returns session details', async () => {
        const createRes = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://meet.google.com/xyz-uvw-rst' });
        const id = createRes.body.id;

        const res = await request(app).get(`/api/sessions/${id}`).set(auth);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
        expect(res.body.url).toBe('https://meet.google.com/xyz-uvw-rst');
        expect(res.body.messages).toEqual([]);
      });

      it('GET /api/sessions/:id returns 404 for other user session', async () => {
        const createRes = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://meet.google.com/aaa-bbb-ccc' });

        const res = await request(app)
          .get(`/api/sessions/${createRes.body.id}`)
          .set('Authorization', 'Bearer other-user-token');
        expect(res.status).toBe(404);
      });

      it('POST /api/sessions/:id/leave leaves a session', async () => {
        const createRes = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://meet.google.com/leave-test' });
        const id = createRes.body.id;

        const res = await request(app).post(`/api/sessions/${id}/leave`).set(auth);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('left');
      });

      it('POST /api/sessions/:id/message sends a message to LLM', async () => {
        const createRes = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://meet.google.com/msg-test' });
        const id = createRes.body.id;

        const res = await request(app)
          .post(`/api/sessions/${id}/message`)
          .set(auth)
          .send({ text: 'Hello agent' });
        expect(res.status).toBe(200);
        expect(res.body.reply).toBe('Mock LLM reply');
      });

      it('DELETE /api/sessions/:id deletes a session', async () => {
        const createRes = await request(app)
          .post('/api/sessions')
          .set(auth)
          .send({ url: 'https://meet.google.com/del-test' });
        const id = createRes.body.id;

        const res = await request(app).delete(`/api/sessions/${id}`).set(auth);
        expect(res.status).toBe(204);
      });
    });
  });

  describe('Unauthenticated transcript/audio endpoints', () => {
    it('POST /api/transcript returns 400 without text', async () => {
      const res = await request(app)
        .post('/api/transcript')
        .send({ sessionId: 'nonexistent' });
      expect(res.status).toBe(400);
    });

    it('POST /api/transcript returns 400 without sessionId', async () => {
      const res = await request(app)
        .post('/api/transcript')
        .send({ text: 'hello' });
      expect(res.status).toBe(400);
    });

    it('POST /api/transcript returns 404 for unknown session', async () => {
      const res = await request(app)
        .post('/api/transcript')
        .send({ text: 'hello', sessionId: 'nonexistent' });
      expect(res.status).toBe(404);
    });

    it('POST /api/transcript works for valid session', async () => {
      const createRes = await request(app)
        .post('/api/sessions')
        .set('Authorization', 'Bearer valid-token')
        .send({ url: 'https://meet.google.com/transcript-e2e' });

      const authModule = await import('../auth.js');
      vi.mocked(authModule.verifyToken).mockResolvedValue({ id: 'test-user-id', email: 'test@example.com' });

      const res = await request(app)
        .post('/api/transcript')
        .send({ text: 'Hello from browser', sessionId: createRes.body.id });
      expect(res.status).toBe(200);
      expect(res.body.reply).toBe('Mock LLM reply');
    });

    it('POST /api/transcript-event handles events gracefully', async () => {
      const res = await request(app)
        .post('/api/transcript-event')
        .send({ kind: 'info', detail: 'started', sessionId: 'any' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('POST /api/audio handles missing sessionId gracefully', async () => {
      const res = await request(app)
        .post('/api/audio')
        .send({ data: 'base64data', mime: 'audio/webm' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
