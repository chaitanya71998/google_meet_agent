'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, supabase } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { RequireAuth } from '@/components/RequireAuth';

interface Session {
  id: string;
  url: string;
  name: string;
  mute: boolean;
  video: boolean;
  status: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  at: string;
}

function timeAgo(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Page() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [toast, setToast] = useState('');
  const messagesEnd = useRef<HTMLDivElement>(null);

  async function loadSessions() {
    try {
      const data = (await api('/api/sessions')) as Session[];
      setSessions(data);
    } catch (e: any) {
      if (/Unauthorized|401/.test(e.message)) router.replace('/login');
    }
  }

  async function loadMessages(id: string) {
    try {
      const data = (await api(`/api/sessions/${id}`)) as { messages: Message[] };
      setMessages(data.messages || []);
    } catch {}
  }

  // Initial load + polling
  useEffect(() => {
    if (!user) return;
    loadSessions();
    const t = setInterval(loadSessions, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Realtime: subscribe to sessions + messages changes for this user.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `user_id=eq.${user.id}` }, () => loadSessions())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `user_id=eq.${user.id}` }, (payload: any) => {
        const m = payload.new;
        if (activeId && m.session_id === activeId) {
          setMessages((prev) => [...prev, { id: m.id, role: m.role, text: m.text, at: m.created_at }]);
        } else {
          loadSessions();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeId]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function showToast(msg: string, kind = '') {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    setJoinError('');
    const fd = new FormData(e.target as HTMLFormElement);
    const payload = {
      url: fd.get('url'),
      name: fd.get('name') || 'Meet Agent',
      mute: fd.get('mute') === 'on',
      video: fd.get('video') === 'on',
    };
    try {
      const s = (await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) })) as Session;
      setJoinOpen(false);
      setActiveId(s.id);
      showToast('Joining meeting…', 'success');
      await loadSessions();
    } catch (err: any) {
      setJoinError(err.message);
    }
  }

  async function sendMessage(text: string) {
    if (!activeId || !text.trim()) return;
    try {
      await api(`/api/sessions/${activeId}/message`, { method: 'POST', body: JSON.stringify({ text }) });
      await loadMessages(activeId);
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function leave(id: string) {
    try {
      await api(`/api/sessions/${id}/leave`, { method: 'POST' });
      showToast('Left meeting', 'success');
      await loadSessions();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  const active = sessions.find((s) => s.id === activeId);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <div className="brand"><span className="logo">●</span> Google Meet Agent</div>
        <button className="ghost-btn" onClick={async () => { await supabase.auth.signOut(); router.replace('/login'); }}>
          {user?.email} · Sign out
        </button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Sessions</h2>
            <button className="icon-btn" onClick={loadSessions}>⟳</button>
          </div>
          <button className="primary-btn full" onClick={() => setJoinOpen(true)}>+ Join a Meeting</button>
          <ul className="session-list">
            {sessions.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>No sessions yet</li>}
            {sessions.map((s) => (
              <li key={s.id} className={'session-item' + (s.id === activeId ? ' active' : '')} onClick={() => setActiveId(s.id)}>
                <div className="url">{s.url}</div>
                <div className="meta">
                  <span className={'badge ' + s.status}>{s.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="content">
          {!active ? (
            <div className="detail empty-state">
              <div className="empty-illustration">🎙️</div>
              <h2>Select or start a meeting</h2>
              <p>Join a Google Meet and let the agent listen, respond, and speak on your behalf.</p>
            </div>
          ) : (
            <div className="detail chat">
              <div className="chat-head">
                <div className="info">
                  <div className="title">{active.url}</div>
                  <div className="sub">{active.name} · <span className={'badge ' + active.status}>{active.status}</span> · {active.mute ? 'muted' : 'unmuted'} · {active.video ? 'camera on' : 'camera off'}</div>
                </div>
                <button className="ghost-btn" onClick={() => leave(active.id)}>Leave</button>
              </div>
              <div className="messages">
                {messages.map((m) => (
                  <div key={m.id} className={'msg ' + m.role}>
                    {m.text}
                    <span className="time">{timeAgo(m.at)}</span>
                  </div>
                ))}
                <div ref={messagesEnd} />
              </div>
              <Composer onSend={sendMessage} />
            </div>
          )}
        </section>
      </div>

      {joinOpen && (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-head">
              <h2>Join a Meeting</h2>
              <button className="icon-btn" onClick={() => setJoinOpen(false)}>✕</button>
            </div>
            <form onSubmit={onJoin}>
              <label>Google Meet URL
                <input type="url" name="url" placeholder="https://meet.google.com/xxx-xxxx-xxx" required />
              </label>
              <label>Display name
                <input type="text" name="name" defaultValue="Meet Agent" maxLength={60} />
              </label>
              <div className="row">
                <label className="checkbox"><input type="checkbox" name="mute" defaultChecked /> Start muted</label>
                <label className="checkbox"><input type="checkbox" name="video" /> Enable camera</label>
              </div>
              {joinError && <div className="form-error">{joinError}</div>}
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setJoinOpen(false)}>Cancel</button>
                <button type="submit" className="primary-btn">Join</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={'toast ' + (toast.includes('error') ? 'error' : 'success')}>{toast}</div>}
    </div>
  );
}

function Composer({ onSend }: { onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    onSend(t);
  }
  return (
    <form className="composer" onSubmit={submit}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message for the agent to say…" />
      <button type="submit" className="primary-btn">Send</button>
    </form>
  );
}
