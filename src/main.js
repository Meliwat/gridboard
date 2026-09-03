import * as E from './engine.js';
import { createToolController, getModelContext } from './tools.js';
import { TEAM_LABELS } from './scenario.js';

const STORAGE_KEY = 'gridboard.v1';
const AGENT_KEY = 'gridboard.agent.v1';

// ---------------- Board (shared live state) ----------------
const board = {
  state: loadState(),
  agent: loadAgent(),
  tab: 'proposals',
  toolNames: [],
  newTools: new Set(),
  commit(label) {
    persist();
    render();
    if (label !== 'focus') flashCount();
  },
};

const ctl = createToolController(board);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.segments && s.teams) return s;
    }
  } catch {}
  return E.seededState();
}
function loadAgent() {
  try { const raw = sessionStorage.getItem(AGENT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board.state));
    if (board.agent) sessionStorage.setItem(AGENT_KEY, JSON.stringify(board.agent)); else sessionStorage.removeItem(AGENT_KEY);
  } catch {}
}

// Human actions. These are the only way assignments take effect.
const human = {
  approve(id) { E.approveProposal(board.state, id, 'IC'); afterHuman(); },
  reject(id) { board.rejecting = id; render(); setTimeout(() => document.getElementById('rejectReason')?.focus(), 0); },
  confirmReject(id) { const reason = document.getElementById('rejectReason')?.value || ''; board.rejecting = null; E.rejectProposal(board.state, id, 'IC', reason); afterHuman(); },
  cancelReject() { board.rejecting = null; render(); },
  answer(id, opt) { E.answerDecision(board.state, id, opt, 'IC'); afterHuman(); },
  focus(id) { if (board.state.focusedSegment === id) E.clearFocus(board.state); else E.focusSegment(board.state, id); board.tab = board.state.focusedSegment ? 'segment' : board.tab; afterHuman(); },
  undo() { try { E.undo(board.state); } catch (e) { toast(e.message); } afterHuman(); },
  reset() { if (!board.resetArmed) { board.resetArmed = true; render(); setTimeout(() => { board.resetArmed = false; render(); }, 4000); return; } board.resetArmed = false; board.state = E.seededState(); board.agent = null; sessionStorage.removeItem(AGENT_KEY); afterHuman(); },
  clock(min) { E.advanceClock(board.state, min); afterHuman(); },
  teamReturning(teamId) {
    const t = E.findTeam(board.state, teamId);
    E.updateConditions(board.state, {});
    board.state.log.pop();
    t.status = 'returning';
    E.addLog(board.state, 'IC', `${t.callsign} reports search complete, returning to ICP. Debrief pending.`, 'note');
    afterHuman();
  },
  signOutAgent() { board.agent = null; afterHuman(); },
};
window.human = human;
window.gridboard = { board, ctl, E };

function afterHuman() {
  persist();
  render();
  ctl.sync();
}

// ---------------- Rendering ----------------
const app = document.getElementById('app');
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#16233c;border:1px solid #24324d;padding:8px 12px;border-radius:8px;z-index:9;font-size:13px'; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.display = 'none'), 2500);
}
function flashCount() {}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const s = board.state;
  const staged = s.proposals.filter((p) => p.status === 'staged');
  const open = s.decisions.filter((d) => d.status === 'open');
  const daylight = E.hoursOfDaylight(s);
  const supported = !!getModelContext();

  app.innerHTML = `
    <header class="hdr">
      <div class="brand"><span class="logo">${logoSvg()}</span> GridBoard</div>
      <div class="incident"><span class="num">${esc(s.incident.number)} · ${esc(s.incident.agency)}</span><span>${esc(s.incident.name)}</span></div>
      <div class="stats">
        <div class="stat"><span class="k">Time</span><span class="v">${esc(hhmm(s.incident.now))}</span></div>
        <div class="stat"><span class="k">Daylight left</span><span class="v ${daylight < 2 ? 'warn' : ''}">${daylight.toFixed(1)} h</span></div>
        <div class="stat"><span class="k">Teams on task</span><span class="v">${s.teams.filter((t) => ['searching', 'en route'].includes(t.status)).length}/${s.teams.length}</span></div>
        <div class="stat"><span class="k">Agent</span><span class="v">${board.agent ? esc(board.agent.name) + ' · ' + esc(board.agent.role) : '<span style="color:var(--muted)">none checked in</span>'}</span></div>
      </div>
      <div class="actions">
        <button class="btn small" onclick="human.clock(30)" title="Advance the scenario clock 30 minutes">+30 min</button>
        <button class="btn small" onclick="human.undo()" ${s.history.length ? '' : 'disabled'} title="Undo the last write, human or agent">Undo</button>
        <button class="btn small danger" onclick="human.reset()">${board.resetArmed ? 'Click again to reset' : 'Reset'}</button>
      </div>
    </header>
    <div class="tryit">
      <span class="label">Try saying</span>
      ${[
        'Check in as ChatGPT and brief me on the incident',
        'We lost daylight. Replan the east side with the teams we have',
        'Where should K9 Juno go next and why?',
        'Ground 2 found a blue glove on the creek trail. Log it',
        'Debrief Hasty 3: C1 at 40 percent, nothing seen',
      ].map((t) => `<button class="chip" title="Copy to clipboard" onclick="navigator.clipboard?.writeText(${JSON.stringify(t)});">${esc(t)}</button>`).join('')}
    </div>
    <div class="main">
      <div class="mapwrap">
        ${renderMap(s)}
        <div class="legend"><span>Remaining POA</span><span class="bar"></span><span>low → high</span><span style="margin-left:8px">◆ clue · ● team · ▲ LKP/PLS</span></div>
      </div>
      <aside class="side">
        <nav class="tabs">
          ${tab('proposals', 'Decisions', staged.length + open.length, true)}
          ${tab('teams', 'Teams', s.teams.length)}
          ${tab('segment', 'Segment', s.focusedSegment || '')}
          ${tab('log', 'Log', s.log.length)}
          ${tab('tools', 'Site tools', board.toolNames.length, board.newTools.size > 0)}
        </nav>
        <section class="panel">
          ${board.tab === 'proposals' ? renderDecisions(s, staged, open, supported) : ''}
          ${board.tab === 'teams' ? renderTeams(s) : ''}
          ${board.tab === 'segment' ? renderSegment(s) : ''}
          ${board.tab === 'log' ? renderLog(s) : ''}
          ${board.tab === 'tools' ? renderTools(supported) : ''}
        </section>
      </aside>
    </div>
    ${location.search.includes('dev') ? renderDev() : ''}
  `;
}

function tab(id, label, count, hot = false) {
  return `<button class="${board.tab === id ? 'active' : ''}" onclick="gridboard.board.tab='${id}';gridboard.render()">${label}${count !== '' && count !== undefined ? `<span class="badge ${hot && count ? '' : 'quiet'}">${esc(count)}</span>` : ''}</button>`;
}
window.gridboard = Object.assign(window.gridboard || {}, { render });

function renderDecisions(s, staged, open, supported) {
  const past = s.proposals.filter((p) => p.status !== 'staged').slice(-6).reverse();
  return `
    ${supported ? '' : `<div class="banner info"><b>Open this page in ChatGPT's desktop browser</b> (or Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code>) and your agent will find ${board.toolNames.length} site tools here. The board still works by hand.</div>`}
    ${board.agent ? '' : `<div class="banner ok">No agent has checked in yet. Ask your agent to <b>check in</b> with a name and role. Until then it can read everything but write nothing.</div>`}
    <h3>Waiting for the incident commander</h3>
    ${staged.length || open.length ? '' : '<div class="empty">Nothing staged. Your agent can propose assignments, rests and questions. Only you can approve them.</div>'}
    ${open.map((d) => `
      <div class="card decision">
        <div class="row"><span class="pill agent">${esc(d.askedBy)}</span><span class="meta">${esc(d.time)} · question ${esc(d.id)}</span></div>
        <div class="title">${esc(d.question)}</div>
        <div class="opts">${d.options.map((o) => `<button class="btn small" onclick="human.answer('${d.id}', ${JSON.stringify(o).replace(/"/g, '&quot;')})">${esc(o)}</button>`).join('')}</div>
      </div>`).join('')}
    ${staged.map(proposalCard).join('')}
    ${past.length ? '<h3>Decided</h3>' + past.map(proposalCard).join('') : ''}
  `;
}

function proposalCard(p) {
  const isAssign = p.kind === 'assignment';
  return `
    <div class="card ${p.status}">
      <div class="row"><span class="pill ${p.status}">${esc(p.status)}</span><span class="pill agent">${esc(p.proposedBy)}</span><span class="meta">${esc(p.time)} · ${esc(p.id)}</span></div>
      <div class="title">${isAssign ? `${esc(p.teamCallsign)} → ${esc(p.segment)} ${esc(p.segmentName)} · ${esc(p.hours)}h` : `Rest ${esc(p.teamCallsign)}`}</div>
      <div class="rationale">${esc(p.rationale)}</div>
      ${isAssign ? `<div class="nums"><span>remaining POA <b>${esc(p.remainingPoa)}%</b></span><span>est. POD <b>${esc(p.estimatedPod)}%</b></span><span>expected gain <b>${esc(p.expectedGain)}</b></span></div>` : ''}
      ${p.status === 'staged' ? (board.rejecting === p.id
        ? `<div class="actions" style="flex-wrap:wrap"><input id="rejectReason" class="reason" placeholder="Reason (optional, goes in the log)" onkeydown="if(event.key==='Enter')human.confirmReject('${p.id}');if(event.key==='Escape')human.cancelReject()"><button class="btn danger" onclick="human.confirmReject('${p.id}')">Confirm reject</button><button class="btn" onclick="human.cancelReject()">Cancel</button></div>`
        : `<div class="actions"><button class="btn primary" onclick="human.approve('${p.id}')">Approve</button><button class="btn danger" onclick="human.reject('${p.id}')">Reject</button>${isAssign ? `<button class="btn" onclick="human.focus('${p.segment}')">Show on map</button>` : ''}</div>`) : `<div class="meta">${esc(p.decidedBy ? `${p.status} by ${p.decidedBy}` : '')} ${esc(p.reason || '')}</div>`}
    </div>`;
}

function renderTeams(s) {
  const icon = { ground: '🥾', hasty: '🏃', dog: '🐕', uav: '🛸' };
  return `<h3>Field teams</h3>` + s.teams.map((t) => {
    const f = E.fatigueLevel(t);
    return `<div class="team">
      <div class="icon">${icon[t.type] || '•'}</div>
      <div><div class="name">${esc(t.callsign)} <span class="fatigue ${f}">${f} · ${t.hoursOnTask}h</span></div>
      <div class="sub">${esc(TEAM_LABELS[t.type])} · ${t.members} · ${esc(t.status)}${t.segment ? ' in ' + esc(t.segment) : ''} · ${esc(t.skills.join(', '))}</div></div>
      <div>${['searching'].includes(t.status) ? `<button class="btn small" title="Radio: team reports search complete" onclick="human.teamReturning('${t.id}')">Returning</button>` : ''}</div>
    </div>`;
  }).join('');
}

function renderSegment(s) {
  if (!s.focusedSegment) return '<div class="empty">Click a segment on the map, or ask your agent to focus one.</div>';
  const seg = E.findSegment(s, s.focusedSegment);
  const sum = E.segmentSummary(s, seg);
  const clues = s.clues.filter((c) => c.segment === seg.id);
  return `<div class="seg-detail">
    <div class="row" style="display:flex;justify-content:space-between;align-items:center"><h3>${esc(seg.id)} · ${esc(seg.name)}</h3><button class="btn small" onclick="human.focus('${seg.id}')">Clear focus</button></div>
    <p style="color:var(--muted);margin:6px 0 10px">${esc(seg.terrain)} · ${seg.areaHa} ha</p>
    <div class="grid">
      <div class="cell"><div class="k">Remaining POA</div><div class="v">${sum.remainingPoa}%</div></div>
      <div class="cell"><div class="k">Cumulative POD</div><div class="v">${sum.cumulativePod}%</div></div>
      <div class="cell"><div class="k">Status</div><div class="v" style="font-size:13px">${esc(sum.status)}</div></div>
    </div>
    <h3 style="margin-top:14px">Searches</h3>
    ${seg.searches.length ? seg.searches.map((x) => `<div class="card"><div class="row"><b>${esc(x.team)}</b><span class="meta">${esc(x.time)} · POD ${Math.round(x.pod * 100)}%</span></div><div class="rationale">${esc(x.note || '')}</div></div>`).join('') : '<div class="empty">Not searched yet.</div>'}
    <h3 style="margin-top:14px">Clues</h3>
    ${clues.length ? clues.map((c) => `<div class="card"><div class="row"><b>${esc(c.id)}</b><span class="meta">${esc(c.time)} · ${esc(c.foundBy)}</span></div><div>${esc(c.description)}</div></div>`).join('') : '<div class="empty">No clues here. While this segment is focused, the agent has a mark_clue tool.</div>'}
  </div>`;
}

function renderLog(s) {
  const agents = new Set(s.agents.map((a) => a.name));
  return `<h3>Activity log · ICS 214</h3><div class="log">` + s.log.slice().reverse().map((l) => `
    <div class="entry ${esc(l.kind || '')}"><span class="t">${esc(l.time)}</span><span><span class="a ${agents.has(l.author) ? 'agent' : ''}">${esc(l.author)}</span>${esc(l.text)}</span></div>`).join('') + '</div>';
}

function renderTools(supported) {
  const kind = (t) => (t.annotations?.readOnlyHint ? 'read' : t.name === 'focus_segment' ? 'nav' : 'write');
  const locked = [];
  if (!board.agent) locked.push('propose_assignment, propose_rest, log_entry, request_decision · unlock by check_in');
  if (board.agent && !board.state.focusedSegment) locked.push('mark_clue · appears while a segment is focused');
  if (board.agent && !board.state.proposals.some((p) => p.status === 'staged')) locked.push('withdraw_proposal · appears while a proposal is staged');
  if (board.agent && !board.state.teams.some((t) => t.status === 'returning')) locked.push('debrief_team · appears while a team is returning');
  return `
    <div class="banner ${supported ? 'ok' : 'info'}">${supported ? 'WebMCP detected. These tools are registered with your agent right now and change as the board changes.' : 'WebMCP not detected in this browser. This is the tool set an agent would see. Open in ChatGPT desktop or Chrome with the WebMCP flag.'}</div>
    <h3>Registered now · ${board.toolNames.length}</h3>
    <div class="tools">
      ${board.toolNames.map((n) => { const t = ctl.get(n); const k = kind(t); return `<div class="tool ${board.newTools.has(n) ? 'new' : ''}"><span class="dot ${k}"></span><div><div class="n">${esc(n)}</div><div class="d">${esc(t.description)}</div></div><span class="tag">${k}</span></div>`; }).join('')}
    </div>
    ${locked.length ? '<h3>Not registered · capability follows state</h3>' + locked.map((l) => `<div class="locked">${esc(l)}</div>`).join('') : ''}
    <h3>Never a tool</h3>
    <div class="locked">approve_proposal · only the incident commander's button on the board applies an assignment</div>
    ${board.agent ? `<button class="btn small" onclick="human.signOutAgent()">Sign out agent ${esc(board.agent.name)}</button>` : ''}
  `;
}

function renderDev() {
  return `<div class="dev">
    <div style="display:flex;gap:8px;align-items:center"><b style="font-size:12px">Dev console</b><span style="color:var(--muted);font-size:12px">call a tool as an agent would</span></div>
    <div style="display:flex;gap:8px"><input id="devName" placeholder="tool name" style="max-width:220px"><input id="devInput" placeholder='{"team":"Ground 6","segment":"B2","rationale":"..."}'><button class="btn small" onclick="gridboard.devCall()">Run</button></div>
    <pre id="devOut">${esc(JSON.stringify({ registered: board.toolNames }, null, 1))}</pre>
  </div>`;
}
window.gridboard.devCall = async () => {
  const name = document.getElementById('devName').value.trim();
  let input = {};
  try { input = JSON.parse(document.getElementById('devInput').value || '{}'); } catch (e) { document.getElementById('devOut').textContent = 'Bad JSON: ' + e.message; return; }
  const out = await ctl.call(name, input);
  render();
  const el = document.getElementById('devOut'); if (el) el.textContent = JSON.stringify(out, null, 2);
};

// ---------------- Map ----------------
function renderMap(s) {
  const poa = E.remainingPoa(s);
  const max = Math.max(...Object.values(poa), 1);
  const polys = s.segments.map((seg) => {
    const c0 = centroid(seg.poly);
    const c = { x: c0.x + (seg.labelDx || 0), y: c0.y + (seg.labelDy || 0) };
    const v = poa[seg.id] / max;
    const fill = heat(v);
    const teams = s.teams.filter((t) => t.segment === seg.id);
    return `
      <g>
        <polygon class="seg ${s.focusedSegment === seg.id ? 'focused' : ''}" points="${seg.poly.map((p) => p.join(',')).join(' ')}" fill="${fill}" fill-opacity="0.82" onclick="human.focus('${seg.id}')"><title>${esc(seg.id)} ${esc(seg.name)} · remaining POA ${Math.round(poa[seg.id])}% · POD ${Math.round(E.cumulativePod(seg) * 100)}%</title></polygon>
        <text class="seg-label" x="${c.x}" y="${c.y - 4}" text-anchor="middle">${seg.id}</text>
        <text class="seg-sub" x="${c.x}" y="${c.y + 11}" text-anchor="middle">${Math.round(poa[seg.id])}% · POD ${Math.round(E.cumulativePod(seg) * 100)}%</text>
        ${teams.map((t, i) => pin(t, c.x - 30 + i * 26, c.y + 32)).join('')}
      </g>`;
  }).join('');
  const trails = s.trails.map((t) => `<polyline class="trail" points="${t.map((p) => p.join(',')).join(' ')}"/>`).join('');
  const markers = Object.values(s.points).map((p) => `<g class="marker"><polygon points="${p.x},${p.y - 9} ${p.x - 7},${p.y + 5} ${p.x + 7},${p.y + 5}" fill="#fff" stroke="#0b1220" stroke-width="1.5"/><text x="${p.x + 10}" y="${p.y + 4 + (p.labelDy || 0)}">${esc(p.label)}</text></g>`).join('');
  const clues = s.clues.map((c) => { const seg = s.segments.find((x) => x.id === c.segment); const ct = centroid(seg.poly); const i = s.clues.filter((x) => x.segment === c.segment).indexOf(c); return `<g class="marker" transform="translate(${ct.x + 34 + i * 14}, ${ct.y - 26})"><polygon class="clue" points="0,-7 7,0 0,7 -7,0"><title>${esc(c.id)}: ${esc(c.description)}</title></polygon></g>`; }).join('');
  const idle = s.teams.filter((t) => !t.segment).map((t, i) => pin(t, 34 + i * 30, 690));
  return `<svg viewBox="0 0 1000 720" preserveAspectRatio="xMidYMid meet" aria-label="Search area map">
    <defs><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="1"/></pattern></defs>
    <rect width="1000" height="720" fill="url(#grid)"/>
    ${polys}${trails}${markers}${clues}
    <text x="20" y="668" fill="#8ea0bd" font-size="11" font-family="ui-monospace, monospace">Staging at ICP</text>
    ${idle.join('')}
    <text x="985" y="22" fill="#8ea0bd" font-size="11" text-anchor="end" font-family="ui-monospace, monospace">Synthetic training scenario. Not a real incident.</text>
  </svg>`;
}

function pin(t, x, y) {
  const color = { ground: '#22c55e', hasty: '#f59e0b', dog: '#a78bfa', uav: '#38bdf8' }[t.type];
  return `<g class="pin ${t.status === 'en route' ? 'enroute' : ''}" transform="translate(${x},${y})"><circle r="11" fill="${color}"><title>${esc(t.callsign)} · ${esc(t.status)} · ${t.hoursOnTask}h on task</title></circle><text text-anchor="middle" y="4">${esc(t.id.replace('T', ''))}</text></g>`;
}
function centroid(poly) {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return { x: x / poly.length, y: y / poly.length };
}
function heat(v) {
  // low: deep blue, mid: amber, high: red
  const stops = [[0, [30, 58, 95]], [0.5, [245, 158, 11]], [1, [239, 68, 68]]];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (v >= stops[i][0] && v <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const t = (v - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * t));
  return `rgb(${c.join(',')})`;
}
function hhmm(iso) { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function logoSvg() { return `<svg width="16" height="16" viewBox="0 0 100 100"><path d="M20 70 L45 35 L60 55 L72 40 L85 70 Z" fill="#f59e0b"/><circle cx="30" cy="30" r="8" fill="#38bdf8"/></svg>`; }

// ---------------- Boot ----------------
ctl.onChange((names) => {
  const prev = new Set(board.toolNames);
  board.newTools = new Set(names.filter((n) => !prev.has(n)));
  board.toolNames = names;
  render();
  setTimeout(() => { board.newTools.clear(); }, 1800);
});
render();
ctl.sync().then(() => render());
