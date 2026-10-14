/* Syllabus parsing helpers. Shared by the browser (window.SyllabusParse) and the Node server / tests.
 * Pure functions only: text or table rows in, a normalised syllabus out.
 *
 * Syllabus shape:
 *   { title, units: [{ id, name, lectureHours, topics: [{ id, name, subtopics: [string], difficulty, importance, hours, prereqs: [name], done }] }] }
 *   difficulty: "easy" | "medium" | "hard" | null    importance: 1..5 | null    hours: number | null (study hours)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SyllabusParse = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_UNITS = 60;
  const MAX_TOPICS_PER_UNIT = 120;
  const MAX_TOPICS = 800;
  const MAX_SUB = 25;
  const DIFFS = ["easy", "medium", "hard"];

  let idn = 0;
  const nid = (p) => `${p}${(++idn).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const cleanName = (s, max = 120) =>
    String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^[\s\-–—•·▪■◦●○*>•]+/, "").trim().slice(0, max);

  // ---------- normalisation (also used to validate AI output and imported data) ----------
  function normDifficulty(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim().toLowerCase();
    if (DIFFS.includes(s)) return s;
    if (/^(e|low|simple|basic|beginner|1|2)$/.test(s)) return "easy";
    if (/^(m|med|moderate|average|normal|intermediate|3)$/.test(s)) return "medium";
    if (/^(h|high|hard|difficult|tough|complex|advanced|4|5)$/.test(s)) return "hard";
    return null;
  }

  function normImportance(v) {
    if (v == null || v === "") return null;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (/^(high|critical|very high|important)$/.test(s)) return 5;
      if (/^(medium|med|moderate|normal)$/.test(s)) return 3;
      if (/^(low|minor|optional)$/.test(s)) return 1;
    }
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
  }

  function normHours(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(clampNum(n, 0.25, 40) * 4) / 4 : null;
  }

  function normalize(input) {
    const src = input && typeof input === "object" ? input : {};
    const units = [];
    let topicCount = 0;
    (Array.isArray(src.units) ? src.units : []).slice(0, MAX_UNITS).forEach((u, ui) => {
      if (!u || typeof u !== "object") return;
      const topics = [];
      (Array.isArray(u.topics) ? u.topics : []).slice(0, MAX_TOPICS_PER_UNIT).forEach((t) => {
        if (topicCount >= MAX_TOPICS) return;
        const name = cleanName(typeof t === "string" ? t : t && t.name, 140);
        if (!name) return;
        const o = typeof t === "object" && t ? t : {};
        topics.push({
          id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : nid("t"),
          name,
          subtopics: (Array.isArray(o.subtopics) ? o.subtopics : []).map((s) => cleanName(s, 120)).filter(Boolean).slice(0, MAX_SUB),
          difficulty: normDifficulty(o.difficulty),
          importance: normImportance(o.importance),
          hours: normHours(o.hours),
          prereqs: (Array.isArray(o.prereqs) ? o.prereqs : []).map((s) => cleanName(s, 140)).filter(Boolean).slice(0, 8),
          done: !!o.done,
          excluded: !!o.excluded
        });
        topicCount++;
      });
      const name = cleanName(u.name, 120) || `Unit ${ui + 1}`;
      if (!topics.length && !cleanName(u.name)) return;
      units.push({
        id: typeof u.id === "string" && u.id ? u.id.slice(0, 40) : nid("u"),
        name,
        lectureHours: normHours(u.lectureHours),
        topics
      });
    });
    return { title: cleanName(src.title, 120), units };
  }

  const countTopics = (s) => s.units.reduce((n, u) => n + u.topics.length, 0);

  function toText(s) {
    return s.units.map((u) =>
      `${u.name}${u.lectureHours ? ` (${u.lectureHours} hours)` : ""}\n` +
      u.topics.map((t) => `- ${t.name}${t.subtopics.length ? ` (${t.subtopics.join("; ")})` : ""}`).join("\n")).join("\n\n");
  }

  // ---------- text parsing ----------
  const UNIT_RE = /^\s*(?:#{1,3}\s*)?(unit|module|chapter|section|part|block|week|lesson|semester|topic area)\b[\s\-–—:.]*([0-9]+|[ivxlc]{1,6}|[a-z])?\b[\s\-–—:.)]*(.*)$/i;
  const SKIP_SECTION_RE = /^\s*(?:#{1,3}\s*)?(text\s*books?|reference\s*books?|references?|suggested\s*reading|recommended\s*(?:books?|reading)|further\s*reading|bibliography|evaluation|marking\s*scheme|grading|assessment|course\s*outcomes?|learning\s*outcomes?|prerequisites?|e-?resources|web\s*resources|internal\s*assessment|examination\s*scheme|lab\s*(?:work|experiments?))\b/i;
  const NOISE_RE = /^(page\s*\d+(\s*of\s*\d+)?|\d+\s*\/\s*\d+|-\s*\d+\s*-|course\s*code.*|credits?\b.*|l\s*-?\s*t\s*-?\s*p.*|semester\s*[ivx\d]+.*)$/i;
  const HOURS_RE = /[([]?\s*(\d+(?:\.\d+)?)\s*(?:lecture\s*)?(?:hours?|hrs?|lectures?|periods?)\s*[)\]]?/i;
  const BULLET_RE = /^\s*(?:[•·▪■◦●○*\-–—>]|\(?[a-z]\)|\(?\d{1,2}\)|\d{1,2}[.)]|[a-z][.)])\s+/;

  // split on a separator regex, ignoring separators inside (), [] or {}
  function splitTop(s, re) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
      if (!depth) {
        const m = s.slice(i).match(re);
        if (m && m.index === 0 && m[0].length) {
          out.push(cur);
          cur = "";
          i += m[0].length - 1;
          continue;
        }
      }
      cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }

  const shortPieces = (parts) => parts.length >= 3 && Math.max(...parts.map((c) => c.length)) <= 60;

  function splitList(s) {
    s = s.trim();
    if (!s) return [];
    let parts = splitTop(s, /^\s*[;•·|]\s*/);
    if (parts.length === 1) {
      const commas = splitTop(s, /^\s*,\s*/);
      if (shortPieces(commas)) parts = commas;
      else if (/\s[–—]\s/.test(s) && splitTop(s, /^\s[–—]\s/).length >= 3) parts = splitTop(s, /^\s[–—]\s/);
    } else {
      // "a, b, c; d, e" -> split the comma lists too when every piece is short
      parts = parts.flatMap((p) => {
        const c = splitTop(p, /^\s*,\s*/);
        return c.length >= 3 && Math.max(...c.map((x) => x.length)) <= 45 ? c : [p];
      });
    }
    return parts;
  }

  // "Topic (a, b, c)" -> topic + subtopics
  function splitParenSubs(name) {
    const m = name.match(/^(.*?)\s*\(([^()]{4,})\)\s*\.?$/);
    if (m && /[,;]/.test(m[2]) && m[1].length >= 3) {
      const subs = m[2].split(/\s*[,;]\s*/).map((x) => cleanName(x)).filter(Boolean);
      if (subs.length >= 2) return { name: m[1], subs };
    }
    return { name, subs: [] };
  }

  function indentOf(line) {
    const m = line.match(/^[ \t]*/)[0];
    return m.replace(/\t/g, "    ").length;
  }

  function parseText(text, opts = {}) {
    const warnings = [];
    let lines = String(text || "").replace(/\r/g, "").replace(/ /g, " ").split("\n");

    // drop repeated headers/footers (short lines repeated 3+ times) and page numbers
    const freq = new Map();
    lines.forEach((l) => {
      const k = l.trim().toLowerCase();
      if (k && k.length < 70) freq.set(k, (freq.get(k) || 0) + 1);
    });
    lines = lines.filter((l) => {
      const k = l.trim().toLowerCase();
      return !(k && (NOISE_RE.test(k) || ((freq.get(k) || 0) >= 4 && !UNIT_RE.test(k) && !BULLET_RE.test(l))));
    });

    const mode = detectMode(lines);
    const mdMin = Math.min(6, ...lines.map((l) => (l.trim().match(/^(#{1,6})\s+\S/) || [, ""])[1].length || 6));
    const units = [];
    let unit = null;
    let topic = null;
    let skipping = false;
    let skippedSections = 0;
    let lastIndent = 0;

    const newUnit = (name, lectureHours) => {
      unit = { id: nid("u"), name: cleanName(name, 120) || `Unit ${units.length + 1}`, lectureHours: lectureHours || null, topics: [] };
      units.push(unit);
      topic = null;
    };
    const ensureUnit = () => unit || newUnit(opts.title || "Syllabus");
    const addTopic = (raw) => {
      const clean = cleanName(raw, 160);
      if (clean.length < 2 || /^[\d\W]+$/.test(clean)) return null;
      ensureUnit();
      const { name, subs } = splitParenSubs(clean);
      topic = { id: nid("t"), name: cleanName(name, 140), subtopics: subs, difficulty: null, importance: null, hours: null, prereqs: [], done: false };
      unit.topics.push(topic);
      return topic;
    };
    const addSub = (raw) => {
      const clean = cleanName(raw, 120);
      if (!clean) return;
      if (!topic) return addTopic(clean);
      topic.subtopics.push(clean);
    };

    const joinLabel = (label, rest) => cleanName(/^(unit|module|chapter|section|part|block|week|lesson)\s*\w{1,6}$/i.test(label) ? `${label}: ${rest.trim()}` : `${label} ${rest.trim()}`, 120);

    // content after a unit heading on the same line ("Unit 1: Intro - a, b; c")
    const consumeInline = (rest) => {
      rest = rest.trim();
      if (!rest) return;
      let hours = null;
      rest = rest.replace(new RegExp(HOURS_RE.source, "ig"), (m, n) => {
        hours = hours || Number(n);
        return " ";
      }).trim();
      if (hours && unit) unit.lectureHours = hours;
      const colon = rest.indexOf(":");
      if (colon > 0 && colon < 70 && rest.length - colon > 15) {
        // "Unit 1: Title: topic list"
        unit.name = joinLabel(unit.name, rest.slice(0, colon));
        splitList(rest.slice(colon + 1)).forEach(addTopic);
      } else if (rest.length > 90 || /[;•|]/.test(rest)) splitList(rest).forEach(addTopic);
      else if (rest) unit.name = joinLabel(unit.name, rest);
    };

    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      const trimmed = rawLine.trim();
      const indent = indentOf(rawLine);

      if (SKIP_SECTION_RE.test(trimmed) && trimmed.length < 90) {
        skipping = true;
        skippedSections++;
        continue;
      }

      let m;
      if (mode === "outline" && (m = trimmed.match(/^(\d+(?:\.\d+){0,2})[.)]?\s+(\S.*)$/))) {
        const depth = m[1].split(".").length;
        skipping = false;
        if (depth === 1) {
          newUnit(m[2]);
          const hm = unit.name.match(HOURS_RE);
          if (hm) {
            unit.lectureHours = Number(hm[1]);
            unit.name = cleanName(unit.name.replace(HOURS_RE, ""), 120);
          }
        } else if (depth === 2) addTopic(m[2]);
        else addSub(m[2]);
        continue;
      }

      if (mode === "markdown" && (m = trimmed.match(/^(#{1,6})\s+(.*)$/))) {
        skipping = false;
        const rel = m[1].length - mdMin;
        if (rel <= 0) newUnit(m[2]);
        else if (rel === 1) addTopic(m[2]);
        else addSub(m[2]);
        continue;
      }

      if (mode === "keyword" && (m = trimmed.match(UNIT_RE)) && (m[2] || m[3])) {
        skipping = false;
        const label = trimmed.slice(0, trimmed.length - (m[3] || "").length).replace(/[\s\-–—:.)]+$/, "");
        newUnit(label);
        consumeInline(m[3] || "");
        lastIndent = indent;
        continue;
      }

      if (mode === "caps" && isHeadingLine(trimmed)) {
        skipping = false;
        newUnit(trimmed.replace(/:$/, ""));
        continue;
      }

      if (skipping) continue;

      // body line
      const bullet = BULLET_RE.test(rawLine);
      const body = bullet ? rawLine.replace(BULLET_RE, "") : trimmed;
      if (bullet && topic && indent > lastIndent + 1 && unit && unit.topics.length) {
        splitList(body).forEach(addSub);
      } else if (bullet) {
        const items = splitList(body);
        items.forEach(addTopic);
        lastIndent = indent;
      } else {
        // plain paragraph: a list of topics, or a continuation of the previous topic
        const items = splitList(body);
        if (items.length > 1 || body.length > 70) items.forEach(addTopic);
        else if (topic && /^[a-z(]/.test(body) && !/[.:]$/.test(topic.name) && body.length < 50 && indent > lastIndent) topic.name = cleanName(`${topic.name} ${body}`, 140);
        else addTopic(body);
        lastIndent = indent;
      }
    }

    if (skippedSections) warnings.push(`Skipped ${skippedSections} non-syllabus section(s) (references, evaluation, outcomes...).`);
    const result = normalize({ title: opts.title || "", units: units.filter((u) => u.topics.length || units.length === 1) });
    if (!result.units.length) warnings.push("No units or topics could be detected. Check the text, or add them manually.");
    else if (mode === "flat") warnings.push("No unit/module headings were found, so everything is grouped under one unit. You can split it in the review step.");
    return { syllabus: result, warnings, mode };
  }

  function isHeadingLine(s) {
    if (s.length > 80 || s.length < 3) return false;
    if (/:$/.test(s)) return true;
    const letters = s.replace(/[^A-Za-z]/g, "");
    return letters.length >= 4 && letters === letters.toUpperCase() && !BULLET_RE.test(s);
  }

  function detectMode(lines) {
    const t = lines.map((l) => l.trim()).filter(Boolean);
    const kw = t.filter((l) => { const m = l.match(UNIT_RE); return m && (m[2] || m[3]); }).length;
    if (kw >= 1) return "keyword";
    const dotted = t.filter((l) => /^\d+\.\d+(\.\d+)?[.)]?\s+\S/.test(l)).length;
    const top = t.filter((l) => /^\d+[.)]\s+\S/.test(l)).length;
    if (dotted >= 2 && top >= 1) return "outline";
    if (t.some((l) => /^#{1,2}\s+\S/.test(l))) return "markdown";
    if (t.filter(isHeadingLine).length >= 2) return "caps";
    return "flat";
  }

  // ---------- table parsing (Excel / CSV) ----------
  const COLS = {
    unit: /^(unit|module|chapter|section|part|block|week|subject|course)(\s*(no\.?|number|name|title))?$/i,
    topic: /^(topics?|topic\s*name|topics?\s*covered|title|content|contents|syllabus|lesson|concept|name|details?)$/i,
    sub: /^(sub\s*-?\s*topics?|sub\s*-?\s*units?|points?|description|keywords?)$/i,
    hours: /^(hours?|hrs?|study\s*hours?|time|duration|lecture\s*hours?|est\.?\s*(hours?|time)|estimated\s*(hours?|time))$/i,
    difficulty: /^(difficulty|level|complexity|hardness)$/i,
    importance: /^(importance|priority|weightage|weight|marks?|exam\s*weight(age)?)$/i,
    status: /^(status|done|completed?|finished)$/i,
    prereq: /^(prerequisites?|pre-?reqs?|depends\s*on|requires)$/i
  };

  const cell = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

  function parseRows(rows, opts = {}) {
    const warnings = [];
    rows = (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r.map(cell) : [])).filter((r) => r.some(Boolean));
    if (!rows.length) return { syllabus: normalize({ units: [] }), warnings: ["The sheet is empty."], mode: "table" };

    let hi = -1;
    let map = {};
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const m = {};
      rows[i].forEach((c, ci) => {
        for (const [k, re] of Object.entries(COLS)) if (re.test(c) && m[k] == null) { m[k] = ci; break; }
      });
      if ((m.topic != null || m.sub != null) && Object.keys(m).length >= 2) { hi = i; map = m; break; }
      if (m.topic != null && i === 0 && rows[0].filter(Boolean).length >= 2) { hi = i; map = m; break; }
    }

    // no header: one column -> text; otherwise treat col0 as unit and col1 as topic
    if (hi < 0) {
      const widest = Math.max(...rows.map((r) => r.length));
      const filled = rows.filter((r) => r.filter(Boolean).length >= 2).length;
      if (widest <= 1 || filled < rows.length / 3) {
        const out = parseText(rows.map((r) => r.filter(Boolean).join(" ")).join("\n"), opts);
        out.warnings.unshift("No column headers found; the sheet was read as plain text.");
        return out;
      }
      map = { unit: 0, topic: 1, sub: widest > 2 ? 2 : undefined };
      warnings.push("No header row found; assumed columns: Unit, Topic, Subtopics.");
    }

    const units = [];
    const byName = new Map();
    let curUnit = null;
    let last = null;
    const get = (r, k) => (map[k] == null ? "" : r[map[k]] || "");
    const dataRows = rows.slice(hi + 1);
    const maxMarks = Math.max(0, ...dataRows.map((r) => Number(get(r, "importance")) || 0));

    for (const r of dataRows) {
      const unitName = get(r, "unit");
      const topicName = get(r, "topic");
      const subName = get(r, "sub");
      if (unitName) {
        const key = unitName.toLowerCase();
        if (!byName.has(key)) {
          const u = { id: nid("u"), name: unitName, lectureHours: null, topics: [] };
          byName.set(key, u);
          units.push(u);
        }
        curUnit = byName.get(key);
      }
      if (!curUnit) {
        curUnit = { id: nid("u"), name: opts.sheetName || opts.title || "Syllabus", lectureHours: null, topics: [] };
        units.push(curUnit);
        byName.set(curUnit.name.toLowerCase(), curUnit);
      }
      if (!topicName && !subName) continue;
      if (!topicName && subName && last) {
        subName.split(/\s*[;•|]\s*/).forEach((s) => s && last.subtopics.push(s));
        continue;
      }
      let imp = get(r, "importance");
      if (imp && /^\d+(\.\d+)?$/.test(imp) && maxMarks > 5) imp = (Number(imp) / maxMarks) * 5;
      const doneRaw = get(r, "status").toLowerCase();
      last = {
        id: nid("t"),
        name: topicName || subName,
        subtopics: topicName && subName ? subName.split(/\s*[;•|]\s*/).filter(Boolean) : [],
        difficulty: get(r, "difficulty"),
        importance: imp,
        hours: get(r, "hours"),
        prereqs: get(r, "prereq") ? get(r, "prereq").split(/\s*[;,]\s*/) : [],
        done: /^(done|yes|y|true|1|complete|completed|finished|✓|✔|x)$/.test(doneRaw)
      };
      curUnit.topics.push(last);
    }
    return { syllabus: normalize({ title: opts.title || "", units }), warnings, mode: "table" };
  }

  // merge several parsed syllabi (e.g. one per Excel sheet)
  function merge(list, title) {
    const units = [];
    list.forEach((s) => s.units.forEach((u) => units.push(u)));
    return normalize({ title, units });
  }

  // text-file helpers: detect CSV/TSV so plain-text uploads of tables work client-side
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [];
    let cur = "";
    let q = false;
    const s = String(text).replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        rows.push(row); row = [];
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  return { parseText, parseRows, parseDelimited, merge, normalize, countTopics, toText, normDifficulty, normImportance, normHours, cleanName };
});
