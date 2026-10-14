"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../planner.js");
const SP = require("../syllabus-parse.js");

const { addDays, diffDays, dow } = P.util;
const TODAY = "2026-10-14"; // a Wednesday

function syl(units = 4, per = 4, extra = {}) {
  return SP.normalize({
    units: Array.from({ length: units }, (_, u) => ({
      name: `Unit ${u + 1}`,
      topics: Array.from({ length: per }, (_, t) => ({ name: `U${u + 1}T${t + 1}`, ...(extra[`${u}-${t}`] || {}) }))
    }))
  });
}
const cfg = (o = {}) => ({ ...P.defaultConfig(TODAY), endDate: addDays(TODAY, 59), ...o });
let n = 0;
const uid = () => "s" + n++;
const build = (s, c, o = {}) => P.buildPlan(s, c, { today: TODAY, uid, ...o });

function assertConstraints(r, c) {
  const k = P.sanitizeConfig(c, TODAY);
  const end = P.resolveEnd(k);
  const load = new Map();
  r.sessions.forEach((s) => {
    assert.ok(s.date >= k.startDate && s.date <= end, `${s.date} outside window`);
    assert.ok(k.studyDays.includes(dow(s.date)), `${s.date} not a study day`);
    assert.ok(!k.blockedDates.includes(s.date), `${s.date} is blocked`);
    load.set(s.date, (load.get(s.date) || 0) + s.hours);
  });
  load.forEach((h, d) => {
    const weekend = dow(d) === 0 || dow(d) === 6;
    const hours = weekend && k.weekendHours != null ? k.weekendHours : k.hoursPerDay;
    assert.ok(h <= hours * (1 - k.bufferPct / 100) + 1e-6, `${d} has ${h}h, cap ${hours * (1 - k.bufferPct / 100)}`);
  });
}

test("a fitting syllabus is fully scheduled within every constraint", () => {
  const c = cfg({ hoursPerDay: 4, weekendHours: 2, blockedDates: ["2026-10-20", "2026-10-21"], studyDays: [1, 2, 3, 4, 5, 6] });
  const r = build(syl(), c);
  assert.deepEqual(r.errors, []);
  assert.equal(r.conflict, null);
  assertConstraints(r, c);
  const learn = r.sessions.filter((s) => s.kind === "learn");
  assert.equal(new Set(learn.map((s) => s.topicId)).size, 16, "every topic has learning time");
  assert.ok(r.sessions.some((s) => s.kind === "practice"));
  assert.ok(r.sessions.some((s) => s.kind === "revision" && s.scope === "unit"));
  assert.ok(r.sessions.some((s) => s.kind === "revision" && s.scope === "final"));
  assert.ok(!r.sessions.some((s) => s.date === "2026-10-20" || dow(s.date) === 0));
  const totals = r.sessions.reduce((a, s) => a + s.hours, 0);
  assert.ok(Math.abs(totals - r.stats.required) < 0.51 * r.sessions.length, "scheduled hours match the requirement");
  assert.ok(r.assumptions.length >= 2, "assumptions are stated");
});

test("final revision sits at the end and learning comes before it", () => {
  const r = build(syl(), cfg());
  const finals = r.sessions.filter((s) => s.scope === "final");
  const lastLearn = r.sessions.filter((s) => s.kind === "learn").pop();
  assert.ok(finals[0].date >= lastLearn.date);
  assert.equal(finals[finals.length - 1].date, r.sessions[r.sessions.length - 1].date);
});

test("syllabus order, easiest first, toughest first and custom ranking", () => {
  const diff = { "0-0": { difficulty: "hard" }, "0-1": { difficulty: "easy" }, "1-0": { difficulty: "medium" }, "1-1": { difficulty: "easy" } };
  const s = syl(2, 2, diff);
  const first = (st, extra = {}) => build(s, cfg({ strategy: st, ...extra })).sessions.filter((x) => x.kind === "learn").map((x) => x.title).filter((t, i, a) => a.indexOf(t) === i);
  assert.deepEqual(first("order"), ["U1T1", "U1T2", "U2T1", "U2T2"]);
  assert.deepEqual(first("easy"), ["U1T2", "U2T2", "U2T1", "U1T1"]);
  assert.deepEqual(first("hard"), ["U1T1", "U2T1", "U1T2", "U2T2"]);
  const ids = s.units.flatMap((u) => u.topics).map((t) => t.id);
  assert.deepEqual(first("custom", { customOrder: [ids[3], ids[0]] }), ["U2T2", "U1T1", "U1T2", "U2T1"]);
  const unit2 = s.units[1].id;
  assert.equal(first("custom", { unitPriority: { [unit2]: "high" } })[0], "U2T1");
});

test("importance weighting reorders; prerequisites are always respected", () => {
  const s = syl(1, 3, { "0-0": { importance: 1 }, "0-1": { importance: 5 }, "0-2": { importance: 3, prereqs: ["U1T1"] } });
  const order = (c) => build(s, cfg(c)).sessions.filter((x) => x.kind === "learn").map((x) => x.title).filter((t, i, a) => a.indexOf(t) === i);
  assert.deepEqual(order({ weightImportance: true, respectPrereqs: false }), ["U1T2", "U1T3", "U1T1"]);
  assert.deepEqual(order({ weightImportance: true, respectPrereqs: true }), ["U1T2", "U1T1", "U1T3"]);
  const cyc = syl(1, 2, { "0-0": { prereqs: ["U1T2"] }, "0-1": { prereqs: ["U1T1"] } });
  const r = build(cyc, cfg());
  assert.equal(r.sessions.filter((x) => x.kind === "learn").length > 0, true);
  assert.ok(r.warnings.some((w) => /Circular/.test(w)));
});

test("completed and excluded topics are left out; locked dates are honoured", () => {
  const s = syl(2, 2);
  s.units[0].topics[0].done = true;
  s.units[1].topics[1].excluded = true;
  const lockDate = "2026-11-02";
  const lockId = s.units[0].topics[1].id;
  const r = build(s, cfg({ lockedTopicDates: { [lockId]: lockDate } }));
  const titles = new Set(r.sessions.map((x) => x.title));
  assert.ok(!titles.has("U1T1") && !titles.has("U2T2"));
  const locked = r.sessions.filter((x) => x.topicId === lockId && x.kind === "learn");
  assert.equal(locked[0].date, lockDate);
  assert.ok(locked.every((x) => x.locked));
  assert.equal(r.stats.completedTopics, 1);
});

test("custom per-topic hours override estimates", () => {
  const s = syl(1, 1, { "0-0": { hours: 6 } });
  const r = build(s, cfg({ hoursPerDay: 4, practicePct: 0, revisionPct: 0 }));
  assert.equal(r.sessions.reduce((a, x) => a + x.hours, 0), 6);
});

test("an impossible syllabus reports a conflict with verified alternatives instead of pretending", () => {
  const s = syl(5, 6);
  const c = cfg({ endDate: addDays(TODAY, 9), hoursPerDay: 2 });
  const r = build(s, c);
  assert.ok(r.conflict, "conflict expected");
  assert.ok(r.conflict.shortfall > 0 && r.unscheduled.length > 0);
  assert.match(r.conflict.message, /needs about .*h but only/);
  assertConstraints(r, c);
  const ids = r.conflict.alternatives.map((a) => a.id);
  assert.ok(ids.includes("hours") && ids.includes("extend") && ids.includes("trim"));
  for (const alt of r.conflict.alternatives) {
    let sy = s;
    let c2 = { ...c, ...alt.patch };
    if (alt.patch.excludeTopicIds) {
      const ex = new Set(alt.patch.excludeTopicIds);
      sy = SP.normalize({ units: s.units.map((u) => ({ ...u, topics: u.topics.map((t) => ({ ...t, excluded: ex.has(t.id) })) })) });
      delete c2.excludeTopicIds;
    }
    const again = build(sy, c2);
    assert.equal(again.conflict, null, `alternative "${alt.id}" must really fit`);
  }
});

test("invalid configuration is rejected with readable errors", () => {
  assert.match(build(syl(), cfg({ endDate: addDays(TODAY, -3) })).errors[0], /before the start/);
  assert.match(build(syl(), cfg({ studyDays: [] })).errors.join(), /study day/);
  assert.ok(build(syl(), cfg({ mode: "days", days: 3, studyDays: [0], startDate: "2026-10-14" })).errors.length > 0, "no usable days");
  assert.equal(build(SP.normalize({ units: [] }), cfg()).sessions.length, 0);
  const r = build(syl(), cfg({ mode: "days", days: 14 }));
  assert.equal(P.resolveEnd(r.config), addDays(TODAY, 13));
});

test("rescheduling moves missed work forward, keeps done/locked sessions, respects capacity", () => {
  const s = syl();
  const c = cfg({ hoursPerDay: 3 });
  const r = build(s, c);
  const sessions = r.sessions.map((x) => ({ ...x }));
  const later = addDays(TODAY, 6);
  sessions.filter((x) => x.date < later).slice(0, 3).forEach((x) => (x.done = true));
  const doneSnap = sessions.filter((x) => x.done).map((x) => [x.id, x.date]);
  const res = P.reschedule(sessions, c, { today: later });
  assert.deepEqual(res.errors, []);
  assert.ok(res.moved > 0);
  doneSnap.forEach(([id, d]) => assert.equal(res.sessions.find((x) => x.id === id).date, d));
  const open = res.sessions.filter((x) => !x.done);
  assert.ok(open.every((x) => x.date >= later), "no open session left in the past");
  const hours = open.reduce((a, x) => a + x.hours, 0);
  assert.ok(Math.abs(hours - sessions.filter((x) => !x.done).reduce((a, x) => a + x.hours, 0)) < 1e-6, "no work lost");
  assert.equal(res.conflict, null);
  const k = P.sanitizeConfig(c, TODAY);
  const load = new Map();
  open.forEach((x) => load.set(x.date, (load.get(x.date) || 0) + x.hours));
  load.forEach((h) => assert.ok(h <= k.hoursPerDay * 0.9 + 1e-6));
  // learning order is preserved
  const seqs = open.filter((x) => !x.tail).map((x) => x.seq);
  assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b));
});

test("rescheduling after too much time was lost reports a conflict and keeps the overflow visible", () => {
  const s = syl(4, 4);
  const c = cfg({ endDate: addDays(TODAY, 40), hoursPerDay: 2 });
  const r = build(s, c);
  assert.equal(r.conflict, null);
  const res = P.reschedule(r.sessions, c, { today: addDays(TODAY, 36) });
  assert.ok(res.conflict && res.unscheduledHours > 0);
  assert.ok(res.sessions.some((x) => x.overflow));
  assert.ok(res.conflict.alternatives.some((a) => a.id === "extend"));
  const total = res.sessions.reduce((a, x) => a + x.hours, 0);
  assert.ok(Math.abs(total - r.sessions.reduce((a, x) => a + x.hours, 0)) < 1e-6, "nothing silently dropped");
});

test("progress, day load and schedule validation", () => {
  const s = syl(2, 2);
  const r = build(s, cfg());
  r.sessions.slice(0, 4).forEach((x) => (x.done = true));
  const pr = P.progress(r.sessions, s);
  assert.equal(pr.doneSessions, 4);
  assert.ok(pr.pct > 0 && pr.pct < 100);
  assert.equal(pr.units.length, 2);
  const d = r.sessions[0].date;
  assert.equal(P.dayLoad(r.sessions, d), r.sessions.filter((x) => x.date === d).reduce((a, x) => a + x.hours, 0));
  const edited = r.sessions.map((x, i) => (i === 0 ? { ...x, date: "2026-10-18" } : x)); // a Sunday
  const issues = P.validateSchedule(edited, cfg(), TODAY);
  assert.ok(issues.some((i) => i.type === "off-day"));
  assert.ok(P.validateSchedule([{ ...r.sessions[0], date: addDays(TODAY, 200) }], cfg(), TODAY).some((i) => i.type === "late"));
});

test("markTopicComplete and findTopic", () => {
  const s = syl(1, 2);
  const proj = { syllabus: s, schedule: { sessions: build(s, cfg()).sessions } };
  const t = P.findTopic(s, "u1t2");
  assert.equal(t.name, "U1T2");
  assert.ok(P.markTopicComplete(proj, t.id));
  assert.ok(proj.schedule.sessions.filter((x) => x.topicId === t.id).every((x) => x.done));
  assert.equal(P.markTopicComplete(proj, "nope"), false);
  assert.equal(P.findTopic(s, "zzz"), null);
});

test("persistence model survives corrupt and hostile data", () => {
  const bad = [null, 5, "x", [], { projects: "no" }, { projects: [null, 3, { syllabus: 7, config: 9, schedule: { sessions: [null, { date: "nope" }, { date: "2026-01-01", hours: -2 }, { date: "2026-01-01", hours: 2, title: 5 }] }, chat: [{ role: "system", content: "x" }, { role: "user", content: "hi", actions: [{ tool: "t", input: { a: 1 } }] }] }] }];
  bad.forEach((b) => {
    const st = P.sanitizeStudy(b, TODAY);
    assert.ok(Array.isArray(st.projects));
  });
  const st = P.sanitizeStudy(bad[bad.length - 1], TODAY);
  assert.equal(st.projects.length, 1);
  const p = st.projects[0];
  assert.equal(p.schedule.sessions.length, 1);
  assert.equal(p.chat.length, 2);
  assert.equal(p.chat[0].role, "user");
  assert.equal(p.config.hoursPerDay, 3);
  assert.equal(p.stage, "review");
  const big = { projects: Array.from({ length: 50 }, () => ({ name: "x" })) };
  assert.equal(P.sanitizeStudy(big, TODAY).projects.length, 20);
  const r = build(syl(), cfg());
  const roundTrip = P.sanitizeStudy({ projects: [{ id: "p1", name: "N", syllabus: syl(), config: cfg(), schedule: { sessions: r.sessions } }] }, TODAY);
  assert.equal(roundTrip.projects[0].schedule.sessions.length, r.sessions.length);
  assert.deepEqual(roundTrip.projects[0].config, P.sanitizeConfig(cfg(), TODAY));
});

test("large syllabi stay fast", () => {
  const s = syl(30, 25);
  const t0 = Date.now();
  const r = build(s, cfg({ endDate: addDays(TODAY, 400), hoursPerDay: 6 }));
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
  assert.equal(r.conflict, null);
});
