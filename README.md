# GridBoard

**An agent-native search and rescue incident board. Your agent plans. The incident commander decides.**

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/). Live: **https://gridboard.vercel.app** (open it in ChatGPT's desktop browser, or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`).

Every year, tens of thousands of people go missing outdoors, and the first hours of a search decide most outcomes. An incident commander (IC) running a wilderness search is juggling probability maps, team fatigue, daylight, weather and radio traffic, mostly on paper and whiteboards. The math of search theory (probability of area, probability of detection, expected gain) is well understood but nobody has time to run it live.

GridBoard puts a human and their agent on the same live board. The agent has superhuman breadth: it reads every segment, every team's fatigue, runs the coverage math, and proposes a plan in seconds. The human keeps judgment: every assignment lands as a staged card that only the IC can approve. **There is no tool that dispatches a team.** Capability follows state, so the agent literally cannot take an action the board is not ready for.

## What humans and agents do together

| Human (incident commander) | Agent (ChatGPT, Codex, or any WebMCP client) |
|---|---|
| Sees the map, radio traffic, the faces of tired volunteers | Reads all nine segments and six teams in one call |
| Clicks a segment to focus it | Ranks segments by expected gain for a given team |
| Approves or rejects each staged proposal | Proposes assignments and rests with a written rationale |
| Answers questions the agent cannot answer | Asks the IC a question with options when judgment is needed |
| Marks a team returning from the field | Records the debrief and updates remaining probability |
| Undoes any write, human or agent | Logs its reasoning to the ICS 214 activity log under its own name |

## How WebMCP is used

All tools are registered with `document.modelContext.registerTool` (with a `navigator.modelContext` fallback) in [`src/tools.js`](src/tools.js). The registration set is reconciled against board state after every change, so the tool list an agent sees is a live description of what the board will accept right now.

**Three classes of tools**

- **Read tools, always on, `readOnlyHint: true`.** `describe_incident`, `list_segments`, `get_team_status`, `explain_coverage`, `rank_segments_for_team`, `list_proposals`, `read_log` (also `untrustedContentHint`, since log entries are field reports written by other people and agents), `generate_briefing`. The agent never has to click through the UI to read.
- **Navigation.** `focus_segment` highlights a segment for the human and makes it the focused segment.
- **Write tools, only after `check_in`.** An agent must check in with a display name and a role before any write tool exists. Every write is attributed to that name in the log. `propose_assignment`, `propose_rest`, `log_entry`, `request_decision`.

**Capability follows state (dynamic registration)**

| Tool | Exists only while |
|---|---|
| `check_in` | no agent is checked in |
| `mark_clue` | a segment is focused, so the clue lands in the right place |
| `withdraw_proposal` | at least one proposal is staged |
| `debrief_team` | a team has status *returning* |
| `approve_proposal` | **never**. Only the IC's button on the board applies an assignment. |

**Roles.** `planning` agents may propose for any team. `team_lead` agents must name their team and may only propose for it. Two people can bring two agents to the same board with different authority.

**Staged, then approved.** `propose_assignment` validates the request (team exists, segment exists, rationale is at least a sentence, team is not spent, no duplicate staged proposal for that team), computes the estimated POD and expected gain, and stages a card. The team does not move. The IC approves or rejects on the board; both outcomes are logged with who proposed and who decided.

**Descriptive errors.** Engine errors come back as `{ ok: false, error, hint }` so the agent can self-correct: a bad team name returns the list of known teams, a clue with no focused segment says to call `focus_segment` first.

**Human observability.** The *Site tools* tab shows the live registered tool list, flashes tools as they appear, and lists the tools that are currently locked and why. Every agent action is a line in the log. Undo reverts the last write, whoever made it.

## Search theory in the engine

- Remaining POA per segment = initial POA × (1 − cumulative POD), normalized to 100. Cumulative POD = 1 − Π(1 − POD of each search).
- Estimated POD for a team on a segment = 1 − exp(−coverage × detectability × k), where coverage depends on team type, size, fatigue and hours.
- Expected gain = remaining POA × estimated POD. `rank_segments_for_team` sorts by it.

All numbers are synthetic and the scenario is fictional. It is a training board, not a real incident.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # engine + tool registration tests (node:test)
npm run build
node test/e2e-chrome.mjs http://localhost:4173/   # real Chrome with --enable-features=WebMCP, after `npm run preview`
```

Add `?dev=1` to the URL for a console that calls tools the way an agent would, useful in browsers without WebMCP.

## Try saying, in ChatGPT's browser

- "Check in as ChatGPT and brief me on the incident."
- "We lost daylight. Replan the east side with the teams we have."
- "Where should K9 Juno go next and why?"
- "Ground 2 found a blue glove on the creek trail. Log it."
- "Debrief Hasty 3: C1 at 40 percent, nothing seen."

## Stack

Vanilla JavaScript, one SVG map, no framework, no backend. Vite for bundling. State persists in `localStorage`; the agent identity persists per tab. MIT licensed.

## Status and honest limits

- Single-browser state. Two people on two machines do not yet share a board; that is the obvious next step (a small realtime backend) and the role model is already built for it.
- The scenario is synthetic. POD numbers are a simplified model of search theory, good enough to make the trade-offs real, not a substitute for a trained planner.
- Declarative HTML tools and iframes are not used because ChatGPT's browser does not support them yet.
