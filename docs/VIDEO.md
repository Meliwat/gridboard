# Demo video shot list (target 2:30, hard cap 3:00)

Record in ChatGPT desktop with the built-in browser open on https://gridboard-puce.vercel.app. Screen record the whole ChatGPT window so judges see the chat and the board side by side. Voiceover live or after. Reset the board before recording.

## 0:00 to 0:15 · Cold open
Black screen, one line of text: "26,000 people are listed as missing in the US right now." Then: "Wilderness search and rescue still runs on whiteboards."
Voice: "This is GridBoard. Your agent plans. The incident commander decides."

## 0:15 to 0:35 · The board
Show the board. Point at the map, remaining probability by segment, teams, daylight left 1.9 hours.
Voice: "A synthetic incident. A hiker is overdue. Six teams, nine segments, and the sun goes down in under two hours. Everything on this page is exposed to my agent through WebMCP as site tools."
Click the Site tools tab briefly: 10 tools, read tools blue, check_in the only write.

## 0:35 to 1:05 · Check in and brief
Type: "Check in as ChatGPT and brief me on the incident."
Show the agent calling check_in, then generate_briefing. Cut to the Site tools tab: write tools flash in, check_in disappears.
Voice: "Until it checks in with a name, it can read everything and write nothing. Now it has proposal tools, and every write carries its name."

## 1:05 to 1:45 · The replan (hero shot)
Type: "We lost daylight. Replan the east side with the teams we have."
Show the agent calling rank_segments_for_team and propose_assignment. Amber cards appear on the Decisions tab with rationale, estimated POD and expected gain.
Voice: "It ran the search math on every segment and staged two proposals. Nobody moved. There is no tool that dispatches a team. Only this button."
Approve one. The pin moves on the map. Reject the other with a reason. Show the log: proposed by ChatGPT, approved by IC.

## 1:45 to 2:10 · Capability follows state
Click Teams, mark Hasty 3 returning. Cut to Site tools: debrief_team appears.
Type: "Debrief Hasty 3: C1 at 40 percent, nothing seen."
Map recolors as probability shifts.
Voice: "Tools appear when the board is ready for them and disappear when it is not. The agent literally cannot log a debrief for a team that is still in the field."

## 2:10 to 2:30 · The question
Type: "Should we hold Drone 5 for night thermal? Ask me."
Agent calls request_decision. Blue card with options appears. Click one.
Voice: "When a call needs judgment, the agent asks. Only a human can answer."

## 2:30 to 2:50 · Close
Show the log scrolled, agent lines in purple, human decisions in green. Then the repo README for two seconds.
Voice: "Same board, two kinds of intelligence. Breadth from the agent, judgment from the human, and the page enforces which is which. GridBoard is open source, MIT, built on WebMCP."

## Tips
- Keep the ChatGPT chat visible so the tool calls are on screen.
- If ChatGPT asks for confirmation before a write, accept it on camera. That is the point.
- If a call fails, do not cut. Say "and the error tells it how to fix itself" and let the agent retry.
