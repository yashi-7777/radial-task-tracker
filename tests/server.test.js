"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createServer } = require("../server/index.js");
const SP = require("../syllabus-parse.js");

const FIX = path.join(__dirname, "fixtures");
const KEY = "sk-test-SECRET-123";
let mock, mockPort, mockMode, mockSeen;
let app, base; // key + mock AI
let bare, bareBase; // no key
let locked, lockedBase; // token + origin allow list + tiny limits

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

before(async () => {
  mock = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const body = JSON.parse(b);
      mockSeen = { headers: req.headers, body };
      if (mockMode === "401") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "bad key" } })); }
      res.writeHead(200, { "content-type": "application/json" });
      if (body.tool_choice && body.tool_choice.name === "submit_syllabus") {
        if (mockMode === "empty") return res.end(JSON.stringify({ model: "m", content: [{ type: "text", text: "sorry" }] }));
        return res.end(JSON.stringify({ model: "mock-model", content: [{ type: "tool_use", name: "submit_syllabus", input: {
          title: "AI Course", units: [{ name: "Unit A", topics: [{ name: "Topic 1", difficulty: "HARD", importance: 9, hours: 2.3, subtopics: ["s1"] }, { name: "Topic 2", difficulty: "easy", importance: 2, prereqs: ["Topic 1"] }] }] } }] }));
      }
      return res.end(JSON.stringify({ model: "mock-model", content: [
        { type: "text", text: "This isn't in your uploaded syllabus." },
        { type: "tool_use", name: "set_daily_hours", input: { hours: 4 } },
        { type: "tool_use", name: "set_daily_hours", input: { hours: 99 } },
        { type: "tool_use", name: "extend_deadline", input: { date: "not-a-date" } },
        { type: "tool_use", name: "drop_database", input: {} }
      ] }));
    });
  });
  mockPort = await listen(mock);
  const aiBase = `http://127.0.0.1:${mockPort}`;
  app = createServer({ apiKey: KEY, base: aiBase, model: "m", maxUploadBytes: 50000, aiLimit: 1000, parseLimit: 1000 });
  base = `http://127.0.0.1:${await listen(app)}`;
  bare = createServer({ apiKey: "", base: aiBase, maxUploadBytes: 1000000 });
  bareBase = `http://127.0.0.1:${await listen(bare)}`;
  locked = createServer({ apiKey: KEY, base: aiBase, accessToken: "tok-123", allowedOrigins: ["https://good.example"], aiLimit: 2, parseLimit: 2 });
  lockedBase = `http://127.0.0.1:${await listen(locked)}`;
});
after(() => [mock, app, bare, locked].forEach((s) => s.close()));

const upload = (b, name, buf, headers = {}) => fetch(`${b}/api/parse`, { method: "POST", headers: { "X-Filename": encodeURIComponent(name), ...headers }, body: buf });
const fixture = (n) => fs.readFileSync(path.join(FIX, n));
const post = (b, p, body, headers = {}) => fetch(`${b}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("status reports AI configured without leaking the key", async () => {
  const r = await (await fetch(`${base}/api/status`)).json();
  assert.equal(r.ai.configured, true);
  assert.ok(!JSON.stringify(r).includes(KEY));
  const none = await (await fetch(`${bareBase}/api/status`)).json();
  assert.equal(none.ai.configured, false);
});

test("API key is never present in any served static file", async () => {
  for (const f of ["/", "/app.js", "/pages.js", "/planner.js", "/syllabus-parse.js", "/styles.css"]) {
    const res = await fetch(`${base}${f}`);
    if (res.status === 200) assert.ok(!(await res.text()).includes(KEY), f);
  }
  assert.equal((await fetch(`${base}/server/index.js`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});

test("parses a text PDF into lines", async () => {
  const r = await upload(base, "syllabus.pdf", fixture("syllabus.pdf"));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.type, "pdf");
  const s = SP.parseText(j.text).syllabus;
  assert.equal(s.units.length, 3);
  assert.ok(s.units[1].topics.some((t) => /Time series/.test(t.name)));
  assert.ok(!JSON.stringify(s).includes("Heizer"), "reference books must be skipped");
});

test("rejects a scanned (image-only) PDF with a clear error", async () => {
  const r = await upload(base, "scan.pdf", fixture("scanned.pdf"));
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "scanned_pdf");
});

test("parses xlsx, xls, docx, csv and txt", async () => {
  const x = await (await upload(base, "s.xlsx", fixture("syllabus.xlsx"))).json();
  const sx = SP.merge(x.sheets.map((sh) => SP.parseRows(sh.rows, { sheetName: sh.name }).syllabus));
  assert.equal(sx.units.length, 2);
  assert.equal(sx.units[0].topics[0].hours, 2);
  assert.equal(sx.units[1].topics[0].difficulty, "hard");

  const xls = await (await upload(base, "s.xls", fixture("syllabus.xls"))).json();
  assert.equal(SP.parseRows(xls.sheets[0].rows).syllabus.units.length, 2);

  const d = await (await upload(base, "s.docx", fixture("syllabus.docx"))).json();
  assert.equal(SP.parseText(d.text).syllabus.units.length, 2);

  const c = await (await upload(base, "s.csv", fixture("syllabus.csv"))).json();
  const sc = SP.parseRows(c.sheets[0].rows).syllabus;
  assert.equal(sc.units[0].topics.length, 2);
  assert.deepEqual(sc.units[0].topics[0].subtopics, ["1D, 2D"]);

  const t = await (await upload(base, "s.txt", fixture("syllabus.txt"))).json();
  assert.equal(SP.parseText(t.text).syllabus.units.length, 2);
});

test("validates file type, content and size", async () => {
  assert.equal((await upload(base, "a.exe", Buffer.from("MZ"))).status, 415);
  assert.equal((await upload(base, "a.doc", Buffer.from("x"))).status, 415);
  assert.equal((await upload(base, "noext", Buffer.from("x"))).status, 415);
  assert.equal((await upload(base, "fake.pdf", Buffer.from("just text"))).status, 422);
  assert.equal((await upload(base, "fake.xlsx", fixture("syllabus.pdf"))).status, 422);
  assert.equal((await upload(base, "fake.txt", fixture("syllabus.pdf"))).status, 422);
  assert.equal((await upload(base, "empty.txt", Buffer.alloc(0))).status, 422);
  const big = await upload(base, "big.txt", Buffer.alloc(60000, 97));
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error.code, "too_large");
});

test("AI endpoints refuse to fake a result when no key is configured", async () => {
  const a = await post(bareBase, "/api/analyze", { text: "Unit 1: something long enough to analyse" });
  assert.equal(a.status, 503);
  assert.equal((await a.json()).error.code, "ai_not_configured");
  const c = await post(bareBase, "/api/chat", { messages: [{ role: "user", content: "hi" }] });
  assert.equal(c.status, 503);
});

test("analyze: sends the key server-side, validates and normalises the AI output", async () => {
  mockMode = "ok";
  const r = await post(base, "/api/analyze", { text: "Unit A\n- Topic 1\n- Topic 2 and more text here", fileName: "x.pdf" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(mockSeen.headers["x-api-key"], KEY);
  assert.ok(mockSeen.body.system.includes("untrusted"));
  const t = j.syllabus.units[0].topics;
  assert.equal(t[0].difficulty, "hard");
  assert.equal(t[0].importance, null, "out-of-range importance is dropped");
  assert.equal(t[0].hours, 2.25, "hours are rounded to a quarter");
  assert.deepEqual(t[1].prereqs, ["Topic 1"]);
  assert.equal(j.model, "mock-model");
});

test("analyze: maps provider failures to clear errors", async () => {
  mockMode = "401";
  let r = await post(base, "/api/analyze", { text: "Unit A\n- Topic 1\n- Topic 2 and more text here" });
  assert.equal((await r.json()).error.code, "ai_auth");
  mockMode = "empty";
  r = await post(base, "/api/analyze", { text: "Unit A\n- Topic 1\n- Topic 2 and more text here" });
  assert.equal((await r.json()).error.code, "ai_bad_response");
  r = await post(base, "/api/analyze", { text: "tiny" });
  assert.equal(r.status, 422);
  mockMode = "ok";
});

test("chat: grounds the prompt in the syllabus, validates proposed actions", async () => {
  mockMode = "ok";
  const r = await post(base, "/api/chat", { messages: [{ role: "assistant", content: "stale" }, { role: "user", content: "What is EOQ?" }], syllabusText: "Unit 3: EOQ model", planSummary: "{\"progress\":10}", today: "2026-10-14" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(mockSeen.body.system.includes("<syllabus>\nUnit 3: EOQ model"));
  assert.ok(mockSeen.body.system.includes("isn't in your uploaded syllabus"));
  assert.equal(mockSeen.body.messages[0].role, "user", "leading assistant message is dropped");
  assert.equal(j.actions.length, 1, "only the one valid action survives");
  assert.deepEqual(j.actions[0].input, { hours: 4 });
  assert.match(j.reply, /isn't in your uploaded syllabus/);
  assert.equal((await post(base, "/api/chat", { messages: [] })).status, 400);
});

test("access token, origin allow-list and rate limiting", async () => {
  assert.equal((await post(lockedBase, "/api/chat", { messages: [{ role: "user", content: "x" }] })).status, 401);
  assert.equal((await post(lockedBase, "/api/chat", { messages: [{ role: "user", content: "x" }] }, { Authorization: "Bearer wrong" })).status, 401);
  const st = await (await fetch(`${lockedBase}/api/status`)).json();
  assert.equal(st.authRequired, true);
  assert.equal(st.authorized, false);

  const bad = await fetch(`${lockedBase}/api/status`, { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.status, 403);
  const good = await fetch(`${lockedBase}/api/status`, { headers: { Origin: "https://good.example" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://good.example");
  const pre = await fetch(`${lockedBase}/api/analyze`, { method: "OPTIONS", headers: { Origin: "https://good.example" } });
  assert.equal(pre.status, 204);

  mockMode = "ok";
  const H = { Authorization: "Bearer tok-123" };
  const body = { messages: [{ role: "user", content: "hello" }] };
  assert.equal((await post(lockedBase, "/api/chat", body, H)).status, 200);
  assert.equal((await post(lockedBase, "/api/chat", body, H)).status, 200);
  assert.equal((await post(lockedBase, "/api/chat", body, H)).status, 429);
});
