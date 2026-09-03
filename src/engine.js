// GridBoard engine: pure state transitions. No DOM, no WebMCP.
// Every write goes through apply() so it can be logged, attributed, and undone.

import { SCENARIO, TEAM_RATES } from './scenario.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export class EngineError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

export function createInitialState() {
  const s = clone(SCENARIO);
  return {
    incident: s.incident,
    points: s.points,
    trails: s.trails,
    segments: s.segments.map((seg) => ({ ...seg, initialPoa: seg.poa, searches: [] })),
    teams: s.teams,
    clues: s.clues,
    log: s.log,
    proposals: [],
    decisions: [],
    agents: [],
    focusedSegment: null,
    completedSearches: [],
    nextId: 100,
    history: [],
  };
}

export function seededState() {
  const state = createInitialState();
  for (const cs of SCENARIO.completedSearches) {
    recordSearch(state, cs.team, cs.segment, cs.pod, cs.note, 'IC', { silent: true });
  }
  return state;
}

// ---------- Search theory ----------

// Cumulative POD for a segment: 1 - product(1 - pod_i)
export function cumulativePod(segment) {
  let miss = 1;
  for (const s of segment.searches) miss *= 1 - s.pod;
  return 1 - miss;
}

// Bayesian update: remaining probability of area after searches, normalized to 100.
export function remainingPoa(state) {
  const raw = state.segments.map((seg) => seg.initialPoa * (1 - cumulativePod(seg)));
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  state.segments.forEach((seg, i) => {
    out[seg.id] = (raw[i] / total) * 100;
  });
  return out;
}

// Expected POD for a team searching a segment for `hours`.
export function estimatePod(team, segment, hours) {
  const rate = TEAM_RATES[team.type] ?? 10;
  const membersFactor = team.type === 'ground' ? team.members / 4 : 1;
  const fatigue = fatigueFactor(team);
  const coverage = (rate * membersFactor * fatigue * hours) / segment.areaHa;
  const pod = 1 - Math.exp(-coverage * segment.detect * 1.6);
  return Math.max(0, Math.min(0.95, pod));
}

export function fatigueLevel(team) {
  const h = team.hoursOnTask;
  if (h >= 6) return 'spent';
  if (h >= 4) return 'tired';
  if (h >= 2) return 'working';
  return 'fresh';
}

function fatigueFactor(team) {
  return { fresh: 1, working: 0.9, tired: 0.7, spent: 0.4 }[fatigueLevel(team)];
}

export function hoursOfDaylight(state) {
  const now = new Date(state.incident.now);
  const sunset = new Date(state.incident.sunset);
  return Math.max(0, (sunset - now) / 3.6e6);
}

// Probability of success ranking: which segment gives the most expected gain for a team.
export function rankSegmentsForTeam(state, team, hours) {
  const poa = remainingPoa(state);
  return state.segments
    .map((seg) => {
      const pod = estimatePod(team, seg, hours);
      return { segment: seg.id, name: seg.name, remainingPoa: poa[seg.id], estimatedPod: pod, expectedGain: poa[seg.id] * pod };
    })
    .sort((a, b) => b.expectedGain - a.expectedGain);
}

// ---------- Lookups ----------

export function findSegment(state, ref) {
  if (!ref) throw new EngineError('Segment is required.', 'Use list_segments to see segment ids and names.');
  const r = String(ref).trim().toLowerCase();
  const seg = state.segments.find((s) => s.id.toLowerCase() === r || s.name.toLowerCase() === r || s.name.toLowerCase().includes(r));
  if (!seg) throw new EngineError(`No segment matches "${ref}".`, `Known segments: ${state.segments.map((s) => `${s.id} ${s.name}`).join('; ')}.`);
  return seg;
}

export function findTeam(state, ref) {
  if (!ref) throw new EngineError('Team is required.', 'Use get_team_status to see team callsigns.');
  const r = String(ref).trim().toLowerCase();
  const team = state.teams.find((t) => t.id.toLowerCase() === r || t.callsign.toLowerCase() === r || t.callsign.toLowerCase().includes(r));
  if (!team) throw new EngineError(`No team matches "${ref}".`, `Known teams: ${state.teams.map((t) => `${t.callsign} (${t.id})`).join('; ')}.`);
  return team;
}

export function teamSummary(state, team) {
  return {
    id: team.id,
    callsign: team.callsign,
    type: team.type,
    members: team.members,
    status: team.status,
    assignedSegment: team.segment,
    hoursOnTask: team.hoursOnTask,
    fatigue: fatigueLevel(team),
    skills: team.skills,
    segmentsSearched: team.segmentsSearched,
  };
}

export function segmentSummary(state, seg) {
  const poa = remainingPoa(state);
  const teamsHere = state.teams.filter((t) => t.segment === seg.id).map((t) => t.callsign);
  const cluesHere = state.clues.filter((c) => c.segment === seg.id).map((c) => c.id);
  return {
    id: seg.id,
    name: seg.name,
    terrain: seg.terrain,
    areaHa: seg.areaHa,
    initialPoa: seg.initialPoa,
    remainingPoa: round(poa[seg.id]),
    cumulativePod: round(cumulativePod(seg) * 100),
    status: teamsHere.length ? 'in progress' : seg.searches.length ? 'searched' : 'unsearched',
    teamsAssigned: teamsHere,
    clues: cluesHere,
    searches: seg.searches,
  };
}

export const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- Writes ----------

function nowStamp(state) {
  const d = new Date(state.incident.now);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function snapshot(state) {
  const { history, ...rest } = state;
  history.push(clone(rest));
  if (history.length > 50) history.shift();
}

export function undo(state) {
  const prev = state.history.pop();
  if (!prev) throw new EngineError('Nothing to undo.');
  Object.assign(state, prev);
  return state;
}

export function addLog(state, author, text, kind = 'note') {
  const entry = { id: `L${state.nextId++}`, time: nowStamp(state), author, text, kind };
  state.log.push(entry);
  return entry;
}

// Attributed note from an agent. Snapshotted so Undo removes exactly this note.
export function agentLogEntry(state, agent, text) {
  requireAgent(agent);
  if (!text || !String(text).trim()) throw new EngineError('Text is required.');
  snapshot(state);
  return addLog(state, agent.name, String(text).trim(), 'agent');
}

export function recordSearch(state, teamRef, segmentRef, pod, note, author, opts = {}) {
  const team = findTeam(state, teamRef);
  const seg = findSegment(state, segmentRef);
  if (!opts.silent) snapshot(state);
  seg.searches.push({ team: team.callsign, pod, note, time: nowStamp(state) });
  if (!team.segmentsSearched.includes(seg.id)) team.segmentsSearched.push(seg.id);
  if (!opts.silent) addLog(state, author, `${team.callsign} completed ${seg.id} ${seg.name}: POD ${round(pod * 100)}%. ${note || ''}`.trim(), 'search');
  return seg;
}

// Agents must check in before they can write. Identity is attributed on every write.
export function checkIn(state, name, role) {
  if (!name || !String(name).trim()) throw new EngineError('Agent name is required.', 'Give the name you want shown on the board, for example "ChatGPT".');
  const roles = ['planning', 'team_lead'];
  const r = String(role || 'planning').toLowerCase();
  if (!roles.includes(r)) throw new EngineError(`Unknown role "${role}".`, 'Role must be "planning" (may propose for any team) or "team_lead" (may propose only for its own team).');
  snapshot(state);
  const agent = { id: `G${state.nextId++}`, name: String(name).trim(), role: r, team: null, checkedInAt: nowStamp(state) };
  state.agents.push(agent);
  addLog(state, agent.name, `Agent checked in with role ${r}.`, 'agent');
  return agent;
}

export function assignAgentTeam(state, agent, teamRef) {
  const team = findTeam(state, teamRef);
  agent.team = team.id;
  return team;
}

export function proposeAssignment(state, agent, teamRef, segmentRef, rationale, hours = 2) {
  requireAgent(agent);
  const team = findTeam(state, teamRef);
  const seg = findSegment(state, segmentRef);
  if (agent.role === 'team_lead' && agent.team && agent.team !== team.id) {
    throw new EngineError(`${agent.name} is checked in as team lead for ${agent.team} and may only propose for that team.`);
  }
  if (!rationale || String(rationale).trim().length < 10) {
    throw new EngineError('A rationale of at least a sentence is required.', 'The incident commander approves proposals based on the rationale. Say why this team, why this segment, and why now.');
  }
  if (fatigueLevel(team) === 'spent') {
    throw new EngineError(`${team.callsign} has ${team.hoursOnTask}h on task and is spent. Propose a rest instead.`, 'Use propose_rest for this team.');
  }
  const dup = state.proposals.find((p) => p.status === 'staged' && p.team === team.id);
  if (dup) throw new EngineError(`There is already a staged proposal for ${team.callsign} (${dup.id}).`, 'Withdraw it with withdraw_proposal before proposing again.');
  const h = clampHours(hours);
  const pod = estimatePod(team, seg, h);
  const poa = remainingPoa(state)[seg.id];
  const pullsFrom = ['searching', 'en route'].includes(team.status) ? team.segment : null;
  snapshot(state);
  const p = {
    id: `P${state.nextId++}`,
    kind: 'assignment',
    reassignment: !!pullsFrom,
    pullsFrom,
    team: team.id,
    teamCallsign: team.callsign,
    segment: seg.id,
    segmentName: seg.name,
    hours: h,
    rationale: String(rationale).trim(),
    estimatedPod: round(pod * 100),
    remainingPoa: round(poa),
    expectedGain: round(poa * pod, 1),
    proposedBy: agent.name,
    status: 'staged',
    time: nowStamp(state),
  };
  state.proposals.push(p);
  addLog(state, agent.name, `Proposed ${team.callsign} to ${seg.id} ${seg.name} for ${h}h (est. POD ${p.estimatedPod}%)${pullsFrom ? `, pulling them off ${pullsFrom}` : ''}. Awaiting IC approval.`, 'proposal');
  return p;
}

export function proposeRest(state, agent, teamRef, rationale) {
  requireAgent(agent);
  const team = findTeam(state, teamRef);
  if (!rationale || String(rationale).trim().length < 10) {
    throw new EngineError('A rationale of at least a sentence is required.');
  }
  const dup = state.proposals.find((p) => p.status === 'staged' && p.team === team.id);
  if (dup) throw new EngineError(`There is already a staged proposal for ${team.callsign} (${dup.id}).`);
  snapshot(state);
  const p = {
    id: `P${state.nextId++}`,
    kind: 'rest',
    team: team.id,
    teamCallsign: team.callsign,
    rationale: String(rationale).trim(),
    proposedBy: agent.name,
    status: 'staged',
    time: nowStamp(state),
  };
  state.proposals.push(p);
  addLog(state, agent.name, `Proposed rest for ${team.callsign}. Awaiting IC approval.`, 'proposal');
  return p;
}

export function withdrawProposal(state, agent, proposalId) {
  requireAgent(agent);
  const p = state.proposals.find((x) => x.id === proposalId && x.status === 'staged');
  if (!p) throw new EngineError(`No staged proposal ${proposalId}.`, 'Use list_proposals to see staged proposals.');
  snapshot(state);
  p.status = 'withdrawn';
  addLog(state, agent.name, `Withdrew proposal ${p.id}.`, 'proposal');
  return p;
}

// Human only. There is no tool for this by design.
export function approveProposal(state, proposalId, by = 'IC') {
  const p = state.proposals.find((x) => x.id === proposalId && x.status === 'staged');
  if (!p) throw new EngineError(`No staged proposal ${proposalId}.`);
  snapshot(state);
  const team = findTeam(state, p.team);
  if (p.kind === 'assignment') {
    team.segment = p.segment;
    team.status = 'en route';
  } else if (p.kind === 'rest') {
    team.segment = null;
    team.status = 'resting';
  }
  p.status = 'approved';
  p.decidedBy = by;
  p.decidedAt = nowStamp(state);
  addLog(state, by, p.kind === 'assignment'
    ? `APPROVED ${p.id}: ${team.callsign} assigned to ${p.segment} ${p.segmentName}. Proposed by ${p.proposedBy}.`
    : `APPROVED ${p.id}: ${team.callsign} to rest. Proposed by ${p.proposedBy}.`, 'decision');
  return p;
}

export function rejectProposal(state, proposalId, by = 'IC', reason = '') {
  const p = state.proposals.find((x) => x.id === proposalId && x.status === 'staged');
  if (!p) throw new EngineError(`No staged proposal ${proposalId}.`);
  snapshot(state);
  p.status = 'rejected';
  p.decidedBy = by;
  p.reason = reason;
  addLog(state, by, `REJECTED ${p.id} (${p.teamCallsign}). ${reason}`.trim(), 'decision');
  return p;
}

export function focusSegment(state, segmentRef) {
  const seg = findSegment(state, segmentRef);
  state.focusedSegment = seg.id;
  return seg;
}

export function clearFocus(state) {
  state.focusedSegment = null;
}

export function markClue(state, agent, description, reportedBy) {
  requireAgent(agent);
  if (!state.focusedSegment) throw new EngineError('No segment is focused.', 'Call focus_segment first so the clue is placed in the right segment.');
  if (!description || String(description).trim().length < 5) throw new EngineError('Clue description is required.');
  snapshot(state);
  const clue = {
    id: `K${state.clues.length + 1}`,
    segment: state.focusedSegment,
    description: String(description).trim(),
    time: nowStamp(state),
    foundBy: reportedBy || agent.name,
    enteredBy: agent.name,
  };
  state.clues.push(clue);
  addLog(state, agent.name, `Clue ${clue.id} logged in ${clue.segment}: ${clue.description} (reported by ${clue.foundBy}).`, 'clue');
  return clue;
}

export function debriefTeam(state, agent, teamRef, segmentRef, podPercent, note) {
  requireAgent(agent);
  const team = findTeam(state, teamRef);
  if (team.status !== 'returning') throw new EngineError(`${team.callsign} is not returning, it is ${team.status}.`, 'Debriefs are only recorded for returning teams.');
  const pod = Number(podPercent);
  if (!(pod >= 0 && pod <= 100)) throw new EngineError('POD must be a percentage between 0 and 100.');
  const seg = findSegment(state, segmentRef);
  snapshot(state);
  seg.searches.push({ team: team.callsign, pod: pod / 100, note: note || '', time: nowStamp(state) });
  if (!team.segmentsSearched.includes(seg.id)) team.segmentsSearched.push(seg.id);
  team.status = 'available';
  team.segment = null;
  addLog(state, agent.name, `Debrief ${team.callsign} on ${seg.id}: POD ${pod}%. ${note || ''}`.trim(), 'search');
  return segmentSummary(state, seg);
}

export function requestDecision(state, agent, question, options) {
  requireAgent(agent);
  if (!question) throw new EngineError('Question is required.');
  const opts = Array.isArray(options) && options.length ? options.map(String) : ['Yes', 'No'];
  snapshot(state);
  const d = { id: `D${state.nextId++}`, question: String(question), options: opts, askedBy: agent.name, status: 'open', time: nowStamp(state) };
  state.decisions.push(d);
  addLog(state, agent.name, `Asked IC: ${d.question}`, 'question');
  return d;
}

export function answerDecision(state, decisionId, answer, by = 'IC') {
  const d = state.decisions.find((x) => x.id === decisionId && x.status === 'open');
  if (!d) throw new EngineError(`No open decision ${decisionId}.`);
  snapshot(state);
  d.status = 'answered';
  d.answer = answer;
  d.answeredBy = by;
  addLog(state, by, `Decision ${d.id}: "${d.question}" answered ${answer}.`, 'decision');
  return d;
}

export function updateConditions(state, patch) {
  snapshot(state);
  Object.assign(state.incident, patch);
  addLog(state, 'IC', `Conditions updated: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}.`, 'note');
}

export function advanceClock(state, minutes) {
  snapshot(state);
  const d = new Date(state.incident.now);
  d.setMinutes(d.getMinutes() + minutes);
  state.incident.now = d.toISOString().slice(0, 19);
  for (const t of state.teams) {
    if (['searching', 'en route'].includes(t.status)) t.hoursOnTask = round(t.hoursOnTask + minutes / 60, 1);
    if (t.status === 'en route') t.status = 'searching';
  }
  addLog(state, 'IC', `Clock advanced ${minutes} minutes.`, 'note');
}

function requireAgent(agent) {
  if (!agent) throw new EngineError('No agent is checked in.', 'Call check_in with your name and role first.');
}

function clampHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.min(6, Math.max(0.5, round(n, 1)));
}

// ---------- Briefing ----------

export function briefing(state) {
  const poa = remainingPoa(state);
  const daylight = hoursOfDaylight(state);
  const segs = state.segments
    .map((s) => segmentSummary(state, s))
    .sort((a, b) => b.remainingPoa - a.remainingPoa);
  const staged = state.proposals.filter((p) => p.status === 'staged');
  return {
    incident: state.incident.number,
    time: nowStamp(state),
    daylightRemainingHours: round(daylight, 1),
    weather: state.incident.weather,
    subject: state.incident.subject,
    highestRemainingPoa: segs.slice(0, 3).map((s) => ({ segment: s.id, name: s.name, remainingPoa: s.remainingPoa, cumulativePod: s.cumulativePod })),
    teams: state.teams.map((t) => teamSummary(state, t)),
    clues: state.clues,
    stagedProposals: staged,
    openDecisions: state.decisions.filter((d) => d.status === 'open'),
    note: 'Assignments take effect only when the incident commander approves a staged proposal on the board.',
    poaBySegment: Object.fromEntries(Object.entries(poa).map(([k, v]) => [k, round(v)])),
  };
}
