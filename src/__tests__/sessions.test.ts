import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('../db.js', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
  }),
}));

function mockChain(overrides: Record<string, any> = {}) {
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    ...overrides,
  };
  chain.select.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

function mockSession(overrides = {}) {
  return {
    id: 'session-123',
    user_id: 'user-456',
    url: 'https://meet.google.com/abc-defg-hij',
    name: 'Test Agent',
    mute: true,
    video: false,
    status: 'idle',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SessionStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('creates a session and returns its id', async () => {
      const ch = mockChain();
      ch.single.mockResolvedValue({ data: { id: 'new-session-id' }, error: null });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      const id = await sessionStore.create({
        userId: 'user-1',
        url: 'https://meet.google.com/abc-defg-hij',
        name: 'Agent',
        mute: true,
        video: false,
      });

      expect(id).toBe('new-session-id');
      expect(mockFrom).toHaveBeenCalledWith('sessions');
      expect(ch.insert).toHaveBeenCalledWith({
        user_id: 'user-1',
        url: 'https://meet.google.com/abc-defg-hij',
        name: 'Agent',
        mute: true,
        video: false,
        status: 'idle',
      });
    });

    it('throws on creation error', async () => {
      const ch = mockChain();
      ch.single.mockResolvedValue({ data: null, error: { message: 'DB error' } });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      await expect(sessionStore.create({
        userId: 'user-1',
        url: 'https://meet.google.com/abc-defg-hij',
        name: 'Agent',
        mute: true,
        video: false,
      })).rejects.toThrow('Failed to create session: DB error');
    });
  });

  describe('get', () => {
    it('retrieves a session by id and userId', async () => {
      const ch = mockChain();
      ch.maybeSingle.mockResolvedValue({ data: mockSession(), error: null });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      const session = await sessionStore.get('session-123', 'user-456');

      expect(session).toBeDefined();
      expect(session!.id).toBe('session-123');
      expect(ch.eq).toHaveBeenCalledWith('id', 'session-123');
      expect(ch.eq).toHaveBeenCalledWith('user_id', 'user-456');
    });

    it('throws on error', async () => {
      const ch = mockChain();
      ch.maybeSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      await expect(sessionStore.get('x', 'y')).rejects.toThrow('DB error');
    });
  });

  describe('getById', () => {
    it('retrieves a session by id without userId', async () => {
      const ch = mockChain();
      ch.maybeSingle.mockResolvedValue({ data: mockSession(), error: null });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      const session = await sessionStore.getById('session-123');

      expect(session).toBeDefined();
      expect(session!.id).toBe('session-123');
      expect(ch.eq).toHaveBeenCalledWith('id', 'session-123');
      expect(ch.eq).not.toHaveBeenCalledWith('user_id', expect.any(String));
    });
  });

  describe('list', () => {
    it('lists sessions for a user', async () => {
      const ch = mockChain();
      ch.maybeSingle.mockReset();
      ch.order.mockResolvedValue({ data: [mockSession({ id: 's1' }), mockSession({ id: 's2' })], error: null });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      const list = await sessionStore.list('user-456');

      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('s1');
    });
  });

  describe('update', () => {
    it('updates session fields', async () => {
      const ch = mockChain();
      ch.eq.mockReturnValueOnce(ch).mockResolvedValue({ error: null });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      await sessionStore.update('session-123', 'user-456', { status: 'in-call' });

      expect(ch.update).toHaveBeenCalledWith({
        status: 'in-call',
        updated_at: expect.any(String),
      });
      expect(ch.eq).toHaveBeenCalledWith('id', 'session-123');
      expect(ch.eq).toHaveBeenCalledWith('user_id', 'user-456');
    });
  });

  describe('delete', () => {
    it('deletes a session and closes its page', async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const { sessionStore } = await import('../sessions.js');
      sessionStore.setPage('session-123', { close: closeMock } as any);

      const ch = mockChain();
      ch.eq.mockReturnValueOnce(ch).mockResolvedValue({ error: null });
      mockFrom.mockReturnValue(ch);

      await sessionStore.delete('session-123', 'user-456');
      expect(closeMock).toHaveBeenCalled();
      expect(sessionStore.getPage('session-123')).toBeNull();
    });
  });

  describe('addMessage', () => {
    it('inserts a message', async () => {
      const ch = mockChain();
      ch.insert.mockResolvedValue({ error: null });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      await sessionStore.addMessage({
        sessionId: 'session-123',
        userId: 'user-456',
        role: 'user',
        text: 'Hello',
      });

      expect(ch.insert).toHaveBeenCalledWith({
        session_id: 'session-123',
        user_id: 'user-456',
        role: 'user',
        text: 'Hello',
      });
    });
  });

  describe('getMessages', () => {
    it('retrieves messages for a session', async () => {
      const ch = mockChain();
      ch.order.mockResolvedValue({
        data: [{ id: 'm1', role: 'user', text: 'Hi', created_at: '2026-01-01T00:00:00Z' }],
        error: null,
      });
      mockFrom.mockReturnValue(ch);

      const { sessionStore } = await import('../sessions.js');
      const messages = await sessionStore.getMessages('session-123', 'user-456');

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hi');
    });
  });

  describe('page registry', () => {
    it('stores and retrieves pages', async () => {
      const { sessionStore } = await import('../sessions.js');
      const fakePage = { url: () => 'about:blank' } as any;
      sessionStore.setPage('sid', fakePage);
      expect(sessionStore.getPage('sid')).toBe(fakePage);
      sessionStore.clearPage('sid');
      expect(sessionStore.getPage('sid')).toBeNull();
    });
  });
});
