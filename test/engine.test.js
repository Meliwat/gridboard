import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seededState, remainingPoa, cumulativePod, estimatePod, checkIn, proposeAssignment, proposeRest,
  approveProposal, rejectProposal, withdrawProposal, focusSegment, markClue, debriefTeam, requestDecision,
  answerDecision, undo, rankSegmentsForTeam, briefing, EngineError, findSegment, findTeam,
} from '../src/engine.js';

test('remaining POA sums to 100 and searched segments lose mass', () => {
  const s = seededState();
  const poa = remainingPoa(s);
  const total = Object.values(poa).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
  const a1 = s.segments.find((x) => x.id === 'A1');
  assert.ok(cumulativePod(a1) > 0.7);
  assert.ok(poa.A1 < a1.initialPoa);
});

test('cumulative POD combines searches', () => {
  const seg = { searches: [{ pod: 0.5 }, { pod: 0.5 }] };
  assert.equal(cumulativePod(seg), 0.75);
});

test('estimatePod is bounded and increases with hours', () => {
  const s = seededState();
  const team = findTeam(s, 'Ground 6');
  const seg = findSegment(s, 'C2');
  const p1 = estimatePod(team, seg, 1);
  const p3 = estimatePod(team, seg, 3);
  assert.ok(p1 > 0 && p1 < p3 && p3 <= 0.95);
});

test('writes require a checked-in agent', () => {
  const s = seededState();
  assert.throws(() => proposeAssignment(s, null, 'T6', 'B2', 'Because the cliffs are highest POA.'), EngineError);
});

test('proposal is staged, not applied, until the human approves', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const p = proposeAssignment(s, agent, 'Ground 6', 'Pika Overlook', 'Highest remaining POA, cliff band unsearched, team has rope skills.', 2);
  assert.equal(p.status, 'staged');
  assert.equal(findTeam(s, 'T6').segment, null);
  approveProposal(s, p.id, 'IC');
  assert.equal(findTeam(s, 'T6').segment, 'B2');
  assert.equal(findTeam(s, 'T6').status, 'en route');
  assert.ok(s.log.at(-1).text.startsWith('APPROVED'));
});

test('rejecting leaves the team untouched and logs the reason', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const p = proposeAssignment(s, agent, 'K9 Juno', 'North drainage', 'Air scent works well in the drainage with a west wind.');
  rejectProposal(s, p.id, 'IC', 'Wind is wrong for scent.');
  assert.equal(findTeam(s, 'T4').segment, null);
  assert.match(s.log.at(-1).text, /REJECTED .*Wind is wrong/);
});

test('duplicate staged proposal for one team is refused with a hint', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  proposeAssignment(s, agent, 'T6', 'B2', 'Highest remaining POA and unsearched cliffs.');
  assert.throws(() => proposeAssignment(s, agent, 'T6', 'C2', 'Second idea for the same team.'), /already a staged proposal/);
});

test('spent teams cannot be assigned', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  findTeam(s, 'T1').hoursOnTask = 6.5;
  assert.throws(() => proposeAssignment(s, agent, 'T1', 'D1', 'They are close to the creek trail already.'), /spent/);
  const r = proposeRest(s, agent, 'T1', 'Six and a half hours on task, light fading.');
  assert.equal(r.kind, 'rest');
});

test('team lead agents may only propose for their own team', () => {
  const s = seededState();
  const agent = checkIn(s, 'Codex', 'team_lead');
  agent.team = 'T2';
  assert.throws(() => proposeAssignment(s, agent, 'T6', 'B2', 'Trying to move another team somewhere else.'), /may only propose/);
  const p = proposeAssignment(s, agent, 'T2', 'B2', 'We are already adjacent and can push into the cliff band.');
  assert.equal(p.team, 'T2');
});

test('clues require a focused segment', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  assert.throws(() => markClue(s, agent, 'Blue glove near creek'), /No segment is focused/);
  focusSegment(s, 'D1');
  const c = markClue(s, agent, 'Blue glove near creek crossing', 'Ground 1');
  assert.equal(c.segment, 'D1');
  assert.equal(c.foundBy, 'Ground 1');
});

test('debrief only for returning teams and updates POA', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  assert.throws(() => debriefTeam(s, agent, 'Ground 6', 'A1', 50, 'x'), /not returning/);
  const before = remainingPoa(s).C1;
  debriefTeam(s, agent, 'Hasty 3', 'C1', 40, 'Second pass on the saddle.');
  assert.ok(remainingPoa(s).C1 < before);
  assert.equal(findTeam(s, 'T3').status, 'available');
});

test('decisions are asked by agents and answered by humans only', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const d = requestDecision(s, agent, 'Hold Drone 5 for night thermal or launch now?', ['Hold', 'Launch']);
  assert.equal(d.status, 'open');
  answerDecision(s, d.id, 'Launch', 'IC');
  assert.equal(s.decisions[0].answer, 'Launch');
});

test('undo reverts the last write', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const p = proposeAssignment(s, agent, 'T6', 'B2', 'Highest remaining POA, unsearched cliff band.');
  approveProposal(s, p.id);
  assert.equal(findTeam(s, 'T6').segment, 'B2');
  undo(s);
  assert.equal(findTeam(s, 'T6').segment, null);
  assert.equal(s.proposals[0].status, 'staged');
});

test('withdraw proposal', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const p = proposeAssignment(s, agent, 'T6', 'B2', 'Highest remaining POA, unsearched cliff band.');
  withdrawProposal(s, agent, p.id);
  assert.equal(p.status, 'withdrawn');
  assert.throws(() => approveProposal(s, p.id), /No staged proposal/);
});

test('ranking prefers high remaining POA with good detectability', () => {
  const s = seededState();
  const ranked = rankSegmentsForTeam(s, findTeam(s, 'Drone 5'), 1.5);
  assert.equal(ranked.length, s.segments.length);
  assert.ok(ranked[0].expectedGain >= ranked.at(-1).expectedGain);
  // gain is in probability points: remaining POA (percent) times POD (fraction)
  assert.ok(Math.abs(ranked[0].expectedGain - ranked[0].remainingPoa * ranked[0].estimatedPod) < 1e-9);
  assert.ok(ranked[0].expectedGain > 1, 'gain should be in points, not a fraction of a percent');
});

test('briefing is structured and serializable', () => {
  const s = seededState();
  const b = briefing(s);
  assert.ok(b.daylightRemainingHours > 0);
  assert.equal(b.highestRemainingPoa.length, 3);
  JSON.stringify(b);
});

test('lookups fail with actionable hints', () => {
  const s = seededState();
  try {
    findSegment(s, 'Z9');
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof EngineError);
    assert.match(e.hint, /Known segments/);
  }
});

test('undo after an agent log entry removes only that entry', async () => {
  const { agentLogEntry } = await import('../src/engine.js');
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const p = proposeAssignment(s, agent, 'T6', 'B2', 'Highest remaining POA, unsearched cliff band.');
  agentLogEntry(s, agent, 'Considering the drainage next.');
  undo(s);
  assert.equal(s.proposals.find((x) => x.id === p.id).status, 'staged', 'proposal survives undo of the note');
  assert.ok(!s.log.some((l) => /Considering the drainage/.test(l.text)));
});

test('undo after check in removes the agent and its log line', () => {
  const s = seededState();
  const before = s.log.length;
  checkIn(s, 'ChatGPT', 'planning');
  undo(s);
  assert.equal(s.agents.length, 0);
  assert.equal(s.log.length, before);
});

test('proposing for a searching team is flagged as a reassignment', () => {
  const s = seededState();
  const agent = checkIn(s, 'ChatGPT', 'planning');
  const p = proposeAssignment(s, agent, 'Ground 2', 'B2', 'They are adjacent to the cliff band and fresh enough.');
  assert.equal(p.reassignment, true);
  assert.equal(p.pullsFrom, 'B1');
  const q = proposeAssignment(s, agent, 'Ground 6', 'C2', 'Fresh team for the hardest timber.');
  assert.equal(q.reassignment, false);
});
