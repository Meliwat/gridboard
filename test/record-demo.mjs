// Produces the demo video: drives the live app in real Chrome (WebMCP on), captures frames,
// narrates with macOS `say`, and assembles an MP4 with ffmpeg.
// Usage: node test/record-demo.mjs [url] [outDir]
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] || 'https://gridboard-puce.vercel.app/';
const OUT = process.argv[3] || 'demo-build';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const W = 1440, H = 900;
const VOICE = 'Samantha';
const RATE = 178;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'frames'), { recursive: true });
mkdirSync(join(OUT, 'audio'), { recursive: true });
const profile = join(OUT, 'profile');

// ---------- narration ----------
const SEGMENTS = [
  { id: 'open', text: 'Tens of thousands of people are listed as missing in the United States right now. Wilderness search and rescue still runs on whiteboards, at dusk, with tired volunteers. This is GridBoard. Your agent plans. The incident commander decides.' },
  { id: 'board', text: 'A synthetic incident. A hiker is overdue. Nine search segments shaded by remaining probability, six teams, and the sun goes down in under two hours. Everything on this page is exposed to the agent through WebMCP as site tools. Ten of them right now. Read tools in blue. The only write tool is check in.' },
  { id: 'checkin', text: 'The agent checks in with a name and a role. Watch the tool list. Check in disappears, and the proposal tools appear. From here, every write carries the agent\'s name. It reads the briefing in one call. No clicking through the interface.' },
  { id: 'replan', text: 'The commander says: we lost daylight, replan the east side. The agent ranks every segment by expected gain for each team, and stages two proposals with a rationale, the estimated probability of detection, and the expected gain. Nobody moved. There is no tool that dispatches a team. Only this button.' },
  { id: 'decide', text: 'The commander approves the K9 team into the drainage, and the pin moves. The drone proposal gets rejected, with a reason. Both decisions land in the log: proposed by the agent, decided by a human.' },
  { id: 'debrief', text: 'Capability follows state. When Hasty 3 radios that they are returning, a debrief tool appears for the agent. It records the coverage, and probability shifts across the whole map. The agent literally cannot log a debrief for a team that is still in the field.' },
  { id: 'question', text: 'When a call needs judgment, the agent asks. Should the drone hold for night thermal, or launch now? Only a human can answer that.' },
  { id: 'close', text: 'Same board, two kinds of intelligence. Breadth from the agent, judgment from the human, and the page enforces which is which. GridBoard is open source, built on WebMCP, and every tool you saw is a real registration the browser can list and call.' },
];

for (const seg of SEGMENTS) {
  const aiff = join(OUT, 'audio', `${seg.id}.aiff`);
  execSync(`say -v "${VOICE}" -r ${RATE} -o "${aiff}" ${JSON.stringify(seg.text)}`);
  const info = execSync(`afinfo "${aiff}"`).toString();
  seg.audioSec = parseFloat(info.match(/estimated duration: ([\d.]+)/)[1]);
}

// ---------- chrome ----------
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--enable-features=WebMCP', `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(200); }
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(1500);
await js(`localStorage.clear(); sessionStorage.clear(); location.reload()`);
await sleep(1500);

// ---------- frame capture ----------
const frames = []; // { file, t }
let recording = true; const t0 = Date.now();
const capture = (async () => {
  let n = 0;
  while (recording) {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    const t = (Date.now() - t0) / 1000;
    const file = join(OUT, 'frames', `f${String(n++).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    frames.push({ file, t });
    await sleep(60);
  }
})();

// ---------- demo helpers (injected overlays are recording-only, not part of the product) ----------
const overlayCss = `#demoOverlay{position:fixed;inset:0;background:#0b1220;color:#e6edf7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;z-index:99;font-family:-apple-system,Inter,sans-serif}
#demoOverlay .big{font-size:44px;font-weight:700;letter-spacing:-.01em;text-align:center;max-width:900px;line-height:1.2}
#demoOverlay .sub{font-size:20px;color:#8ea0bd;text-align:center;max-width:800px}
#agentBar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:rgba(17,28,49,.96);border:1px solid #4c1d95;color:#e6edf7;padding:10px 16px;border-radius:12px;font:14px ui-monospace,Menlo,monospace;z-index:98;box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:1100px}
#agentBar b{color:#a78bfa}
#humanBar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:rgba(17,28,49,.96);border:1px solid #0c4a6e;color:#e6edf7;padding:10px 16px;border-radius:12px;font:14px -apple-system,Inter,sans-serif;z-index:98;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#humanBar b{color:#38bdf8}
.demo-cursor{position:fixed;width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 3px rgba(56,189,248,.6);z-index:100;pointer-events:none;transform:translate(-50%,-50%)}`;
await js(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(overlayCss)}; document.head.appendChild(s); })()`);
const overlay = (big, sub) => js(`(() => { let o = document.getElementById('demoOverlay'); if (!o) { o = document.createElement('div'); o.id = 'demoOverlay'; document.body.appendChild(o); } o.innerHTML = '<div class="big">' + ${JSON.stringify(big)} + '</div><div class="sub">' + ${JSON.stringify(sub)} + '</div>'; })()`);
const clearOverlay = () => js(`document.getElementById('demoOverlay')?.remove()`);
const agentSays = (text) => js(`(() => { document.getElementById('humanBar')?.remove(); let b = document.getElementById('agentBar'); if (!b) { b = document.createElement('div'); b.id = 'agentBar'; document.body.appendChild(b); } b.innerHTML = '<b>agent</b> · ' + ${JSON.stringify(text)}; })()`);
const humanSays = (text) => js(`(() => { document.getElementById('agentBar')?.remove(); let b = document.getElementById('humanBar'); if (!b) { b = document.createElement('div'); b.id = 'humanBar'; document.body.appendChild(b); } b.innerHTML = '<b>incident commander</b> · ' + ${JSON.stringify(text)}; })()`);
const clearBars = () => js(`document.getElementById('agentBar')?.remove(); document.getElementById('humanBar')?.remove();`);
const tab = (name) => js(`window.gridboard.board.tab = ${JSON.stringify(name)}; window.gridboard.render();`);
const call = (name, input) => js(`window.gridboard.ctl.call(${JSON.stringify(name)}, ${JSON.stringify(input || {})}).then(JSON.stringify)`);
const clickSel = async (selector) => {
  // show a cursor moving to the element, then click it
  const box = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) return false;
  await js(`(() => { let c = document.querySelector('.demo-cursor'); if (!c) { c = document.createElement('div'); c.className = 'demo-cursor'; c.style.left = '700px'; c.style.top = '450px'; document.body.appendChild(c); } c.style.transition = 'left .6s ease, top .6s ease'; requestAnimationFrame(() => { c.style.left = '${box.x}px'; c.style.top = '${box.y}px'; }); })()`);
  await sleep(750);
  await js(`document.querySelector(${JSON.parse(JSON.stringify(JSON.stringify(selector)))}).click()`);
  await sleep(150);
  await js(`document.querySelector('.demo-cursor')?.remove()`);
  return true;
};

// ---------- timeline ----------
const marks = []; // { id, start }
const segStart = (idx) => { marks.push({ id: SEGMENTS[idx].id, start: (Date.now() - t0) / 1000 }); return Date.now(); };
const holdUntil = async (startMs, sec) => { const remain = startMs + sec * 1000 - Date.now(); if (remain > 0) await sleep(remain); };

// 0 open
let s = segStart(0);
await overlay('26,278 people are listed as missing in the United States right now.', 'Wilderness search and rescue still runs on whiteboards.');
await sleep(6500);
await overlay('GridBoard', 'Your agent plans. The incident commander decides.');
await holdUntil(s, SEGMENTS[0].audioSec + 0.6);
await clearOverlay();

// 1 board
s = segStart(1);
await sleep(7000);
await clickSel('.tabs button:nth-child(5)');
await holdUntil(s, SEGMENTS[1].audioSec + 0.8);

// 2 check in
s = segStart(2);
await agentSays('check_in({ name: "ChatGPT", role: "planning" })');
await sleep(1200);
await call('check_in', { name: 'ChatGPT', role: 'planning' });
await sleep(4500);
await agentSays('generate_briefing()');
await call('generate_briefing');
await sleep(2500);
await tab('proposals');
await holdUntil(s, SEGMENTS[2].audioSec + 0.8);

// 3 replan
s = segStart(3);
await humanSays('"We lost daylight. Replan the east side with the teams we have."');
await sleep(4500);
await agentSays('rank_segments_for_team({ team: "K9 Juno", hours: 2 })');
await call('rank_segments_for_team', { team: 'K9 Juno', hours: 2 });
await sleep(2500);
await agentSays('propose_assignment({ team: "K9 Juno", segment: "North drainage", hours: 2, rationale: "..." })');
await call('propose_assignment', { team: 'K9 Juno', segment: 'North drainage', hours: 2, rationale: 'Air scent team for dense timber where ground teams are slow. The west wind carries scent down the drainage toward the trail.' });
await sleep(3500);
await agentSays('propose_assignment({ team: "Drone 5", segment: "Beaver ponds", hours: 1, rationale: "..." })');
await call('propose_assignment', { team: 'Drone 5', segment: 'Beaver ponds', hours: 1, rationale: 'Thermal over open marsh before dark is cheap coverage of a segment ground teams would take hours to walk.' });
await sleep(3000);
await clearBars();
await holdUntil(s, SEGMENTS[3].audioSec + 0.5);

// 4 decide
s = segStart(4);
await humanSays('Approve');
await clickSel('.card.staged .btn.primary');
await sleep(3500);
await humanSays('Reject: wind too high for the drone');
await clickSel('.card.staged .btn.danger');
await sleep(600);
await js(`document.getElementById('rejectReason').value = 'Wind is 20 km/h and rising, too high for the drone'`);
await sleep(1200);
await clickSel('.card.staged .btn.danger');
await sleep(3000);
await clearBars();
await tab('log');
await holdUntil(s, SEGMENTS[4].audioSec + 0.5);

// 5 debrief
s = segStart(5);
await tab('teams');
await humanSays('Radio: Hasty 3 is returning to ICP');
await sleep(2500);
await tab('tools');
await sleep(4000);
await agentSays('debrief_team({ team: "Hasty 3", segment: "C1", podPercent: 40, note: "Second pass on the saddle, no sign." })');
await sleep(1500);
await call('debrief_team', { team: 'Hasty 3', segment: 'C1', podPercent: 40, note: 'Second pass on the saddle, no sign.' });
await sleep(2500);
await tab('segment');
await call('focus_segment', { segment: 'C1' });
await sleep(3000);
await clearBars();
await holdUntil(s, SEGMENTS[5].audioSec + 0.5);

// 6 question
s = segStart(6);
await tab('proposals');
await agentSays('request_decision({ question: "Hold Drone 5 for night thermal, or launch now?", options: ["Hold for night", "Launch now"] })');
await call('request_decision', { question: 'Hold Drone 5 for night thermal, or launch now over the beaver ponds?', options: ['Hold for night', 'Launch now'] });
await sleep(4500);
await humanSays('Hold for night');
await clickSel('button[data-decision]');
await sleep(2000);
await clearBars();
await holdUntil(s, SEGMENTS[6].audioSec + 0.5);

// 7 close
s = segStart(7);
await tab('log');
await sleep(6000);
await overlay('GridBoard', 'github.com/Meliwat/gridboard · gridboard-puce.vercel.app · built on WebMCP');
await holdUntil(s, SEGMENTS[7].audioSec + 1.5);

recording = false; await capture;
const total = (Date.now() - t0) / 1000;
chrome.kill();

// ---------- assemble ----------
// video: concat demuxer with real frame durations
let concat = '';
frames.forEach((f, i) => { const next = frames[i + 1]?.t ?? total; concat += `file '${f.file.replace(OUT + '/', '')}'\nduration ${Math.max(0.016, next - f.t).toFixed(3)}\n`; });
concat += `file '${frames.at(-1).file.replace(OUT + '/', '')}'\n`;
writeFileSync(join(OUT, 'frames.txt'), concat);
// audio: each narration delayed to its segment start, mixed
const inputs = SEGMENTS.map((seg) => `-i audio/${seg.id}.aiff`).join(' ');
const delays = SEGMENTS.map((seg, i) => { const m = marks.find((x) => x.id === seg.id); return `[${i + 1}]adelay=${Math.round(m.start * 1000)}|${Math.round(m.start * 1000)}[a${i}]`; }).join(';');
const mix = SEGMENTS.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${SEGMENTS.length}:normalize=0,apad=whole_dur=${total.toFixed(2)}[aout]`;
const cmd = `cd ${OUT} && ffmpeg -y -loglevel error -f concat -safe 0 -i frames.txt ${inputs} -filter_complex "${delays};${mix}" -map 0:v -map "[aout]" -r 24 -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -c:a aac -b:a 160k -shortest gridboard-demo.mp4`;
execSync(cmd, { stdio: 'inherit' });
console.log(JSON.stringify({ seconds: total.toFixed(1), frames: frames.length, marks }, null, 1));
console.log(`\nwrote ${OUT}/gridboard-demo.mp4`);
