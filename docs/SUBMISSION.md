# Devpost submission text

**Project name:** GridBoard

**Tagline:** An agent-native search and rescue incident board. Your agent plans. The incident commander decides.

**Live URL:** https://gridboard-puce.vercel.app
**Repo:** https://github.com/Meliwat/gridboard (MIT)
**Video:** https://youtu.be/LmdLcHETILI

---

## Inspiration

Wilderness search and rescue is run by volunteers on whiteboards. The first hours decide most outcomes, and the incident commander is juggling a probability map, six tired teams, fading daylight, weather, and a radio. The math of search theory (probability of area, probability of detection, expected gain) has been understood for decades, but nobody at a trailhead at dusk has time to run it. The National Missing and Unidentified Persons System listed over 26,000 active missing-person cases in early 2026, and the National Park Service alone runs thousands of searches a year.

That is exactly the shape of problem where a human and an agent are better together than either alone. The agent has breadth: it can read every segment and every team and run the numbers in seconds. The human has judgment: they can see the terrain, hear the radio, and know which volunteer is done for the day. WebMCP is the first thing that lets both of them work on the same live board.

## Why this use case fits WebMCP

A chatbot cannot do this job. The state that matters is on the page: which segments have been searched, at what coverage, who is where, what is staged and what is approved. With WebMCP the agent reads that state directly through typed tools instead of screenshots, its actions render on the board instantly, and the human can intervene at any moment. The agent sees the new state on its next call.

It also fits because the domain demands a hard line between advising and acting. WebMCP tools run in the page, so the page decides what the agent can do and when. GridBoard uses that to enforce a rule no prompt could: **there is no tool that dispatches a team.**

## What humans and agents can do together

- The commander says "we lost daylight, replan the east side." The agent reads the briefing, ranks segments by expected gain for each available team, and stages two assignment proposals with rationale, estimated POD and expected gain. The commander approves one, rejects one with a reason, and both decisions are logged with who proposed and who decided.
- The commander drags their attention to a segment and says "Ground 2 found a blue glove here." The agent logs the clue in the focused segment under Ground 2's name.
- A team radios in. The commander marks them returning; a `debrief_team` tool appears for the agent, it records the coverage, and remaining probability shifts across the whole map.
- The agent hits a call it should not make alone ("hold the drone for night thermal, or launch now?") and asks the commander a question with options. Only the human can answer it.
- Two people can bring two agents. A planning agent may propose for any team. A team lead's agent, checked in for Ground 2, can only propose for Ground 2.

None of this was possible before: an agent that can run the search math on the live board, whose every action is attributed and reversible, and that structurally cannot dispatch.

## How WebMCP is implemented

All tools are registered with `document.modelContext.registerTool` in `src/tools.js`, and the registered set is reconciled against board state after every change.

**Three classes.** Eight read tools (`readOnlyHint: true`) so the agent never clicks through the UI to read; `read_log` also carries `untrustedContentHint` because log entries are field reports written by other people and agents. One navigation tool, `focus_segment`. Write tools appear only after `check_in` with a name and role, and every write is attributed to that name.

**Capability follows state.** `check_in` exists only while no agent is checked in. `mark_clue` exists only while a segment is focused, so a clue lands in the right place. `withdraw_proposal` exists only while a proposal is staged. `debrief_team` exists only while a team is returning. `approve_proposal` never exists.

**Staged, then approved.** `propose_assignment` validates the request (team and segment exist, rationale is at least a sentence, the team is not spent, no duplicate for that team), computes estimated POD and expected gain, and stages a card. The team does not move until the commander's Approve button.

**Agent experience.** Inputs are natural-language names ("K9 Juno", "Pika Overlook"), not ids. Errors come back as `{ ok, error, hint }` so the agent self-corrects: a wrong team name returns the list of known teams. The Site tools tab shows the human the live tool list, flashes tools as they appear, and lists which tools are locked and why.

**Verified in the real thing.** `npm test` covers the engine and the registration logic. `test/e2e-chrome.mjs` launches real Chrome with WebMCP enabled, confirms the browser accepted the registrations (it rejects a duplicate name with `InvalidStateError`), drives the tools as an agent would, and checks that the tool set changes with board state and that a proposal never moves a team.

## Built with

Vanilla JavaScript, SVG, Vite, Vercel. No framework, no backend, no API keys. Search theory: Bayesian POA update, cumulative POD, expected gain.

## What's next

A small realtime backend so a commander, a planner and three team leads can bring their own agents to one shared board. Import of real segment polygons from CalTopo/SARTopo. Night operations mode with thermal UAV constraints.
