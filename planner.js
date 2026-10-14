/* Study scheduling engine + persistence model for the Syllabus Planner.
 * Shared by the browser (window.Planner) and Node (tests). No DOM access.
 *
 * buildPlan(syllabus, config, {today}) lays topics out day by day against the user's real capacity
 * (study days x hours/day, minus a buffer), adds practice + revision, and reports an honest conflict
 * (with verified alternatives) when the syllabus does not fit.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./syllabus-parse.js"));
  else root.Planner = factory(root.SyllabusParse);
})(typeof self !== "undefined" ? self : this, function (SP) {
  "use strict";

  const MAX_DAYS = 800;
  const MAX_SESSIONS = 4000;
  const MIN_BLOCK = 0.5;
  const LEVEL_MULT = { beginner: 1.25, intermediate: 1, advanced: 0.8 };
  const DIFF_W = { easy: 0.75, medium: 1, hard: 1.5 };
  const DIFF_RANK = { easy: 0, medium: 1, hard: 2 };
  const KINDS = ["learn", "practice", "revision", "custom"];
  const SLOTS = ["any", "morning", "afternoon", "evening"];
  const STRATEGIES = ["order", "easy", "hard", "custom"];

  // ---------- dates (local, noon-anchored to stay DST-safe) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  };
  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s;
  const addDays = (iso, n) => {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  };
  const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  const dow = (iso) => parseISO(iso).getDay();
  const q4 = (x) => Math.round(x * 4) / 4;
  const f4 = (x) => Math.floor(x * 4 + 1e-9) / 4;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const rid = () => Math.random().toString(36).slice(2, 10);

  // ---------- config ----------
  function defaultConfig(today) {
    return {
      startDate: today,
      mode: "date", // "date": plan until endDate, "days": plan for a number of days
      endDate: addDays(today, 59),
      days: 60,
      hoursPerDay: 3,
      weekendHours: null, // null = same as weekdays
      studyDays: [1, 2, 3, 4, 5, 6], // 0 = Sunday
      blockedDates: [],
      level: "intermediate",
      practicePct: 20,
      revisionPct: 20,
      bufferPct: 10,
      revisionTiming: "both", // "both" | "end" | "spread"
      revisionSlot: "evening",
      strategy: "order",
      weightImportance: false,
      respectPrereqs: true,
      customOrder: [],
      lockedTopicDates: {},
      unitPriority: {}
    };
  }

  function sanitizeConfig(c, today) {
    const d = defaultConfig(today || toISO(new Date()));
    c = c && typeof c === "object" ? c : {};
    const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? clamp(Number(v), lo, hi) : def);
    const out = {
      startDate: isISO(c.startDate) ? c.startDate : d.startDate,
      mode: c.mode === "days" ? "days" : "date",
      endDate: isISO(c.endDate) ? c.endDate : d.endDate,
      days: Math.round(num(c.days, 1, MAX_DAYS, d.days)),
      hoursPerDay: q4(num(c.hoursPerDay, 0.5, 16, d.hoursPerDay)),
      weekendHours: c.weekendHours == null || c.weekendHours === "" ? null : q4(num(c.weekendHours, 0, 16, d.hoursPerDay)),
      studyDays: [...new Set((Array.isArray(c.studyDays) ? c.studyDays : d.studyDays).map(Number).filter((n) => n >= 0 && n <= 6 && Number.isInteger(n)))].sort(),
      blockedDates: (Array.isArray(c.blockedDates) ? c.blockedDates : []).filter(isISO).slice(0, 400),
      level: LEVEL_MULT[c.level] ? c.level : d.level,
      practicePct: Math.round(num(c.practicePct, 0, 100, d.practicePct)),
      revisionPct: Math.round(num(c.revisionPct, 0, 100, d.revisionPct)),
      bufferPct: Math.round(num(c.bufferPct, 0, 50, d.bufferPct)),
      revisionTiming: ["both", "end", "spread"].includes(c.revisionTiming) ? c.revisionTiming : d.revisionTiming,
      revisionSlot: SLOTS.includes(c.revisionSlot) ? c.revisionSlot : d.revisionSlot,
      strategy: STRATEGIES.includes(c.strategy) ? c.strategy : d.strategy,
      weightImportance: !!c.weightImportance,
      respectPrereqs: c.respectPrereqs !== false,
      customOrder: (Array.isArray(c.customOrder) ? c.customOrder : []).filter((x) => typeof x === "string").slice(0, 900),
      lockedTopicDates: {},
      unitPriority: {}
    };
    if (c.lockedTopicDates && typeof c.lockedTopicDates === "object") {
      Object.keys(c.lockedTopicDates).slice(0, 400).forEach((k) => { if (isISO(c.lockedTopicDates[k])) out.lockedTopicDates[k] = c.lockedTopicDates[k]; });
    }
    if (c.unitPriority && typeof c.unitPriority === "object") {
      Object.keys(c.unitPriority).slice(0, 80).forEach((k) => { if (["high", "normal", "low"].includes(c.unitPriority[k])) out.unitPriority[k] = c.unitPriority[k]; });
    }
    return out;
  }

  const resolveEnd = (cfg) => (cfg.mode === "days" ? addDays(cfg.startDate, cfg.days - 1) : cfg.endDate);

  function validateConfig(cfg) {
    const errs = [];
    if (!isISO(cfg.startDate)) errs.push("Pick a valid start date.");
    const end = resolveEnd(cfg);
    if (!isISO(end)) errs.push("Pick a valid exam / deadline date.");
    else if (isISO(cfg.startDate) && end < cfg.startDate) errs.push("The deadline is before the start date.");
    else if (diffDays(cfg.startDate, end) + 1 > MAX_DAYS) errs.push(`Plans can cover at most ${MAX_DAYS} days.`);
    if (!(cfg.hoursPerDay > 0)) errs.push("Enter how many hours you can study per day.");
    if (!cfg.studyDays.length) errs.push("Select at least one study day.");
    return errs;
  }

  // ---------- helpers over the syllabus ----------
  function flatten(syllabus) {
    const out = [];
    syllabus.units.forEach((u, ui) => u.topics.forEach((t) => out.push({ t, u, ui, index: out.length })));
    return out;
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function estimateHours(t, u, nTopicsInUnit, level) {
    const diff = DIFF_W[t.difficulty || "medium"];
    let est;
    let basis = "default";
    if (u.lectureHours && nTopicsInUnit) {
      est = clamp((u.lectureHours * 1.5) / nTopicsInUnit, 0.5, 6) * diff;
      basis = "lecture";
    } else {
      est = (1 + 0.25 * Math.min(t.subtopics.length, 8)) * diff;
    }
    return { hours: Math.max(0.5, q4(est * LEVEL_MULT[level])), basis };
  }

  function orderTopics(items, cfg, warnings) {
    const imp = (x) => x.t.importance || 3;
    const rank = (x) => DIFF_RANK[x.t.difficulty || "medium"];
    const prio = { high: 0, normal: 1, low: 2 };
    const customIdx = new Map(cfg.customOrder.map((id, i) => [id, i]));
    const keyed = items.slice();
    keyed.sort((a, b) => {
      if (cfg.weightImportance && imp(a) !== imp(b)) return imp(b) - imp(a);
      if (cfg.strategy === "easy") return rank(a) - rank(b) || a.index - b.index;
      if (cfg.strategy === "hard") return rank(b) - rank(a) || a.index - b.index;
      if (cfg.strategy === "custom") {
        const pa = prio[cfg.unitPriority[a.u.id] || "normal"];
        const pb = prio[cfg.unitPriority[b.u.id] || "normal"];
        if (pa !== pb) return pa - pb;
        const ca = customIdx.has(a.t.id) ? customIdx.get(a.t.id) : 1e6 + a.index;
        const cb = customIdx.has(b.t.id) ? customIdx.get(b.t.id) : 1e6 + b.index;
        return ca - cb;
      }
      return a.index - b.index;
    });
    if (!cfg.respectPrereqs) return keyed;

    // stable topological pass: a topic is placed once its prerequisites are placed
    const byName = new Map();
    keyed.forEach((x) => byName.set(norm(x.t.name), x));
    const reqs = new Map(keyed.map((x) => [x, x.t.prereqs.map((p) => byName.get(norm(p))).filter((r) => r && r !== x)]));
    const placed = new Set();
    const out = [];
    let pending = keyed.slice();
    while (pending.length) {
      const i = pending.findIndex((x) => reqs.get(x).every((r) => placed.has(r)));
      let pick;
      if (i === -1) {
        pick = pending[0];
        warnings.push(`Circular prerequisites around "${pick.t.name}" were ignored.`);
      } else pick = pending[i];
      pending = pending.filter((x) => x !== pick);
      placed.add(pick);
      out.push(pick);
    }
    return out;
  }

  // ---------- capacity ----------
  function makeDays(cfg) {
    const end = resolveEnd(cfg);
    const blocked = new Set(cfg.blockedDates);
    const days = [];
    const n = Math.min(diffDays(cfg.startDate, end) + 1, MAX_DAYS);
    for (let i = 0; i < n; i++) {
      const date = addDays(cfg.startDate, i);
      const wd = dow(date);
      if (!cfg.studyDays.includes(wd) || blocked.has(date)) continue;
      const weekend = wd === 0 || wd === 6;
      const hours = weekend && cfg.weekendHours != null ? cfg.weekendHours : cfg.hoursPerDay;
      const cap = f4(hours * (1 - cfg.bufferPct / 100));
      if (cap >= MIN_BLOCK) days.push({ date, hours, cap, free: cap });
    }
    return days;
  }

  // Packs items (in order) into the days' free capacity. dir = 1 forward from the first day, -1 backward from the last.
  function pack(items, days, dir, startIdx) {
    const placed = [];
    const unplaced = [];
    let idx = startIdx != null ? startIdx : dir === 1 ? 0 : days.length - 1;
    const seq = dir === 1 ? items : items.slice().reverse();
    for (const it of seq) {
      let remaining = it.hours;
      let i = it.minIdx != null ? Math.max(idx, it.minIdx) : idx;
      const chunks = [];
      while (remaining > 1e-9 && i >= 0 && i < days.length) {
        const d = days[i];
        const room = f4(d.free);
        if (room >= MIN_BLOCK || (room >= 0.25 && remaining <= room)) {
          const take = Math.min(f4(remaining), room);
          if (take >= 0.25) {
            chunks.push({ date: d.date, hours: take });
            d.free = q4(d.free - take);
            remaining = q4(remaining - take);
          }
        }
        if (remaining > 1e-9) i += dir;
        else break;
      }
      if (it.minIdx == null && chunks.length) idx = clamp(i, 0, days.length - 1);
      chunks.sort((a, b) => (a.date < b.date ? -1 : 1));
      chunks.forEach((c, k) => placed.push({ item: it, date: c.date, hours: c.hours, part: chunks.length > 1 ? `${k + 1}/${chunks.length}` : "" }));
      if (remaining > 1e-9) unplaced.push({ item: it, hours: q4(remaining) });
    }
    return { placed, unplaced };
  }

  // ---------- session content ----------
  function subtasksFor(kind, t, part, unitTopics) {
    const st = (text) => ({ text, done: false });
    if (kind === "learn") {
      if (t.subtopics.length) {
        const [a, b] = part ? part.split("/").map(Number) : [1, 1];
        const per = Math.ceil(t.subtopics.length / b);
        const slice = t.subtopics.slice((a - 1) * per, a * per);
        return (slice.length ? slice : t.subtopics.slice(-1)).map((s) => st(s)).concat(a === b ? [st("Write 3 key takeaways")] : []);
      }
      return [st("Read / watch the material"), st("Make concise notes"), st("Explain it back in your own words")];
    }
    if (kind === "practice") return [st("Solve 10–15 practice questions"), st("Review mistakes and note patterns")];
    return (unitTopics || []).slice(0, 10).map((n) => st(`Recall: ${n}`)).concat([st("Re-read notes on weak spots")]);
  }

  // ---------- planning ----------
  function buildPlan(syllabus, config, opts = {}) {
    const today = opts.today || toISO(new Date());
    const uid = opts.uid || rid;
    const cfg = sanitizeConfig(config, today);
    const errors = validateConfig(cfg);
    if (errors.length) return { errors, sessions: [], conflict: null, assumptions: [], warnings: [], stats: null, config: cfg };

    const warnings = [];
    const assumptions = [];
    const all = flatten(syllabus);
    const active = all.filter((x) => !x.t.done && !x.t.excluded);
    const doneCount = all.filter((x) => x.t.done).length;
    const excludedCount = all.filter((x) => x.t.excluded && !x.t.done).length;
    const days = makeDays(cfg);
    const end = resolveEnd(cfg);

    const stats = {
      topics: active.length, completedTopics: doneCount, excludedTopics: excludedCount, studyDays: days.length,
      calendarDays: diffDays(cfg.startDate, end) + 1, capacity: q4(days.reduce((s, d) => s + d.cap, 0)),
      learn: 0, practice: 0, revisionUnit: 0, revisionFinal: 0, required: 0, spare: 0, firstDate: null, lastDate: null, lastLearnDate: null
    };

    if (!active.length) {
      warnings.push(doneCount ? "Every topic is already marked complete." : "There are no topics to schedule.");
      return { errors: [], sessions: [], conflict: null, assumptions, warnings, stats, config: cfg, unscheduled: [] };
    }
    if (!days.length) {
      return { errors: ["No usable study days between the start date and the deadline. Check your study days, hours and blocked dates."], sessions: [], conflict: null, assumptions, warnings, stats, config: cfg };
    }

    // estimates
    const perUnit = new Map();
    active.forEach((x) => perUnit.set(x.u.id, (perUnit.get(x.u.id) || 0) + 1));
    let noDiff = 0;
    let noImp = 0;
    let estimated = 0;
    let lectureBased = 0;
    const hoursOf = new Map();
    active.forEach((x) => {
      if (!x.t.difficulty) noDiff++;
      if (!x.t.importance) noImp++;
      if (x.t.hours) hoursOf.set(x.t.id, x.t.hours);
      else {
        const e = estimateHours(x.t, x.u, perUnit.get(x.u.id), cfg.level);
        hoursOf.set(x.t.id, e.hours);
        estimated++;
        if (e.basis === "lecture") lectureBased++;
      }
    });
    if (estimated) assumptions.push(`${estimated} topic(s) had no study-time estimate, so hours were estimated from subtopic count and difficulty${lectureBased ? ` (${lectureBased} from the unit's stated lecture hours)` : ""}, adjusted for ${cfg.level} level (x${LEVEL_MULT[cfg.level]}). Edit any topic's hours in the review step.`);
    if (noDiff) assumptions.push(`${noDiff} topic(s) have no difficulty set; they are treated as medium.`);
    if (noImp && cfg.weightImportance) assumptions.push(`${noImp} topic(s) have no exam importance; they are treated as 3/5.`);
    assumptions.push(`${cfg.bufferPct}% of every study day is kept free as buffer; practice adds ${cfg.practicePct}% of each topic's time and revision ${cfg.revisionPct}% of total study time (${cfg.revisionTiming === "both" ? "half after each unit, half in the final days" : cfg.revisionTiming === "end" ? "all in the final days" : "after each unit"}).`);

    const ordered = orderTopics(active, cfg, warnings);
    if (cfg.strategy === "custom" && !cfg.customOrder.length) assumptions.push("Custom plan: no manual ranking yet, so syllabus order is used until you rank topics.");

    // items in sequence
    const items = [];
    let seq = 0;
    const unitLearn = new Map();
    const unitLeft = new Map(perUnit);
    const mk = (o) => ({ seq: seq++, ...o });
    ordered.forEach((x) => {
      const H = hoursOf.get(x.t.id);
      const P = cfg.practicePct > 0 ? Math.max(0.5, q4((H * cfg.practicePct) / 100)) : 0;
      const locked = cfg.lockedTopicDates[x.t.id];
      let minIdx = null;
      if (locked) {
        minIdx = days.findIndex((d) => d.date >= locked);
        if (minIdx === -1) {
          warnings.push(`"${x.t.name}" is locked to ${locked}, which is after your last study day, so the lock was ignored.`);
          minIdx = null;
        }
      }
      items.push(mk({ kind: "learn", topicId: x.t.id, unitId: x.u.id, title: x.t.name, hours: H, minIdx, locked: minIdx != null }));
      if (P) items.push(mk({ kind: "practice", topicId: x.t.id, unitId: x.u.id, title: `Practice: ${x.t.name}`, hours: P, minIdx }));
      stats.learn += H;
      stats.practice += P;
      unitLearn.set(x.u.id, (unitLearn.get(x.u.id) || 0) + H);
      unitLeft.set(x.u.id, unitLeft.get(x.u.id) - 1);
      if (!unitLeft.get(x.u.id) && cfg.revisionTiming !== "end" && cfg.revisionPct > 0) {
        const share = cfg.revisionTiming === "both" ? 0.5 : 1;
        const R = Math.max(0.5, q4((unitLearn.get(x.u.id) * cfg.revisionPct * share) / 100));
        items.push(mk({ kind: "revision", unitId: x.u.id, title: `Revise ${x.u.name}`, hours: R, scope: "unit" }));
        stats.revisionUnit += R;
      }
    });
    const tail = [];
    if (cfg.revisionTiming !== "spread" && cfg.revisionPct > 0) {
      const share = cfg.revisionTiming === "both" ? 0.5 : 1;
      const totalLearn = stats.learn;
      const unitsLeft = [...unitLearn.keys()];
      unitsLeft.forEach((uid2) => {
        const R = Math.max(0.5, q4((totalLearn * cfg.revisionPct * share) / 100 * (unitLearn.get(uid2) / totalLearn)));
        const u = syllabus.units.find((x) => x.id === uid2);
        tail.push(mk({ kind: "revision", unitId: uid2, title: `Final revision: ${u.name}`, hours: R, scope: "final", tail: true }));
        stats.revisionFinal += R;
      });
    }
    stats.learn = q4(stats.learn);
    stats.practice = q4(stats.practice);
    stats.revisionUnit = q4(stats.revisionUnit);
    stats.revisionFinal = q4(stats.revisionFinal);
    stats.required = q4(stats.learn + stats.practice + stats.revisionUnit + stats.revisionFinal);

    // 1) locked topics first, 2) learning/practice/unit revision forward, 3) final revision backward from the deadline
    const lockedItems = items.filter((i) => i.minIdx != null);
    const flowing = items.filter((i) => i.minIdx == null);
    const placed = [];
    const unplaced = [];
    // learning has priority; final revision then takes what is left, filled backward from the deadline
    const lk = pack(lockedItems, days, 1, 0);
    const fw = pack(flowing, days, 1);
    const rev = pack(tail, days, -1);
    placed.push(...rev.placed, ...lk.placed, ...fw.placed);
    unplaced.push(...rev.unplaced, ...lk.unplaced, ...fw.unplaced);

    const unitTopicNames = new Map(syllabus.units.map((u) => [u.id, u.topics.filter((t) => !t.done && !t.excluded).map((t) => t.name)]));
    const topicById = new Map(all.map((x) => [x.t.id, x.t]));
    const sessions = placed.map((p) => {
      const it = p.item;
      const t = it.topicId ? topicById.get(it.topicId) : null;
      return {
        id: uid(), date: p.date, kind: it.kind, topicId: it.topicId || "", unitId: it.unitId,
        title: it.title, part: p.part, hours: p.hours, seq: it.seq, tail: !!it.tail, scope: it.scope || "",
        slot: it.kind === "revision" || it.kind === "practice" ? cfg.revisionSlot : "any",
        subtasks: subtasksFor(it.kind === "revision" ? "revision" : it.kind, t || { subtopics: [] }, p.part, unitTopicNames.get(it.unitId)),
        done: false, locked: !!it.locked
      };
    }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));

    if (sessions.length > MAX_SESSIONS) {
      return { errors: ["That would create too many sessions. Shorten the date range or reduce the number of topics."], sessions: [], conflict: null, assumptions, warnings, stats, config: cfg };
    }

    stats.firstDate = sessions.length ? sessions[0].date : null;
    stats.lastDate = sessions.length ? sessions[sessions.length - 1].date : null;
    const learnSessions = sessions.filter((s) => s.kind === "learn" || s.kind === "practice");
    stats.lastLearnDate = learnSessions.length ? learnSessions[learnSessions.length - 1].date : null;
    stats.spare = q4(days.reduce((s, d) => s + d.free, 0));

    const unscheduled = unplaced.map((u) => ({ kind: u.item.kind, topicId: u.item.topicId || "", unitId: u.item.unitId, title: u.item.title, hours: u.hours }));
    const shortfall = q4(unscheduled.reduce((s, u) => s + u.hours, 0));
    let conflict = null;
    if (shortfall > 0) {
      conflict = {
        shortfall, required: stats.required, capacity: stats.capacity,
        message: `Your syllabus needs about ${stats.required}h but only ${stats.capacity}h of study time is available before ${end} (${days.length} study days at your hours, after a ${cfg.bufferPct}% buffer). ${shortfall}h could not be scheduled.`,
        alternatives: []
      };
      if (!opts.noAlternatives) conflict.alternatives = findAlternatives(syllabus, cfg, { today, uid }, conflict, active, hoursOf);
    }
    const finals = sessions.filter((x) => x.tail);
    if (stats.lastLearnDate && finals.length && !conflict) {
      const gap = diffDays(stats.lastLearnDate, finals[0].date);
      if (gap > 2) warnings.push(`Learning finishes about ${gap} days before the final revision block, leaving ${stats.spare}h of spare time you can use as buffer or extra practice.`);
    } else if (stats.lastLearnDate && !conflict && stats.spare >= cfg.hoursPerDay) {
      const gap = diffDays(stats.lastLearnDate, end);
      if (gap > 2) warnings.push(`Everything is scheduled about ${gap} days before your deadline (${stats.spare}h spare).`);
    }
    return { errors: [], sessions, conflict, assumptions, warnings, stats, config: cfg, unscheduled };
  }

  // Alternatives are verified by re-running the planner, never guessed.
  function findAlternatives(syllabus, cfg, ctx, conflict, active, hoursOf) {
    const alts = [];
    const fits = (patch) => {
      const r = buildPlan(syllabus, { ...cfg, ...patch }, { ...ctx, noAlternatives: true });
      return !r.errors.length && !r.conflict;
    };
    // 1) more hours per day
    for (let h = cfg.hoursPerDay + 0.25; h <= 16; h += 0.25) {
      const patch = { hoursPerDay: q4(h), weekendHours: cfg.weekendHours == null ? null : q4(Math.max(cfg.weekendHours, h)) };
      if (fits(patch)) {
        alts.push({ id: "hours", label: `Study ${patch.hoursPerDay}h per day (instead of ${cfg.hoursPerDay}h)`, patch });
        break;
      }
    }
    // 2) later deadline (exponential then binary search; verified by re-planning)
    const end = resolveEnd(cfg);
    let hi = 1;
    let ok = false;
    while (hi <= 512) {
      if (fits({ mode: "date", endDate: addDays(end, hi) })) { ok = true; break; }
      hi *= 2;
    }
    if (ok) {
      let lo = hi === 1 ? 1 : hi / 2 + 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits({ mode: "date", endDate: addDays(end, mid) })) hi = mid;
        else lo = mid + 1;
      }
      alts.push({ id: "extend", label: `Extend the deadline by ${hi} day(s), to ${addDays(end, hi)}`, patch: { mode: "date", endDate: addDays(end, hi) } });
    }
    // 3) skip the least valuable topics
    const cand = active.slice().sort((a, b) => (a.t.importance || 3) - (b.t.importance || 3) || hoursOf.get(b.t.id) - hoursOf.get(a.t.id));
    const weight = 1 + cfg.practicePct / 100 + cfg.revisionPct / 100;
    let need = conflict.shortfall;
    const drop = [];
    for (const x of cand) {
      if (need <= 0 || drop.length >= cand.length - 1) break;
      drop.push(x);
      need -= hoursOf.get(x.t.id) * weight;
    }
    let guard = 0;
    while (drop.length && drop.length < cand.length - 1 && guard++ < 40) {
      const ids = drop.map((x) => x.t.id);
      const ex = new Set(ids);
      const synth = { ...syllabus, units: syllabus.units.map((u) => ({ ...u, topics: u.topics.map((t) => (ex.has(t.id) ? { ...t, excluded: true } : t)) })) };
      const r = buildPlan(synth, cfg, { ...ctx, noAlternatives: true });
      if (!r.errors.length && !r.conflict) {
        const hrs = q4(drop.reduce((s, x) => s + hoursOf.get(x.t.id), 0));
        alts.push({ id: "trim", label: `Skip ${drop.length} lowest-priority topic(s) (about ${hrs}h): ${drop.slice(0, 3).map((x) => x.t.name).join(", ")}${drop.length > 3 ? "…" : ""}`, patch: { excludeTopicIds: ids } });
        break;
      }
      const nxt = cand.find((x) => !drop.includes(x));
      if (!nxt) break;
      drop.push(nxt);
    }
    // 4) lighter revision
    if (cfg.revisionPct > 5 && fits({ revisionPct: 5, practicePct: Math.min(cfg.practicePct, 10) })) {
      alts.push({ id: "lighter", label: "Keep the plan but cut practice to 10% and revision to 5%", patch: { revisionPct: 5, practicePct: Math.min(cfg.practicePct, 10) } });
    }
    return alts;
  }

  // ---------- re-planning ----------
  // Re-flows every unfinished, unlocked session from today onward (missed sessions first). Done and locked sessions stay put.
  function reschedule(sessions, config, opts = {}) {
    const today = opts.today || toISO(new Date());
    const cfg = sanitizeConfig(config, today);
    const start = today > cfg.startDate ? today : cfg.startDate;
    const rcfg = { ...cfg, startDate: start };
    const errors = validateConfig(rcfg);
    if (errors.length) return { errors, sessions, conflict: null, moved: 0 };
    const days = makeDays(rcfg);
    const dayIdx = new Map(days.map((d, i) => [d.date, i]));
    const keep = [];
    const flow = [];
    sessions.forEach((s) => {
      if (s.done || s.locked) {
        keep.push(s);
        if (dayIdx.has(s.date)) days[dayIdx.get(s.date)].free = Math.max(0, q4(days[dayIdx.get(s.date)].free - s.hours));
      } else flow.push(s);
    });
    flow.sort((a, b) => a.seq - b.seq || (a.date < b.date ? -1 : 1));
    // merge split parts back into one item per original session so labels stay consistent
    const asItem = (s) => ({ ...s, seq: s.seq, _src: s });
    const fwd = pack(flow.filter((s) => !s.tail).map(asItem), days, 1);
    const bwd = pack(flow.filter((s) => s.tail).map(asItem), days, -1);
    const out = keep.slice();
    let moved = 0;
    const emit = (p) => {
      const src = p.item._src;
      if (p.date !== src.date) moved++;
      out.push({ ...src, date: p.date, hours: p.hours, part: p.part || src.part, id: src.id + (p.part ? `-${p.part.split("/")[0]}` : ""), overflow: false });
    };
    [...bwd.placed, ...fwd.placed].forEach(emit);
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    const un = [...fwd.unplaced, ...bwd.unplaced];
    const shortfall = q4(un.reduce((s, u) => s + u.hours, 0));
    let conflict = null;
    if (shortfall > 0) {
      conflict = { shortfall, message: `${shortfall}h of unfinished work no longer fits before ${resolveEnd(cfg)}.`, alternatives: [] };
      const fits = (patch) => {
        const r = reschedule(sessions, { ...cfg, ...patch }, { ...opts, noAlternatives: true });
        return !r.errors.length && !r.conflict;
      };
      if (!opts.noAlternatives) {
        for (let h = cfg.hoursPerDay + 0.25; h <= 16; h += 0.25) {
          const patch = { hoursPerDay: q4(h), weekendHours: cfg.weekendHours == null ? null : q4(Math.max(cfg.weekendHours, h)) };
          if (fits(patch)) { conflict.alternatives.push({ id: "hours", label: `Study ${patch.hoursPerDay}h per day`, patch }); break; }
        }
        const end = resolveEnd(cfg);
        for (let d = 1; d <= 120; d++) {
          if (fits({ mode: "date", endDate: addDays(end, d) })) {
            conflict.alternatives.push({ id: "extend", label: `Extend the deadline by ${d} day(s), to ${addDays(end, d)}`, patch: { mode: "date", endDate: addDays(end, d) } });
            break;
          }
        }
      }
      // keep unplaced work visible instead of silently dropping it
      un.forEach((u) => {
        const src = u.item._src;
        out.push({ ...src, date: resolveEnd(cfg), hours: u.hours, overflow: true });
      });
    }
    return { errors: [], sessions: out, conflict, moved, unscheduledHours: shortfall };
  }

  // ---------- progress ----------
  function progress(sessions, syllabus) {
    const tot = { hours: 0, doneHours: 0, sessions: sessions.length, doneSessions: 0 };
    const unitMap = new Map();
    const topicMap = new Map();
    sessions.forEach((s) => {
      tot.hours += s.hours;
      if (s.done) { tot.doneHours += s.hours; tot.doneSessions++; }
      const u = unitMap.get(s.unitId) || { hours: 0, doneHours: 0, sessions: 0, doneSessions: 0 };
      u.hours += s.hours; u.sessions++;
      if (s.done) { u.doneHours += s.hours; u.doneSessions++; }
      unitMap.set(s.unitId, u);
      if (s.topicId) {
        const t = topicMap.get(s.topicId) || { sessions: 0, doneSessions: 0 };
        t.sessions++;
        if (s.done) t.doneSessions++;
        topicMap.set(s.topicId, t);
      }
    });
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const units = (syllabus ? syllabus.units : []).map((u) => {
      const x = unitMap.get(u.id) || { hours: 0, doneHours: 0, sessions: 0, doneSessions: 0 };
      return { id: u.id, name: u.name, ...x, hours: q4(x.hours), doneHours: q4(x.doneHours), pct: pct(x.doneHours, x.hours) };
    });
    const topicsDone = [...topicMap.values()].filter((t) => t.sessions && t.sessions === t.doneSessions).length;
    return { hours: q4(tot.hours), doneHours: q4(tot.doneHours), sessions: tot.sessions, doneSessions: tot.doneSessions, pct: pct(tot.doneHours, tot.hours), units, topicsDone, topicsTotal: topicMap.size };
  }

  function dayLoad(sessions, date) {
    return q4(sessions.filter((s) => s.date === date).reduce((a, s) => a + s.hours, 0));
  }

  // Checks an (edited) schedule against the config and returns human-readable problems.
  function validateSchedule(sessions, config, today) {
    const cfg = sanitizeConfig(config, today);
    const end = resolveEnd(cfg);
    const issues = [];
    const byDay = new Map();
    sessions.forEach((s) => byDay.set(s.date, (byDay.get(s.date) || 0) + s.hours));
    byDay.forEach((h, date) => {
      const wd = dow(date);
      const cap = wd === 0 || wd === 6 ? (cfg.weekendHours != null ? cfg.weekendHours : cfg.hoursPerDay) : cfg.hoursPerDay;
      if (h > cap + 0.01) issues.push({ date, type: "overload", message: `${date}: ${q4(h)}h planned but you can study ${cap}h.` });
      if (!cfg.studyDays.includes(wd)) issues.push({ date, type: "off-day", message: `${date} is not one of your study days.` });
      if (date > end) issues.push({ date, type: "late", message: `${date} is after your deadline (${end}).` });
      if (date < cfg.startDate) issues.push({ date, type: "early", message: `${date} is before your start date.` });
    });
    return issues;
  }

  // Actions the assistant (or the user) can apply. They return a patch for the project; nothing is applied silently.
  function markTopicComplete(project, topicId) {
    const topic = project.syllabus.units.flatMap((u) => u.topics).find((t) => t.id === topicId);
    if (!topic) return false;
    topic.done = true;
    if (project.schedule) project.schedule.sessions.forEach((s) => { if (s.topicId === topicId) { s.done = true; s.subtasks.forEach((x) => (x.done = true)); } });
    return true;
  }

  function findTopic(syllabus, query) {
    const n = norm(query);
    const list = syllabus.units.flatMap((u) => u.topics);
    return list.find((t) => t.id === query) || list.find((t) => norm(t.name) === n) || list.find((t) => n && norm(t.name).includes(n)) || null;
  }

  // ---------- persistence model ----------
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  function sanitizeSession(s) {
    if (!isObj(s) || !isISO(s.date)) return null;
    const hours = Number(s.hours);
    if (!(hours > 0)) return null;
    return {
      id: str(s.id, 60) || rid(),
      date: s.date,
      kind: KINDS.includes(s.kind) ? s.kind : "learn",
      topicId: str(s.topicId, 40),
      unitId: str(s.unitId, 40),
      title: str(s.title, 200) || "Study session",
      part: /^\d+\/\d+$/.test(s.part || "") ? s.part : "",
      hours: q4(clamp(hours, 0.25, 16)),
      seq: Number.isFinite(Number(s.seq)) ? Number(s.seq) : 0,
      tail: !!s.tail,
      scope: ["unit", "final"].includes(s.scope) ? s.scope : "",
      slot: SLOTS.includes(s.slot) ? s.slot : "any",
      subtasks: arr(s.subtasks).filter(isObj).slice(0, 30).map((x) => ({ text: str(x.text, 200), done: !!x.done })).filter((x) => x.text),
      done: !!s.done,
      locked: !!s.locked,
      overflow: !!s.overflow
    };
  }

  function plainClone(v, max) {
    try {
      const j = JSON.stringify(v);
      return j && j.length <= max ? JSON.parse(j) : null;
    } catch {
      return null;
    }
  }

  function sanitizeProject(p, today) {
    if (!isObj(p)) return null;
    const syllabus = SP.normalize(p.syllabus);
    let schedule = null;
    if (isObj(p.schedule)) {
      const sessions = arr(p.schedule.sessions).slice(0, MAX_SESSIONS).map(sanitizeSession).filter(Boolean);
      schedule = {
        sessions,
        generatedAt: Number(p.schedule.generatedAt) || 0,
        conflict: plainClone(p.schedule.conflict, 6000),
        assumptions: arr(p.schedule.assumptions).map((a) => str(a, 500)).filter(Boolean).slice(0, 20),
        warnings: arr(p.schedule.warnings).map((a) => str(a, 500)).filter(Boolean).slice(0, 20),
        stats: plainClone(p.schedule.stats, 2000)
      };
    }
    return {
      id: str(p.id, 40) || rid(),
      name: str(p.name, 80).trim() || syllabus.title || "Untitled syllabus",
      fileName: str(p.fileName, 200),
      createdAt: Number(p.createdAt) || Date.now(),
      source: p.source === "ai" ? "ai" : "rules",
      aiModel: str(p.aiModel, 80),
      notes: arr(p.notes).map((n) => str(n, 500)).filter(Boolean).slice(0, 20),
      rawText: str(p.rawText, 60000),
      syllabus,
      config: sanitizeConfig(p.config, today),
      schedule,
      stage: ["review", "configure", "preview", "active"].includes(p.stage) ? p.stage : "review",
      planId: str(p.planId, 40),
      answered: ["deadline", "hours", "days", "level", "completed", "difficult", "priority", "slot"].reduce((o, k) => { if (isObj(p.answered) && p.answered[k]) o[k] = true; return o; }, {}),
      detectedDeadline: isISO(p.detectedDeadline) ? p.detectedDeadline : "",
      chat: arr(p.chat).filter(isObj).slice(-40).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: str(m.content, 6000),
        actions: arr(m.actions).filter(isObj).slice(0, 4).map((a) => ({ tool: str(a.tool, 40), input: plainClone(a.input, 400) || {}, label: str(a.label, 200), applied: !!a.applied }))
      })).filter((m) => m.content)
    };
  }

  function sanitizeStudy(raw, today) {
    const r = isObj(raw) ? raw : {};
    const projects = arr(r.projects).slice(0, 20).map((p) => sanitizeProject(p, today)).filter(Boolean);
    return { projects, activeId: projects.some((p) => p.id === r.activeId) ? r.activeId : projects[0] ? projects[0].id : null };
  }

  return {
    defaultConfig, sanitizeConfig, validateConfig, resolveEnd, buildPlan, reschedule, progress, dayLoad, validateSchedule,
    markTopicComplete, findTopic, sanitizeProject, sanitizeStudy, sanitizeSession, flatten,
    util: { addDays, diffDays, isISO, toISO, parseISO, dow, q4 }, LEVEL_MULT, STRATEGIES, MAX_DAYS
  };
});
