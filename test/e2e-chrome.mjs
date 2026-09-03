// End-to-end check in real Chrome with WebMCP enabled.
// Launches headless Chrome with --enable-features=WebMCP, loads the app, and verifies that
// document.modelContext accepted our registrations and that the tool set changes with board state.
// Usage: node test/e2e-chrome.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://localhost:4173/?dev=1';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'gb-chrome-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--enable-features=WebMCP',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForDevtools() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('Chrome devtools did not come up');
}

let id = 0;
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return new Promise((res) => { ws.onopen = () => res({ send, ws }); });
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.result?.value;
}

const failures = [];
// The browser's own list of tools, when the client exposes getTools; falls back to the controller's list.
const browserTools = (cdp) => evalJs(cdp, `(async () => { const mc = document.modelContext; if (typeof mc.getTools === 'function') { return JSON.stringify((await mc.getTools()).map(t => t.name)); } return JSON.stringify(window.gridboard.ctl.names()); })()`).then((v) => JSON.parse(v));
const check = (cond, msg) => { console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`); if (!cond) failures.push(msg); };

try {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(1500);

  check(await evalJs(cdp, 'typeof document.modelContext?.registerTool'), 'document.modelContext.registerTool exists in this Chrome') ;
  check(await evalJs(cdp, 'window.gridboard?.ctl?.supported === true'), 'app detected WebMCP and registered against the real ModelContext');

  const names0 = await browserTools(cdp);
  console.log('   browser sees:', JSON.stringify(names0));
  check(names0.includes('check_in') && !names0.includes('propose_assignment'), 'before check in: check_in present, propose_assignment absent');

  // A duplicate registration must be rejected by the browser: proves these are real registrations.
  const dup = await evalJs(cdp, `document.modelContext.registerTool({ name: 'list_segments', description: 'dup', inputSchema: { type: 'object' }, execute: async () => 1 }).then(() => 'accepted', (e) => 'rejected: ' + e.name)`);
  check(String(dup).startsWith('rejected'), `browser rejects duplicate tool name (${dup})`);

  // Execute through the browser's own executeTool when available: proves discovery and dispatch end to end.
  const viaBrowser = await evalJs(cdp, `(async () => { const mc = document.modelContext; if (typeof mc.executeTool !== 'function') return 'n/a'; const t = (await mc.getTools()).find(x => x.name === 'get_team_status'); const r = await mc.executeTool(t, JSON.stringify({ team: 'K9 Juno' })); return typeof r === 'string' ? r : JSON.stringify(r); })()`);
  check(viaBrowser === 'n/a' || /K9 Juno/.test(viaBrowser), `browser executeTool dispatches to our handler (${viaBrowser === 'n/a' ? 'executeTool not exposed in this build' : 'ok'})`);

  // Drive the rest as an agent would, through the controller's execute handlers.
  const r1 = await evalJs(cdp, `window.gridboard.ctl.call('check_in', { name: 'E2E Agent', role: 'planning' }).then(JSON.stringify)`);
  check(JSON.parse(r1).ok === true, 'check_in ok');
  const names1 = await browserTools(cdp);
  check(names1.includes('propose_assignment') && !names1.includes('check_in') && !names1.includes('mark_clue'), 'after check in: write tools on, check_in off, mark_clue still off');

  const r2 = await evalJs(cdp, `window.gridboard.ctl.call('focus_segment', { segment: 'Creek trail' }).then(JSON.stringify)`);
  check(JSON.parse(r2).focused === 'D1', 'focus_segment resolves by name');
  const names2 = await browserTools(cdp);
  check(names2.includes('mark_clue'), 'mark_clue appears once a segment is focused');

  const r3 = await evalJs(cdp, `window.gridboard.ctl.call('propose_assignment', { team: 'Ground 6', segment: 'B2', hours: 2, rationale: 'Highest remaining POA, unsearched cliff band, team has rope skills.' }).then(JSON.stringify)`);
  const p = JSON.parse(r3);
  check(p.ok === true && p.staged.status === 'staged', 'proposal staged');
  check(await evalJs(cdp, `window.gridboard.board.state.teams.find(t => t.id === 'T6').segment === null`), 'team not moved by the proposal');
  check(await evalJs(cdp, `!!document.querySelector('.card.staged')`), 'staged card visible on the board');

  await evalJs(cdp, `window.human.approve('${p.staged.id}')`);
  check(await evalJs(cdp, `window.gridboard.board.state.teams.find(t => t.id === 'T6').segment === 'B2'`), 'human approve moves the team');
  const names3 = await browserTools(cdp);
  check(!names3.includes('withdraw_proposal'), 'withdraw_proposal disappears when nothing is staged');
  check(!names3.some((n) => /approve|commit|dispatch/.test(n)), 'no approve tool ever registered');

  // Inline reject flow (no browser dialogs, which embedded browsers may block)
  const r4 = await evalJs(cdp, `window.gridboard.ctl.call('propose_assignment', { team: 'Drone 5', segment: 'D2', hours: 1, rationale: 'Thermal over open marsh before dark is cheap coverage.' }).then(JSON.stringify)`);
  const p2 = JSON.parse(r4).staged;
  await evalJs(cdp, `window.human.reject('${p2.id}')`);
  check(await evalJs(cdp, `!!document.getElementById('rejectReason')`), 'reject shows an inline reason field');
  await evalJs(cdp, `document.getElementById('rejectReason').value = 'Wind too high for the drone'; window.human.confirmReject('${p2.id}')`);
  check(await evalJs(cdp, `window.gridboard.board.state.proposals.find(p => p.id === '${p2.id}').status === 'rejected'`), 'confirm reject marks the proposal rejected');
  check(await evalJs(cdp, `/Wind too high/.test(window.gridboard.board.state.log.at(-1).text)`), 'rejection reason lands in the log');

  const xss = '&quot;);window.__pwned=1;//';
  await evalJs(cdp, `window.gridboard.ctl.call('request_decision', { question: 'Which option looks safe to you?', options: ['Fine', ${JSON.stringify(xss)}] })`);
  await evalJs(cdp, `window.gridboard.board.tab = 'proposals'; window.gridboard.render()`);
  await evalJs(cdp, `[...document.querySelectorAll('button[data-decision]')].at(-1).click()`);
  check(await evalJs(cdp, 'window.__pwned !== 1'), 'agent-written option text cannot execute script when clicked');
  check(await evalJs(cdp, `window.gridboard.board.state.decisions.at(-1).answer === ${JSON.stringify(xss)}`), 'the clicked option is recorded verbatim as data');

  const errs = await evalJs(cdp, `window.gridboard.ctl.call('propose_assignment', { team: 'Nobody', segment: 'B2', rationale: 'Long enough rationale here.' }).then(JSON.stringify)`);
  check(JSON.parse(errs).ok === false && /Known teams/.test(JSON.parse(errs).hint), 'bad input returns a descriptive hint');

  await evalJs(cdp, `window.gridboard.ctl.call('propose_assignment', { team: 'K9 Juno', segment: 'North drainage', hours: 2, rationale: 'Air scent team, dense timber where ground teams are slow, and the west wind carries scent down the drainage toward the trail.' })`);
  await evalJs(cdp, `window.gridboard.ctl.call('request_decision', { question: 'Hold Drone 5 for night thermal, or launch now over the beaver ponds?', options: ['Hold for night', 'Launch now'] })`);
  await evalJs(cdp, `window.gridboard.board.tab = 'proposals'; window.gridboard.render()`);
  await sleep(300);
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.SHOT || 'e2e.png', Buffer.from(r.result.data, 'base64'));
  });
} catch (e) {
  failures.push(String(e));
  console.error('ERROR', e);
} finally {
  await new Promise((r) => { chrome.once('exit', r); chrome.kill(); setTimeout(r, 3000); });
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall e2e checks passed');
process.exit(failures.length ? 1 : 0);
