'use strict';

// ── State ─────────────────────────────────────────────────────────
let chatHistory   = [];
let isCopilotBusy = false;
let currentView   = 'emails';

// ── Clock ─────────────────────────────────────────────────────────
function tick() {
  const now = new Date();
  const el  = document.getElementById('clock');
  if (el) el.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tick, 1000);
tick();

// ── Safe API fetch ────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// ── XSS-safe HTML escaping (all 5 chars) ─────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── User ──────────────────────────────────────────────────────────
let currentUserName = 'there';

async function loadUser() {
  try {
    const u = await api('/auth/me');
    currentUserName = u.name?.split(' ')[0] || u.email?.split('@')[0] || 'there';
    const el = document.getElementById('chip-user');
    if (el) el.textContent = u.name || u.email;
    injectGreeting();
  } catch {
    const el = document.getElementById('chip-user');
    if (el) el.textContent = 'Not signed in';
    injectGreeting();
  }
}

// ── Health ────────────────────────────────────────────────────────
async function loadHealth() {
  try {
    const h  = await api('/health');
    const el = document.getElementById('chip-health');
    if (!el) return;
    if (h.status === 'ok') {
      el.textContent = '● All systems ok';
      el.className   = 'chip ok';
    } else {
      el.textContent = '● Degraded';
      el.className   = 'chip err';
    }
    const model = document.getElementById('chip-model');
    if (model) model.textContent = `Groq · ${h.model || 'Llama'}`;
  } catch {
    const el = document.getElementById('chip-health');
    if (el) { el.textContent = '● Offline'; el.className = 'chip err'; }
  }
}

// ── Metrics ───────────────────────────────────────────────────────
async function loadMetrics() {
  try {
    const d = await api('/api/analytics/overview');

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    const total = d.emails?.total ?? 0;
    set('m-emails',    total);
    set('m-emails-24h', `+${d.emails?.last_24h ?? 0} today`);
    set('m-meetings',  d.calendar?.ai_scheduled ?? 0);

    const tok = parseInt(d.tokens?.total_tokens || 0);
    set('m-tokens',  tok > 1000 ? `${(tok / 1000).toFixed(1)}k` : tok || '0');
    set('m-latency', d.tokens?.avg_latency_ms ? `${d.tokens.avg_latency_ms}ms` : '—');
    set('m-jobs',    d.jobs?.completed ?? 0);

    const fail = d.jobs?.failed;
    set('m-jobs-fail', fail ? `${fail} failed` : '');
    set('email-badge', total);

    // Update inbox score bar
    const triaged = d.emails?.triaged ?? 0;
    const pct     = total > 0 ? Math.round((triaged / total) * 100) : 0;
    const scoreEl = document.getElementById('inbox-score-val');
    const barEl   = document.getElementById('inbox-score-bar');
    if (scoreEl) scoreEl.textContent = `${pct}%`;
    if (barEl)   barEl.style.width   = `${pct}%`;

    // Update donut chart
    updateDonut(d.emails);
  } catch (e) { console.error('[metrics]', e.message); }
}

// ── Donut chart (SVG) ─────────────────────────────────────────────
function updateDonut(emails = {}) {
  const canvas = document.getElementById('donut-canvas');
  if (!canvas) return;

  const urgent     = emails.urgent     ?? 0;
  const meetings   = emails.meetings   ?? 0;
  const triaged    = (emails.triaged   ?? 0) - urgent - meetings;
  const pending    = emails.pending    ?? 0;
  const total      = emails.total      ?? 0;

  if (total === 0) { canvas.innerHTML = '<text x="50" y="56" text-anchor="middle" fill="#444" font-size="10" font-family="monospace">No data</text>'; return; }

  const segments = [
    { val: urgent,           color: '#e85555', label: 'Urgent' },
    { val: meetings,         color: '#4d87f5', label: 'Meeting' },
    { val: Math.max(triaged, 0), color: '#27c992', label: 'Triaged' },
    { val: pending,          color: '#333',    label: 'Pending' },
  ].filter(s => s.val > 0);

  const cx = 50, cy = 50, r = 36, stroke = 10;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  let arcs = segments.map(s => {
    const dash = (s.val / total) * circumference;
    const arc  = `<circle cx="${cx}" cy="${cy}" r="${r}"
      fill="none" stroke="${s.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash} ${circumference - dash}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
    return arc;
  }).join('');

  canvas.innerHTML = `
    ${arcs}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="#fff" font-size="14" font-weight="700" font-family="monospace">${total}</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="#555" font-size="8" font-family="monospace">EMAILS</text>`;
}

// ── Email list ────────────────────────────────────────────────────
const TAG_MAP = {
  urgent:     ['U', '#e85555', '#1a0505'],
  meeting:    ['M', '#4d87f5', '#050d1a'],
  newsletter: ['N', '#27c992', '#020f09'],
  info:       ['I', '#9270f0', '#0a0520'],
  action:     ['A', '#e8a020', '#150a00'],
  spam:       ['S', '#555',    '#111'],
};

function avatarBg(name = '') {
  const palette = ['#0d1a2e','#1a0d2e','#0d2e1a','#2e1a0d','#1a2e0d'];
  const fglist  = ['#4d87f5','#9270f0','#27c992','#e8a020','#60c060'];
  const i = (name.charCodeAt(0) || 0) % palette.length;
  return [palette[i], fglist[i]];
}

function initials(n = '') { return n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?'; }

async function loadEmails() {
  const list = document.getElementById('email-list');
  if (!list) return;
  try {
    const data = await api('/api/emails?limit=40');
    const emails = data.emails || [];

    if (!emails.length) {
      list.innerHTML = '<div class="empty">No emails yet.<br>Click Sync to connect Gmail.</div>';
      updateSummaryBar([], 0);
      return;
    }

    list.innerHTML = emails.map(e => {
      const [bg, fg] = avatarBg(e.from_name || e.from_address || '');
      const [tagChar, tagFg, tagBg] = TAG_MAP[e.triage_label] || ['·', '#555', '#111'];
      const time = e.received_at
        ? new Date(e.received_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '';
      const isUrgent = e.triage_label === 'urgent';

      return `<div class="email-row${isUrgent ? ' urgent' : ''}">
        <div class="email-av" style="background:${bg};color:${fg}">${esc(initials(e.from_name))}</div>
        <div class="email-body">
          <div class="email-top">
            <span class="email-from">${esc(e.from_name || e.from_address || '—')}</span>
            <span class="email-time">${esc(time)}</span>
          </div>
          <div class="email-subject">${esc(e.subject || '(no subject)')}</div>
          <div class="email-preview">${esc(e.triage_summary || e.snippet || '')}</div>
        </div>
        <div class="tag" style="background:${tagBg};color:${tagFg}">${tagChar}</div>
      </div>`;
    }).join('');

    updateSummaryBar(emails, data.total || emails.length);
  } catch (e) {
    list.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
  }
}

function updateSummaryBar(emails, total) {
  const urgent   = emails.filter(e => e.triage_label === 'urgent').length;
  const meetings = emails.filter(e => e.triage_label === 'meeting').length;
  const pending  = emails.filter(e => e.status === 'pending').length;
  const el = document.getElementById('ai-summary-text');
  if (el) el.textContent = total
    ? `${urgent} urgent · ${meetings} meeting request${meetings !== 1 ? 's' : ''} · ${pending} pending triage`
    : 'No emails — connect Gmail and sync.';
}

// ── Calendar ──────────────────────────────────────────────────────
const BAR_COLORS = ['#4d87f5','#e8a020','#e85555','#9270f0','#27c992'];

async function loadCalendar() {
  const list = document.getElementById('calendar-list');
  if (!list) return;
  try {
    const events = await api('/api/calendar');
    if (!events.length) {
      list.innerHTML = '<div class="empty">No upcoming events.</div>';
      return;
    }
    list.innerHTML = events.slice(0, 6).map((e, i) => {
      const t   = new Date(e.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const att = Array.isArray(e.attendees) ? e.attendees.length : 0;
      return `<div class="cal-row">
        <div class="cal-stripe" style="background:${BAR_COLORS[i % 5]}"></div>
        <div class="cal-info">
          <div class="cal-title">${esc(e.title)}</div>
          <div class="cal-meta">${esc(t)} · ${att} attendee${att !== 1 ? 's' : ''}${e.ai_scheduled ? ' · AI' : ''}</div>
        </div>
        <div class="cal-status ${e.status}">${esc(e.status)}</div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
  }
}

// ── Audit ─────────────────────────────────────────────────────────
const logColor = a => /FAIL|ERROR/.test(a) ? '#e85555' : /LOGIN|AUTH/.test(a) ? '#9270f0' : /TRIAGE|AI/.test(a) ? '#4d87f5' : /SYNC|CAL/.test(a) ? '#27c992' : '#e8a020';

async function loadAudit() {
  const list = document.getElementById('audit-list');
  if (!list) return;
  try {
    const logs = await api('/api/analytics/audit?limit=25');
    if (!logs.length) { list.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
    list.innerHTML = logs.map(l => {
      const t = new Date(l.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      return `<div class="log-row">
        <div class="log-dot" style="background:${logColor(l.action)}"></div>
        <div class="log-ts">${esc(t)}</div>
        <div class="log-msg"><span>${esc(l.actor)}</span> ${esc(l.action)}</div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
  }
}

// ── Sync ──────────────────────────────────────────────────────────
async function triggerSync() {
  const btn = document.getElementById('sync-btn');
  if (!btn) return;
  btn.textContent = '↻ Syncing…';
  btn.disabled    = true;
  try {
    await Promise.all([
      fetch('/api/emails/sync',   { method: 'POST' }).catch(() => {}),
      fetch('/api/calendar/sync', { method: 'POST' }).catch(() => {})
    ]);
    await Promise.all([loadEmails(), loadCalendar(), loadMetrics()]);
  } finally {
    btn.textContent = '↻ Sync';
    btn.disabled    = false;
  }
}

// ── View switch ───────────────────────────────────────────────────
function switchView(view, el) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  const title = document.getElementById('left-title');
  if (title) title.textContent =
    view === 'emails' ? 'Email Triage' : view === 'calendar' ? 'Calendar' : view === 'jobs' ? 'Job Queue' : 'Audit Log';
  if (view === 'emails') loadEmails();
}

// ── ARIA Copilot ──────────────────────────────────────────────────
function injectGreeting() {
  const hour   = new Date().getHours();
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const date   = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateEl = document.getElementById('copilot-date');
  if (dateEl) dateEl.textContent = date;
  appendAria(`Good ${period}, ${currentUserName}.\n\nI have access to your inbox, calendar, and activity log.\n\nAsk me to summarise your day, find urgent emails, or draft a reply.`);
}

function appendAria(text, actions = []) {
  const msgs = document.getElementById('copilot-messages');
  if (!msgs) return;

  const wrap   = document.createElement('div');
  wrap.className = 'msg-aria';

  const label  = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'ARIA';

  const bubble = document.createElement('div');
  bubble.className  = 'msg-aria-bubble';
  bubble.textContent = text;

  wrap.appendChild(label);
  wrap.appendChild(bubble);

  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'msg-actions';
    actions.forEach(a => {
      const b       = document.createElement('button');
      b.className   = `action-btn ${a.type}`;
      b.textContent = a.label;
      b.addEventListener('click', () => handleCopilotAction(a));
      row.appendChild(b);
    });
    wrap.appendChild(row);
  }

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendUser(text) {
  const msgs = document.getElementById('copilot-messages');
  if (!msgs) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg-user';
  wrap.innerHTML = `<div class="msg-user-bubble">${esc(text)}</div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function showThinking() {
  const msgs = document.getElementById('copilot-messages');
  if (!msgs) return null;
  const el = document.createElement('div');
  el.className = 'msg-aria';
  el.id        = 'thinking';
  el.innerHTML = `<div class="msg-label">ARIA</div><div class="msg-thinking"><span></span><span></span><span></span></div>`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

async function sendMessage() {
  const input = document.getElementById('copilot-input');
  const send  = document.getElementById('copilot-send');
  if (!input || !send) return;

  const msg = input.value.trim();
  if (!msg || isCopilotBusy) return;

  isCopilotBusy      = true;
  send.disabled      = true;
  input.disabled     = true;
  input.value        = '';

  appendUser(msg);
  showThinking();

  try {
    const res = await fetch('/api/copilot/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: msg, history: chatHistory.slice(-10) })
    });

    document.getElementById('thinking')?.remove();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendAria(`Error: ${err.error || res.status}`);
    } else {
      const data = await res.json();
      appendAria(data.reply, data.actions || []);
      chatHistory.push({ role: 'user', content: msg });
      chatHistory.push({ role: 'assistant', content: data.reply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    }
  } catch (e) {
    document.getElementById('thinking')?.remove();
    appendAria('Network error — check the server is running.');
  } finally {
    isCopilotBusy  = false;
    send.disabled  = false;
    input.disabled = false;
    input.focus();
  }
}

function quickSend(prompt) {
  const input = document.getElementById('copilot-input');
  if (input) input.value = prompt;
  sendMessage();
}

async function handleCopilotAction(action) {
  if (action.type === 'draft-reply') {
    // Show the draft directly in chat, don't re-ask the copilot
    appendAria(`Draft reply:\n\nSubject: ${action.subject || ''}\n\n${action.body || ''}`);
  } else if (action.type === 'archive' && action.ids?.length) {
    // Actually call the API to archive emails
    try {
      await Promise.all(action.ids.map(id =>
        fetch(`/api/emails/${id}/status`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status: 'archived' })
        })
      ));
      appendAria(`Archived ${action.ids.length} email${action.ids.length !== 1 ? 's' : ''}.`);
      loadEmails();
    } catch {
      appendAria('Could not archive — please try again.');
    }
  } else {
    quickSend(action.label);
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.id === 'copilot-input') {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('copilot-input')?.focus();
  }
});

// ── Boot ──────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadUser(), loadHealth(), loadMetrics(), loadEmails(), loadCalendar(), loadAudit()]);
}

init();
// Refresh data every 30s without blocking UI
setInterval(() => { loadMetrics(); loadAudit(); }, 30_000);

// ── Update donut legend values ────────────────────────────────────
// Called from loadMetrics via updateDonut
const _origUpdateDonut = updateDonut;
function updateDonut(emails = {}) {
  _origUpdateDonut(emails);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
  set('leg-urgent',  emails.urgent   ?? 0);
  set('leg-meeting', emails.meetings ?? 0);
  set('leg-triaged', emails.triaged  ?? 0);
  set('leg-pending', emails.pending  ?? 0);
}
