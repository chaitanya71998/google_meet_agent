const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = { sessions: [], activeId: null };
const POLL_MS = 3000;

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  setTimeout(() => el.classList.add('hidden'), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server returned a non-JSON response (got HTML?). Path: ' + path);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function timeAgo(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadStatus() {
  try {
    await api('/api/status');
    $('#server-status').dataset.state = 'up';
    $('#server-status .label').textContent = 'Online';
  } catch {
    $('#server-status').dataset.state = 'down';
    $('#server-status .label').textContent = 'Offline';
  }
}

async function loadSessions() {
  try {
    const sessions = await api('/api/sessions');
    state.sessions = sessions;
    renderSessions();
    if (state.activeId) {
      const s = sessions.find((x) => x.id === state.activeId);
      if (s) {
        updateDetailStatus(s);
        loadSessionMessages(s.id);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

function renderSessions() {
  const list = $('#session-list');
  if (!state.sessions.length) {
    list.innerHTML = '<li class="empty">No active sessions</li>';
    return;
  }
  list.innerHTML = '';
  for (const s of state.sessions) {
    const li = document.createElement('li');
    li.className = 'session-item' + (s.id === state.activeId ? ' active' : '');
    li.innerHTML = `
      <div class="url">${escapeHtml(s.url)}</div>
      <div class="meta">
        <span class="badge ${s.status}">${s.status}</span>
        <span style="font-size:11px;color:var(--muted)">${s.messageCount} msgs</span>
      </div>`;
    li.addEventListener('click', () => {
      state.activeId = s.id;
      renderSessions();
      renderDetail();
    });
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateDetailStatus(session) {
  const badge = document.querySelector('#detail .badge');
  const sub = document.querySelector('#detail .sub');
  if (badge) {
    badge.className = 'badge ' + session.status;
    badge.textContent = session.status;
  }
  if (sub) {
    sub.innerHTML = `${escapeHtml(session.name)} · <span class="badge ${session.status}">${session.status}</span> · ${session.mute ? 'muted' : 'unmuted'} · ${session.video ? 'camera on' : 'camera off'}`;
  }
}

function renderDetail() {
  const detail = $('#detail');
  const session = state.sessions.find((s) => s.id === state.activeId);
  if (!session) {
    detail.className = 'detail empty-state';
    detail.innerHTML = `<div class="empty-illustration">🎙️</div><h2>Select or start a meeting</h2><p>Join a Google Meet and let the agent listen, respond, and speak on your behalf.</p>`;
    return;
  }

  detail.className = 'detail chat';
  detail.innerHTML = `
    <div class="chat-head">
      <div class="info">
        <div class="title">${escapeHtml(session.url)}</div>
        <div class="sub">${escapeHtml(session.name)} · <span class="badge ${session.status}">${session.status}</span> · ${session.mute ? 'muted' : 'unmuted'} · ${session.video ? 'camera on' : 'camera off'}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="ghost-btn" id="leave-btn">Leave</button>
        <button class="icon-btn" id="refresh-detail" title="Refresh">⟳</button>
      </div>
    </div>
    <div class="messages" id="messages"></div>
    <form class="composer" id="composer">
      <input type="text" id="composer-input" placeholder="Type a message for the agent to say…" autocomplete="off" />
      <button type="submit" class="primary-btn">Send</button>
    </form>`;

  $('#leave-btn').addEventListener('click', async () => {
    try {
      await api(`/api/sessions/${session.id}/leave`, { method: 'POST' });
      toast('Left meeting', 'success');
      loadSessions();
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#refresh-detail').addEventListener('click', () => loadSessionMessages(session.id));

  $('#composer').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = $('#composer-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await api(`/api/sessions/${session.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      loadSessionMessages(session.id);
    } catch (e) { toast(e.message, 'error'); }
  });

  loadSessionMessages(session.id);
}

async function loadSessionMessages(id) {
  try {
    const session = await api(`/api/sessions/${id}`);
    const box = $('#messages');
    if (!box) return;
    box.innerHTML = '';
    for (const m of session.messages) {
      const div = document.createElement('div');
      div.className = 'msg ' + m.role;
      div.innerHTML = `${escapeHtml(m.text)}<span class="time">${timeAgo(m.at)}</span>`;
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  } catch (e) { console.error(e); }
}

// ---- Modal ----
function openModal() { $('#join-modal').classList.remove('hidden'); $('#join-error').classList.add('hidden'); }
function closeModal() { $('#join-modal').classList.add('hidden'); }

$('#open-join-modal').addEventListener('click', openModal);
$('#close-join-modal').addEventListener('click', closeModal);
$('#cancel-join').addEventListener('click', closeModal);

$('#join-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const errEl = $('#join-error');
  errEl.classList.add('hidden');
  const fd = new FormData(ev.target);
  const payload = {
    url: fd.get('url'),
    name: fd.get('name'),
    mute: fd.get('mute') === 'on',
    video: fd.get('video') === 'on',
  };
  const submit = $('#join-submit');
  submit.disabled = true;
  submit.textContent = 'Joining…';
  try {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) });
    toast('Joining meeting…', 'success');
    closeModal();
    state.activeId = session.id;
    await loadSessions();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Join';
  }
});

$('#refresh-btn').addEventListener('click', loadSessions);

// ---- Boot ----
loadStatus();
loadSessions();
setInterval(() => { loadStatus(); loadSessions(); }, POLL_MS);
