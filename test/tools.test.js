import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededState, approveProposal, findTeam } from '../src/engine.js';
import { createToolController } from '../src/tools.js';

function fakeModelContext() {
  const tools = new Map();
  const calls = [];
  return {
    tools,
    calls,
    async registerTool(t) {
      if (tools.has(t.name)) throw new Error(`duplicate ${t.name}`);
      if (!t.name || !t.description || typeof t.execute !== 'function') throw new Error('invalid tool');
      tools.set(t.name, t);
      calls.push(['register', t.name]);
    },
    async unregisterTool(name) {
      tools.delete(name);
      calls.push(['unregister', name]);
    },
  };
}

function makeBoard() {
  const board = { state: seededState(), agent: null, commits: [], commit(label) { this.commits.push(label); } };
  const mc = fakeModelContext();
  const ctl = createToolController(board, mc);
  return { board, mc, ctl };
}

const READ = ['describe_incident', 'list_segments', 'get_team_status', 'explain_coverage', 'rank_segments_for_team', 'list_proposals', 'read_log', 'generate_briefing'];

test('before check in only read tools, focus and check_in are registered', async () => {
  const { ctl, mc } = makeBoard();
  await ctl.sync();
  const names = [...mc.tools.keys()].sort();
  assert.deepEqual(names, [...READ, 'focus_segment', 'check_in'].sort());
  for (const n of READ) assert.equal(mc.tools.get(n).annotations.readOnlyHint, true);
});

test('there is never a tool that approves a proposal', async () => {
  const { ctl, mc, board } = makeBoard();
  await ctl.sync();
  await ctl.call('check_in', { name: 'ChatGPT' });
  await ctl.call('propose_assignment', { team: 'Ground 6', segment: 'B2', rationale: 'Highest remaining POA, unsearched cliff band, rope skills.' });
  board.state.focusedSegment = 'B2';
  await ctl.sync();
  const names = [...mc.tools.keys()];
  assert.ok(!names.some((n) => /approve|commit|dispatch|assign_team/.test(n)), names.join(','));
});

test('check_in unlocks write tools and the interlock tools follow board state', async () => {
  const { ctl, mc, board } = makeBoard();
  await ctl.sync();
  const r = await ctl.call('check_in', { name: 'ChatGPT', role: 'planning' });
  assert.equal(r.ok, true);
  assert.ok(mc.tools.has('propose_assignment'));
  assert.ok(!mc.tools.has('check_in'));
  assert.ok(!mc.tools.has('mark_clue'));
  assert.ok(!mc.tools.has('withdraw_proposal'));
  // Hasty 3 is returning in the seed, so debrief exists
  assert.ok(mc.tools.has('debrief_team'));

  await ctl.call('focus_segment', { segment: 'Creek trail' });
  assert.ok(mc.tools.has('mark_clue'));

  const p = await ctl.call('propose_assignment', { team: 'K9 Juno', segment: 'North drainage', rationale: 'Air scent team, dense timber, wind from the west pushes scent down the drainage.' });
  assert.equal(p.ok, true);
  assert.ok(mc.tools.has('withdraw_proposal'));
  assert.equal(findTeam(board.state, 'T4').segment, null, 'proposal must not move the team');

  approveProposal(board.state, p.staged.id, 'IC');
  await ctl.sync();
  assert.ok(!mc.tools.has('withdraw_proposal'));
  assert.equal(findTeam(board.state, 'T4').segment, 'C2');

  await ctl.call('debrief_team', { team: 'Hasty 3', segment: 'C1', podPercent: 40, note: 'Second pass.' });
  assert.ok(!mc.tools.has('debrief_team'));
});

test('engine errors come back as descriptive results, not exceptions', async () => {
  const { ctl } = makeBoard();
  await ctl.sync();
  await ctl.call('check_in', { name: 'ChatGPT' });
  const r = await ctl.call('propose_assignment', { team: 'Nobody', segment: 'B2', rationale: 'This rationale is long enough.' });
  assert.equal(r.ok, false);
  assert.match(r.error, /No team matches/);
  assert.match(r.hint, /Known teams/);
  const r2 = await ctl.call('mark_clue', { description: 'x' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /not registered/);
});

test('team_lead check in requires a team and scopes proposals', async () => {
  const { ctl, board } = makeBoard();
  await ctl.sync();
  const bad = await ctl.call('check_in', { name: 'Codex', role: 'team_lead' });
  assert.equal(bad.ok, false);
  assert.equal(board.agent, null);
  const good = await ctl.call('check_in', { name: 'Codex', role: 'team_lead', team: 'Ground 2' });
  assert.equal(good.ok, true);
  const r = await ctl.call('propose_assignment', { team: 'Ground 6', segment: 'B2', rationale: 'Trying to move a team that is not mine.' });
  assert.equal(r.ok, false);
  assert.match(r.error, /may only propose/);
});

test('read tools return serializable structured data', async () => {
  const { ctl } = makeBoard();
  await ctl.sync();
  for (const n of READ) {
    const r = await ctl.call(n, n === 'explain_coverage' ? { segment: 'B2' } : n === 'rank_segments_for_team' ? { team: 'Drone 5' } : {});
    assert.ok(r && typeof r === 'object', n);
    assert.notEqual(r.ok, false, `${n}: ${r.error}`);
    JSON.stringify(r);
  }
});

test('team_lead check in with an unknown team writes nothing', async () => {
  const { ctl, board } = makeBoard();
  await ctl.sync();
  const logBefore = board.state.log.length;
  const r = await ctl.call('check_in', { name: 'Codex', role: 'TEAM_LEAD', team: 'Ground 99' });
  assert.equal(r.ok, false);
  assert.match(r.hint, /Known teams/);
  assert.equal(board.agent, null);
  assert.equal(board.state.agents.length, 0);
  assert.equal(board.state.log.length, logBefore);
});

test('role is normalized so TEAM_LEAD cannot become an unscoped team lead', async () => {
  const { ctl, board } = makeBoard();
  await ctl.sync();
  const r = await ctl.call('check_in', { name: 'Codex', role: 'TEAM_LEAD' });
  assert.equal(r.ok, false);
  assert.equal(board.agent, null);
});

test('registration passes an AbortSignal and removal aborts it', async () => {
  const board = { state: seededState(), agent: null, commit() {} };
  const seen = new Map();
  const mc = {
    async registerTool(t, opts) { seen.set(t.name, opts?.signal); },
  };
  const ctl = createToolController(board, mc);
  await ctl.sync();
  assert.ok(seen.get('check_in') instanceof AbortSignal, 'registerTool receives a signal');
  assert.equal(seen.get('check_in').aborted, false);
  await ctl.call('check_in', { name: 'ChatGPT' });
  assert.equal(seen.get('check_in').aborted, true, 'removing a tool aborts its signal even without unregisterTool');
});

test('schemas carry bounds for numeric and free-text inputs', async () => {
  const { ctl } = makeBoard();
  await ctl.sync();
  await ctl.call('check_in', { name: 'ChatGPT' });
  const pa = ctl.get('propose_assignment').inputSchema.properties;
  assert.equal(pa.hours.minimum, 0.5);
  assert.equal(pa.hours.maximum, 6);
  assert.ok(pa.rationale.maxLength > 0);
  const rd = ctl.get('request_decision').inputSchema.properties;
  assert.equal(rd.options.minItems, 2);
  assert.equal(rd.options.maxItems, 4);
});
