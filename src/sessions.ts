import { Page } from 'puppeteer';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './db.js';
import { logger } from './logger.js';

export type SessionStatus =
  | 'idle'
  | 'joining'
  | 'in-call'
  | 'transcribing'
  | 'error'
  | 'left';

export interface SessionInput {
  userId: string;
  url: string;
  name: string;
  mute: boolean;
  video: boolean;
}

export interface ChatMessageInput {
  sessionId: string;
  userId: string;
  role: 'user' | 'agent';
  text: string;
}

/**
 * Persistence layer backed by Supabase (Postgres).
 *
 * Session metadata + chat messages live in the database (multi-tenant, RLS by
 * user_id). The live Puppeteer `Page` is kept in an in-memory registry because
 * a Chrome tab cannot be serialized — only one agent backend instance owns a
 * given session's browser page.
 */
class SessionStore {
  // In-memory registry of live browser pages, keyed by session id.
  private pages = new Map<string, Page>();

  private sb() {
    return getSupabaseAdmin();
  }

  async create(input: SessionInput): Promise<string> {
    const { data, error } = await this.sb()
      .from('sessions')
      .insert({
        user_id: input.userId,
        url: input.url,
        name: input.name,
        mute: input.mute,
        video: input.video,
        status: 'idle',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`Failed to create session: ${error?.message}`);
    }
    return data.id as string;
  }

  async get(id: string, userId: string) {
    const { data, error } = await this.sb()
      .from('sessions')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async list(userId: string) {
    const { data, error } = await this.sb()
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async update(id: string, userId: string, patch: Record<string, unknown>) {
    const { error } = await this.sb()
      .from('sessions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  async delete(id: string, userId: string) {
    const page = this.pages.get(id);
    if (page) {
      page.close().catch(() => undefined);
      this.pages.delete(id);
    }
    const { error } = await this.sb()
      .from('sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  async addMessage(input: ChatMessageInput) {
    const { error } = await this.sb()
      .from('messages')
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        role: input.role,
        text: input.text,
      });
    if (error) throw new Error(error.message);
  }

  async getMessages(sessionId: string, userId: string) {
    const { data, error } = await this.sb()
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---- In-memory page registry (not persisted) ----

  setPage(id: string, page: Page) {
    this.pages.set(id, page);
  }

  getPage(id: string): Page | null {
    return this.pages.get(id) || null;
  }

  clearPage(id: string) {
    this.pages.delete(id);
  }

  /** Attach a page to a session (used after join). */
  async attachPage(id: string, userId: string, page: Page) {
    this.pages.set(id, page);
    await this.update(id, userId, { status: 'in-call' });
  }
}

export const sessionStore = new SessionStore();
export { randomUUID };
