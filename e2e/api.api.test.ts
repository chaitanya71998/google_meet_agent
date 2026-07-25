import { test, expect } from '@playwright/test';

const API_BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Health endpoint', () => {
  test('GET /api/health returns running status', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
    expect(typeof body.uptime).toBe('number');
  });
});

test.describe('Auth gating', () => {
  test('GET /api/sessions returns 401 without token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/sessions`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('POST /api/sessions returns 401 without token', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/sessions`, {
      data: { url: 'https://meet.google.com/test' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('Transcript endpoints (no auth)', () => {
  test('POST /api/transcript returns 400 without text', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transcript`, {
      data: { sessionId: 'nonexistent' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/transcript returns 404 for unknown session', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transcript`, {
      data: { text: 'hello', sessionId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /api/transcript-event accepts events', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transcript-event`, {
      data: { kind: 'info', detail: 'started', sessionId: 'any' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('POST /api/audio handles missing sessionId gracefully', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/audio`, {
      data: { data: 'dGVzdA==', mime: 'audio/webm' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

test.describe('Scheduler config', () => {
  test('GET /api/schedules returns 401 without auth', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/schedules`);
    expect(res.status()).toBe(401);
  });
});
