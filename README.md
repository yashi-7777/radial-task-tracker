# Radial Task Tracker + AI Syllabus Planner

A radial (Instagram-coloured) task tracker that runs as a static site (GitHub Pages), plus an **AI Syllabus Planner**:
upload a syllabus, review what was extracted, answer a few questions, get a day-by-day study plan, approve it, and it
syncs into your radial timelines, to-dos and progress.

## How it is built

```
Browser (static, GitHub Pages)                 Node server (server/, optional but needed for PDF/Excel/Word + AI)
  index.html, app.js, pages.js                   POST /api/parse    file -> text/structure (worker thread, size + magic-byte checks)
  study*.js  (Study Planner UI)                  POST /api/analyze  syllabus -> units/topics via Anthropic API (tool use)
  planner.js (deterministic scheduler)           POST /api/chat     grounded assistant, proposes plan changes
  syllabus-parse.js (rule-based parser)          GET  /api/status   what the server can do
  localStorage: radial-tracker-state-v2
```

* The **API key never reaches the browser**. Only the server reads `ANTHROPIC_API_KEY`.
* Without the server, the planner still works for **TXT / CSV / Markdown / pasted text** (rule-based parser, deterministic
  scheduler, calendar, tracking, rescheduling). PDF, Excel, Word and all AI features need the server; the UI says so and never
  pretends AI ran when it did not.
* `planner.js` and `syllabus-parse.js` are shared by browser and Node (and unit-tested in Node).
* Scheduling is plain code, not AI: capacity = study days x hours x (1 - buffer). The plan never exceeds your hours/day or
  deadline; if it cannot fit, it shows the shortfall and verified alternatives (more hours, later deadline, skip low-priority topics, lighter revision).

## Run locally

```bash
npm install
cp .env.example .env        # then set ANTHROPIC_API_KEY (optional: without it, parsing works but AI is off)
npm start                   # http://localhost:8787 serves the app AND the API
npm test                    # 32 tests: parsing, scheduling constraints, persistence, server
```

## Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables AI analysis + assistant. Server-side only. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model used. |
| `PORT` | `8787` | Listen port. |
| `ALLOWED_ORIGINS` | same-origin only | Comma list of allowed browser origins, e.g. `https://yashi-7777.github.io`. |
| `ACCESS_TOKEN` | – | If set, every API call needs `Authorization: Bearer <token>`. Strongly recommended on a public server. |
| `MAX_UPLOAD_MB` | `10` | Upload limit. |
| `AI_LIMIT_PER_10MIN` / `PARSE_LIMIT_PER_10MIN` | `30` / `60` | Per-client rate limits. |
| `TRUST_PROXY` | – | Set `1` behind a reverse proxy/host (Render, Railway…) so rate limits use the real client IP. |

## Using it from GitHub Pages

GitHub Pages is static, so host the server separately (Render, Railway, Fly, a VPS…):

1. Deploy this repo as a Node web service: build `npm install`, start `npm start`.
2. Set `ANTHROPIC_API_KEY`, `ALLOWED_ORIGINS=https://yashi-7777.github.io`, `ACCESS_TOKEN=<long random string>`, `TRUST_PROXY=1`.
3. Open the app -> **Study Planner** -> *Connection settings*, paste the server URL and the token, **Save & test**.
   (They are stored only in your browser's localStorage.)

## Supported files and limits

PDF (text-based), `.xlsx`, `.xls`, `.docx`, `.csv`, `.tsv`, `.txt`, `.md`; up to 10 MB. Types are checked by extension **and**
file signature. Scanned/image-only PDFs are detected and rejected with a clear message (paste the text instead; no OCR).
Old `.doc` is not supported (save as `.docx`). Parsing runs in an isolated worker with time/memory limits because the
`xlsx` package has known unpatched advisories; do not expose the server without `ACCESS_TOKEN`.

## Honest notes

* Real AI calls need your key and were **not live-tested** in development (no key available). The request/response contract,
  tool-use handling, validation and fallbacks are tested against a local mock of the Anthropic API.
* AI output is validated server-side; plan changes the assistant suggests are only proposals until you click Apply.
* If AI analysis fails, the rule-based parse is used and clearly labelled as such.
