"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const SP = require("../syllabus-parse.js");

const names = (s) => s.units.map((u) => ({ unit: u.name, topics: u.topics.map((t) => t.name) }));

test("keyword units with bullets, nested subtopics and skipped reference sections", () => {
  const { syllabus: s, warnings } = SP.parseText(`Course Code: MBA101
Unit 1: Introduction (10 Hours)
- Operations function
- Productivity
Unit 2: Forecasting
- Time series (moving average, smoothing)
   - MAD, MSE
- Capacity planning
Text Books:
1. Heizer
Unit 3 - Inventory: EOQ model, ABC analysis, safety stock`);
  assert.equal(s.units.length, 3);
  assert.equal(s.units[0].lectureHours, 10);
  assert.deepEqual(s.units[0].topics.map((t) => t.name), ["Operations function", "Productivity"]);
  assert.deepEqual(s.units[1].topics[0].subtopics, ["moving average", "smoothing", "MAD, MSE"]);
  assert.deepEqual(s.units[2].topics.map((t) => t.name), ["EOQ model", "ABC analysis", "safety stock"]);
  assert.ok(!JSON.stringify(s).includes("Heizer"));
  assert.ok(warnings.some((w) => /Skipped/.test(w)));
});

test("numbered outline, markdown and flat lists", () => {
  assert.deepEqual(names(SP.parseText("1. Calculus\n1.1 Limits\n1.1.1 One sided\n1.2 Derivatives\n2. Algebra\n2.1 Matrices").syllabus),
    [{ unit: "Calculus", topics: ["Limits", "Derivatives"] }, { unit: "Algebra", topics: ["Matrices"] }]);
  assert.deepEqual(names(SP.parseText("# Bio\n## Cells\n## Genes\n# Chem\n## Atoms").syllabus),
    [{ unit: "Bio", topics: ["Cells", "Genes"] }, { unit: "Chem", topics: ["Atoms"] }]);
  const flat = SP.parseText("Arrays, Linked lists, Stacks, Queues");
  assert.equal(flat.syllabus.units[0].topics.length, 4);
  assert.ok(flat.warnings.some((w) => /No unit/.test(w)));
});

test("empty or meaningless input yields no units and a warning, never a crash", () => {
  for (const t of ["", "   \n\n", null, undefined, "1", "-----"]) {
    const r = SP.parseText(t);
    assert.equal(SP.countTopics(r.syllabus), 0);
    assert.ok(r.warnings.length);
  }
});

test("tables: header detection, fill-down units, numeric importance scaling, status", () => {
  const { syllabus: s } = SP.parseRows([
    ["Unit", "Topic", "Hours", "Difficulty", "Marks", "Status"],
    ["Unit 1", "Limits", "3", "Hard", "10", ""],
    ["", "Continuity", "2.3", "medium", "40", "done"],
    ["Unit 2", "Matrices", "x", "weird", "", ""]
  ]);
  assert.equal(s.units.length, 2);
  const [a, b] = s.units[0].topics;
  assert.equal(a.hours, 3);
  assert.equal(a.difficulty, "hard");
  assert.equal(a.importance, 1);
  assert.equal(b.importance, 5);
  assert.equal(b.hours, 2.25);
  assert.equal(b.done, true);
  const c = s.units[1].topics[0];
  assert.equal(c.hours, null);
  assert.equal(c.difficulty, null);
});

test("tables without headers and single-column sheets", () => {
  assert.equal(SP.parseRows([["Unit 1", "Arrays"], ["Unit 1", "Stacks"], ["Unit 2", "Trees"]]).syllabus.units.length, 2);
  const col = SP.parseRows([["Unit 1: A"], ["- Alpha"], ["- Beta"], ["Unit 2: B"], ["- Gamma"]]);
  assert.equal(col.syllabus.units.length, 2);
  assert.equal(SP.countTopics(SP.parseRows([]).syllabus), 0);
});

test("normalize clamps and sanitises hostile or malformed data", () => {
  const s = SP.normalize({ units: [{ name: "<b>U</b>", topics: [{ name: "T", hours: 999, importance: 7, difficulty: "x" }, { name: "" }, null, "plain"] }, null, "x"] });
  assert.equal(s.units.length, 1);
  assert.equal(s.units[0].topics.length, 2);
  assert.equal(s.units[0].topics[0].hours, 40);
  assert.equal(s.units[0].topics[0].importance, null);
  assert.equal(SP.normalize(null).units.length, 0);
  const many = SP.normalize({ units: Array.from({ length: 200 }, (_, i) => ({ name: "U" + i, topics: Array.from({ length: 50 }, (_, j) => "T" + j) })) });
  assert.ok(many.units.length <= 60);
  assert.ok(SP.countTopics(many) <= 800);
});

test("CSV parser handles quotes, embedded newlines and CRLF", () => {
  assert.deepEqual(SP.parseDelimited('a,"b,c","d ""q"""\r\n1,2,3', ","), [["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  assert.deepEqual(SP.parseDelimited('x\t"y\nz"', "\t"), [["x", "y\nz"]]);
});
