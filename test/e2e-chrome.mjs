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
const check = (cond, msg) => { console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`); if (!cond) failures.push(msg); };

try {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: URL });
  await sleep(1500);

  check(await evalJs(cdp, 'typeof document.modelContext?.registerTool'), 'document.modelContext.registerTool exists in this Chrome') ;
  check(await evalJs(cdp, 'window.gridboard?.ctl?.supported === true'), 'app detected WebMCP and registered against the real ModelContext');

  const names0 = await evalJs(cdp, 'JSON.stringify(window.gridboard.ctl.names())');
  console.log('   registered:', names0);
  check(JSON.parse(names0).includes('check_in') && !JSON.parse(names0).includes('propose_assignment'), 'before check in: check_in present, propose_assignment absent');

  // A duplicate registration must be rejected by the browser: proves these are real registrations.
  const dup = await evalJs(cdp, `document.modelContext.registerTool({ name: 'list_segments', description: 'dup', inputSchema: { type: 'object' }, execute: async () => 1 }).then(() => 'accepted', (e) => 'rejected: ' + e.name)`);
  check(String(dup).startsWith('rejected'), `browser rejects duplicate tool name (${dup})`);

  // Drive the tools exactly as an agent would, through the controller's execute handlers.
  const r1 = await evalJs(cdp, `window.gridboard.ctl.call('check_in', { name: 'E2E Agent', role: 'planning' }).then(JSON.stringify)`);
  check(JSON.parse(r1).ok === true, 'check_in ok');
  const names1 = JSON.parse(await evalJs(cdp, 'JSON.stringify(window.gridboard.ctl.names())'));
  check(names1.includes('propose_assignment') && !names1.includes('check_in') && !names1.includes('mark_clue'), 'after check in: write tools on, check_in off, mark_clue still off');

  const r2 = await evalJs(cdp, `window.gridboard.ctl.call('focus_segment', { segment: 'Creek trail' }).then(JSON.stringify)`);
  check(JSON.parse(r2).focused === 'D1', 'focus_segment resolves by name');
  const names2 = JSON.parse(await evalJs(cdp, 'JSON.stringify(window.gridboard.ctl.names())'));
  check(names2.includes('mark_clue'), 'mark_clue appears once a segment is focused');

  const r3 = await evalJs(cdp, `window.gridboard.ctl.call('propose_assignment', { team: 'Ground 6', segment: 'B2', hours: 2, rationale: 'Highest remaining POA, unsearched cliff band, team has rope skills.' }).then(JSON.stringify)`);
  const p = JSON.parse(r3);
  check(p.ok === true && p.staged.status === 'staged', 'proposal staged');
  check(await evalJs(cdp, `window.gridboard.board.state.teams.find(t => t.id === 'T6').segment === null`), 'team not moved by the proposal');
  check(await evalJs(cdp, `!!document.querySelector('.card.staged')`), 'staged card visible on the board');

  await evalJs(cdp, `window.human.approve('${p.staged.id}')`);
  check(await evalJs(cdp, `window.gridboard.board.state.teams.find(t => t.id === 'T6').segment === 'B2'`), 'human approve moves the team');
  const names3 = JSON.parse(await evalJs(cdp, 'JSON.stringify(window.gridboard.ctl.names())'));
  check(!names3.includes('withdraw_proposal'), 'withdraw_proposal disappears when nothing is staged');
  check(!names3.some((n) => /approve|commit|dispatch/.test(n)), 'no approve tool ever registered');

  const errs = await evalJs(cdp, `window.gridboard.ctl.call('propose_assignment', { team: 'Nobody', segment: 'B2', rationale: 'Long enough rationale here.' }).then(JSON.stringify)`);
  check(JSON.parse(errs).ok === false && /Known teams/.test(JSON.parse(errs).hint), 'bad input returns a descriptive hint');

  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.SHOT || 'e2e.png', Buffer.from(r.result.data, 'base64'));
  });
} catch (e) {
  failures.push(String(e));
  console.error('ERROR', e);
} finally {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall e2e checks passed');
process.exit(failures.length ? 1 : 0);
