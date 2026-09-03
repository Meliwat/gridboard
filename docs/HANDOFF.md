# Handoff: GridBoard, OpenAI WebMCP Challenge

Written 2026-09-02, late evening. Deadline: **Thursday 2026-09-03, 1:00 pm PT** (Devpost). Winners announced Sept 23.

## Where things are

| Thing | Location |
|---|---|
| Code | `~/gridboard` (git, branch `master`, clean, pushed) |
| Repo | https://github.com/Meliwat/gridboard (public, MIT) |
| Live app | https://gridboard-puce.vercel.app (Vercel project `gridboard`, deploy with `vercel --prod --yes` from the repo root) |
| Demo video | `~/Desktop/gridboard-demo.mp4` (1:55, narrated, 1440x900). Regenerate with `node test/record-demo.mjs` |
| Devpost text | `docs/SUBMISSION.md` (paste section by section) |
| Cover image | `docs/screenshot.png` |
| Video shot list | `docs/VIDEO.md` (only if re-recording inside ChatGPT desktop) |
| Devpost | https://webmcp.devpost.com/ |

## What is done and verified

- App complete: SVG map, staged-then-approved proposals, roles, undo, log, decisions, Site tools tab.
- WebMCP: 15 tools via `document.modelContext.registerTool`, per-tool `AbortSignal` for removal (Chrome 152 has no `unregisterTool`; abort is what removes a tool), serialized reconciliation, `readOnlyHint` and `untrustedContentHint` set, schemas bounded.
- Tests: `npm test` (30, node:test). `node test/e2e-chrome.mjs <url>` runs real Chrome with `--enable-features=WebMCP` and asserts through the browser's own `getTools()` and `executeTool()`. Both green against production as of the last commit.
- Two Codex reviews. All confirmed findings fixed (tool lifecycle, stored XSS through decision options, undo gaps, transactional team_lead check-in, expected gain units).

## Remaining steps (user-only, about 15 minutes)

1. **Upload the video to YouTube** (public or unlisted). Then paste the link into `README.md` (the Live line) and `docs/SUBMISSION.md` (the "Video:" line), commit, push.
2. **Test in ChatGPT desktop** (only untested surface). Built-in browser, open the live URL, click "Site tools" in the address bar to see the registered tools, then say: "Check in as ChatGPT and brief me on the incident." Then: "We lost daylight. Replan the east side with the teams we have." Approve a card on the board. If ChatGPT reports a tool error, capture the exact text; the tool layer is in `src/tools.js`, the engine in `src/engine.js`.
3. **Submit on Devpost.** Fields: project name GridBoard; tagline and sections from `docs/SUBMISSION.md`; live URL; repo URL; YouTube URL; license MIT; cover `docs/screenshot.png`; built with: JavaScript, SVG, Vite, Vercel, WebMCP. Submit before 1:00 pm PT.

## If time allows (not required)

- Re-record the video inside ChatGPT desktop so judges see real tool calls in the chat pane. `docs/VIDEO.md` matches the narration beat for beat.
- Realtime shared board (multiple people, each with their own agent) is the stated next step in the README; do not start it before submitting.

## Known limits, stated in the README

Single-browser state (no backend), synthetic scenario, simplified search theory, no declarative tools (ChatGPT's browser does not support them).
