/* AI Syllabus Planner: page orchestrator, backend client and tracker sync.
 * Screens live in study-setup.js (upload/review/configure), study-plan.js (preview/calendar/today/progress)
 * and study-chat.js (assistant). Scheduling logic is in planner.js; parsing in syllabus-parse.js.
 */
window.Study = (() => {
  "use strict";

  const SP = window.SyllabusParse;
  const PL = window.Planner;
  const CONN_KEY = "radial-study-conn";
  const EXTRA_COLORS = ["#0EA5A4", "#7C3AED", "#D97706", "#16A34A", "#DB2777", "#2563EB", "#9333EA", "#EA580C"];

  // ---------- backend connection ----------
  function loadConn() {
    try {
      const o = JSON.parse(localStorage.getItem(CONN_KEY) || "{}");
      return { base: typeof o.base === "string" ? o.base : "", token: typeof o.token === "string" ? o.token : "" };
    } catch {
      return { base: "", token: "" };
    }
  }
  function saveConn(c) {
    try {
      localStorage.setItem(CONN_KEY, JSON.stringify(c));
    } catch { /* storage blocked: settings last for this tab only */ }
  }

  const backend = { checked: false, checking: false, ok: false, ai: false, model: null, maxBytes: 10 * 1024 * 1024, authRequired: false, authorized: true, error: "" };

  async function api(path, opts = {}) {
    const c = loadConn();
    const headers = { ...(opts.headers || {}) };
    if (c.token) headers.Authorization = `Bearer ${c.token}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 180000);
    let res;
    try {
      res = await fetch(c.base.replace(/\/$/, "") + path, { ...opts, headers, signal: ctl.signal });
    } catch (e) {
      throw Object.assign(new Error(e.name === "AbortError" ? "The request timed out." : "Could not reach the planner server."), { code: "network" });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch { /* not JSON, e.g. a static host answering 404 */ }
    if (!res.ok) {
      const msg = data && data.error && data.error.message;
      throw Object.assign(new Error(msg || `The planner server is not available here (HTTP ${res.status}).`), { code: (data && data.error && data.error.code) || "http_" + res.status, status: res.status });
    }
    return data;
  }

  async function checkBackend() {
    backend.checking = true;
    try {
      const s = await api("/api/status", { timeout: 6000 });
      Object.assign(backend, {
        checked: true, ok: !!s.ok, ai: !!(s.ai && s.ai.configured), model: s.ai && s.ai.model, authRequired: !!s.authRequired,
        authorized: s.authorized !== false, maxBytes: (s.parse && s.parse.maxBytes) || backend.maxBytes, error: ""
      });
    } catch (e) {
      Object.assign(backend, { checked: true, ok: false, ai: false, model: null, error: e.message });
    }
    backend.checking = false;
  }

  // ---------- shared UI state (survives re-renders and storage-sync re-renders) ----------
  const view = { screen: "home", tab: "today", month: "", sched: "list", editing: false, replan: false, replanStage: "", chatBusy: false };

  let ctx;
  let core;

  const projects = () => ctx.state.study.projects;
  const current = () => ctx.state.study.projects.find((p) => p.id === ctx.state.study.activeId) || null;
  const isActive = (p) => p.stage === "active";
  // while re-planning an approved syllabus the project stays "active" and the setup screens are driven by view.replanStage
  const stageOf = (p) => (view.replan ? view.replanStage || "review" : p.stage);
  const setStage = (p, s) => { if (view.replan) view.replanStage = s; else p.stage = s; };
  const finish = (p) => { p.stage = "active"; view.replan = false; view.replanStage = ""; };

  // ---------- helpers ----------
  const hhmm = (n) => (Number.isInteger(n) ? `${n}h` : `${Math.round(n * 60) % 60 === 0 ? n : n.toFixed(2).replace(/0+$/, "")}h`);
  const hex = (i) => (i < ctx.PALETTE.length ? ctx.PALETTE[i] : EXTRA_COLORS[(i - ctx.PALETTE.length) % EXTRA_COLORS.length]);
  const unitColor = (p, unitId) => hex(Math.max(0, p.syllabus.units.findIndex((u) => u.id === unitId)));
  const unitName = (p, id) => (p.syllabus.units.find((u) => u.id === id) || { name: "" }).name;

  function sessionsOn(p, date) {
    return (p.schedule ? p.schedule.sessions : []).filter((s) => s.date === date).sort((a, b) => a.seq - b.seq);
  }
  const missed = (p) => (p.schedule ? p.schedule.sessions.filter((s) => !s.done && s.date < ctx.todayISO()) : []);

  // ---------- schedule generation ----------
  function generate(p, { keepDone = false } = {}) {
    const today = ctx.todayISO();
    const old = p.schedule ? p.schedule.sessions : [];
    const doneOld = keepDone ? old.filter((s) => s.done) : [];
    if (keepDone) {
      // topics whose learning is fully done leave the remaining plan
      const byTopic = new Map();
      old.filter((s) => s.kind === "learn" && s.topicId).forEach((s) => {
        const e = byTopic.get(s.topicId) || { n: 0, done: 0 };
        e.n++;
        if (s.done) e.done++;
        byTopic.set(s.topicId, e);
      });
      p.syllabus.units.forEach((u) => u.topics.forEach((t) => { const e = byTopic.get(t.id); if (e && e.n === e.done) t.done = true; }));
    }
    const lockedOld = !keepDone ? old.filter((s) => s.locked && !s.done) : [];
    const custom = old.filter((s) => s.kind === "custom" && !s.done);
    const cfg = { ...p.config };
    if (keepDone && cfg.startDate < today) cfg.startDate = today;
    const r = PL.buildPlan(p.syllabus, cfg, { today });
    if (r.errors.length) return r;
    let sessions = r.sessions;
    // keep the user's date locks across a regenerate
    lockedOld.forEach((o) => {
      const i = sessions.findIndex((s) => s.topicId === o.topicId && s.kind === o.kind && s.part === o.part);
      if (i >= 0) sessions.splice(i, 1, { ...sessions[i], date: o.date, locked: true, id: o.id });
    });
    sessions = sessions.concat(custom, doneOld);
    sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    p.schedule = { sessions, generatedAt: Date.now(), conflict: r.conflict, assumptions: r.assumptions, warnings: r.warnings, stats: r.stats };
    p.config = { ...p.config, ...(keepDone && cfg.startDate !== p.config.startDate ? { startDate: cfg.startDate } : {}) };
    return r;
  }

  function reflow(p) {
    const r = PL.reschedule(p.schedule.sessions, p.config, { today: ctx.todayISO() });
    if (r.errors.length) return r;
    p.schedule.sessions = r.sessions;
    p.schedule.conflict = r.conflict;
    return r;
  }

  // ---------- sessions ----------
  function setSessionDone(p, s, done) {
    s.done = done;
    s.subtasks.forEach((x) => (x.done = done));
    const todo = ctx.state.todos.find((t) => t.src === s.id);
    if (todo) todo.done = done;
    syncRadial(p);
    ctx.save();
  }

  function toggleSubtask(p, s, i) {
    s.subtasks[i].done = !s.subtasks[i].done;
    const all = s.subtasks.length && s.subtasks.every((x) => x.done);
    if (all !== s.done) {
      s.done = all;
      const todo = ctx.state.todos.find((t) => t.src === s.id);
      if (todo) todo.done = all;
      syncRadial(p);
    }
    ctx.save();
  }

  function moveSession(p, s, date) {
    if (!ctx.isISO(date)) return false;
    s.date = date;
    s.locked = true; // a manual move is a preference: keep it through regenerate/reschedule
    p.schedule.sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    if (isActive(p)) syncRadial(p);
    return true;
  }

  function removeSession(p, s) {
    p.schedule.sessions = p.schedule.sessions.filter((x) => x !== s);
    ctx.state.todos = ctx.state.todos.filter((t) => t.src !== s.id);
    if (isActive(p)) syncRadial(p);
  }

  // ---------- tracker sync (radial plan + to-dos) ----------
  function syncRadial(p) {
    const sessions = p.schedule ? p.schedule.sessions : [];
    if (!sessions.length) return null;
    let plan = ctx.state.plans.find((x) => x.id === p.planId);
    if (!plan && p.planId) return null; // the user deleted the linked timeline: don't resurrect it silently
    const dates = sessions.map((s) => s.date).sort();
    const startDate = dates[0];
    const last = dates[dates.length - 1];
    const totalDays = ctx.clamp(ctx.diffDays(startDate, last) + 1, 1, 1000);
    const units = p.syllabus.units.filter((u) => sessions.some((s) => s.unitId === u.id));
    const cap = 12;
    const rings = units.slice(0, cap).map((u, i) => ({ unit: u, ids: [u.id], name: u.name, color: hex(p.syllabus.units.indexOf(u)) }));
    if (units.length > cap) rings[cap - 1] = { unit: null, ids: units.slice(cap - 1).map((u) => u.id), name: "Remaining units", color: "#8E8E8E" };
    const catId = (r) => (r.ids.length === 1 ? r.ids[0] : "study-rest");
    if (!plan) {
      plan = { id: ctx.uid(), name: p.name.slice(0, 60), title: p.name.slice(0, 60), startDate, totalDays, categories: [], ticks: {} };
      ctx.state.plans.push(plan);
      p.planId = plan.id;
      ctx.state.activePlanId = plan.id;
    }
    plan.startDate = startDate;
    plan.totalDays = totalDays;
    const old = plan.ticks;
    plan.categories = rings.map((r) => {
      const mine = sessions.filter((s) => r.ids.includes(s.unitId));
      return { id: catId(r), name: r.name.slice(0, 40), color: r.color, deadline: mine.map((s) => s.date).sort().pop() };
    });
    const ticks = {};
    rings.forEach((r) => {
      const id = catId(r);
      const mine = sessions.filter((s) => r.ids.includes(s.unitId));
      const sessionDays = new Set(mine.map((s) => s.date));
      const t = {};
      // keep ticks the user made by hand on days without sessions
      Object.keys(old[id] || {}).forEach((d) => { if (!sessionDays.has(d) && d >= startDate) t[d] = true; });
      sessionDays.forEach((d) => { if (mine.filter((s) => s.date === d).every((s) => s.done)) t[d] = true; });
      if (Object.keys(t).length) ticks[id] = t;
    });
    plan.ticks = ticks;
    return plan;
  }

  function pushTodos(p, days = 7) {
    const today = ctx.todayISO();
    const end = ctx.toISOAdd(today, days - 1);
    let added = 0;
    (p.schedule ? p.schedule.sessions : []).filter((s) => !s.done && s.date <= end).forEach((s) => {
      if (ctx.state.todos.some((t) => t.src === s.id)) return;
      ctx.state.todos.push({
        id: ctx.uid(), text: `${p.name}: ${s.title}${s.part ? ` (${s.part})` : ""} · ${hhmm(s.hours)}`.slice(0, 200),
        priority: s.kind === "learn" ? "high" : "medium", due: s.date < today ? today : s.date, done: false, created: Date.now(), src: s.id
      });
      added++;
    });
    return added;
  }

  // to-dos ticked off in the To-Do page complete their linked study session
  function pullTodos(p) {
    let changed = false;
    (p.schedule ? p.schedule.sessions : []).forEach((s) => {
      const t = ctx.state.todos.find((x) => x.src === s.id);
      if (t && t.done && !s.done) { s.done = true; s.subtasks.forEach((x) => (x.done = true)); changed = true; }
    });
    if (changed) { syncRadial(p); ctx.save(); }
  }

  // ---------- assistant context ----------
  function planSummary(p) {
    const today = ctx.todayISO();
    const sessions = p.schedule ? p.schedule.sessions : [];
    const pr = PL.progress(sessions, p.syllabus);
    const brief = (s) => ({ date: s.date, kind: s.kind, title: s.title, hours: s.hours, unit: unitName(p, s.unitId), done: s.done });
    return JSON.stringify({
      today, stage: p.stage, deadline: PL.resolveEnd(p.config), hoursPerDay: p.config.hoursPerDay, strategy: p.config.strategy,
      progress: { percent: pr.pct, doneHours: pr.doneHours, totalHours: pr.hours, topicsDone: pr.topicsDone, topicsTotal: pr.topicsTotal },
      units: pr.units.map((u) => ({ name: u.name, percent: u.pct })),
      todaySessions: sessions.filter((s) => s.date === today).map(brief),
      missedSessions: sessions.filter((s) => !s.done && s.date < today).slice(0, 15).map(brief),
      next7Days: sessions.filter((s) => !s.done && s.date >= today && s.date <= ctx.toISOAdd(today, 6)).slice(0, 25).map(brief),
      conflict: p.schedule && p.schedule.conflict ? p.schedule.conflict.message : null
    });
  }

  // ---------- page ----------
  function banner(rerender) {
    const { h, icon } = ctx;
    const c = loadConn();
    let tone = "warn";
    let title;
    let text;
    if (backend.checking || !backend.checked) {
      tone = "info";
      title = "Checking the planner server…";
      text = "";
    } else if (!backend.ok) {
      title = "Planner server not connected";
      text = "You can still paste text or upload TXT/CSV/MD and build a full plan here. PDF, Excel and Word parsing and the AI features need the planner server (see Connection settings).";
    } else if (backend.authRequired && !backend.authorized) {
      title = "Access token needed";
      text = "The server is reachable but needs your access token. Enter it in Connection settings.";
    } else if (!backend.ai) {
      title = "Server connected · AI not configured";
      text = "File parsing works. AI analysis and the assistant stay off until ANTHROPIC_API_KEY is set on the server. Plans use the built-in rule-based parser and scheduler.";
    } else {
      tone = "ok";
      title = `Server connected · AI ready${backend.model ? ` (${backend.model})` : ""}`;
      text = "";
    }
    const form = h("form", {
      class: "conn-form", hidden: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const next = { base: baseIn.value.trim(), token: tokIn.value.trim() };
        if (next.base && !/^https?:\/\/[^\s]+$/i.test(next.base)) return ctx.toast("Enter a full URL like https://my-planner.onrender.com", "error");
        saveConn(next);
        await checkBackend();
        rerender();
      }
    });
    const baseIn = h("input", { class: "input", type: "url", placeholder: "Server URL (blank = this site)", value: c.base, "aria-label": "Planner server URL" });
    const tokIn = h("input", { class: "input", type: "password", placeholder: "Access token (if your server uses one)", value: c.token, autocomplete: "off", "aria-label": "Access token" });
    form.append(baseIn, tokIn, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save & test"));
    return h("section", { class: `study-banner ${tone}` },
      h("div", { class: "study-banner-top" },
        h("span", { class: "dot-status" }),
        h("div", { class: "grow" }, h("strong", { text: title }), text ? h("p", { class: "small", text }) : null),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => { await checkBackend(); rerender(); } }, icon("refresh", 14), "Retry"),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { form.hidden = !form.hidden; } }, "Connection settings")),
      form);
  }

  function stepper(stage) {
    const { h } = ctx;
    const steps = [["review", "Review syllabus"], ["configure", "Configure"], ["preview", "Preview plan"], ["active", "Track"]];
    const idx = steps.findIndex((s) => s[0] === stage);
    return h("ol", { class: "stepper", "aria-label": "Progress" }, steps.map(([k, label], i) =>
      h("li", { class: i < idx ? "done" : i === idx ? "now" : "", "aria-current": i === idx ? "step" : null }, h("span", { class: "n", text: i < idx ? "✓" : String(i + 1) }), label)));
  }

  function home(rerender) {
    const { h, icon, bar, emptyState } = ctx;
    const list = projects();
    const wrap = h("div", { class: "study-home" });
    wrap.append(h("div", { class: "row-between" },
      h("div", {}, h("h2", { class: "study-h", text: "Your syllabi" }), h("p", { class: "muted small", text: "Upload a syllabus, set your deadline, and get a realistic day-by-day plan that syncs with your tracker." })),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => { view.screen = "new"; rerender(); } }, icon("plus", 16), "New syllabus")));
    if (!list.length) {
      wrap.append(emptyState("No syllabus yet", "Upload a PDF, Excel, Word or text syllabus (or paste it). You review what was found, answer a few questions, then approve a plan.", "Upload a syllabus", () => { view.screen = "new"; rerender(); }));
      return wrap;
    }
    wrap.append(h("div", { class: "plans-grid" }, list.map((p) => {
      const pr = PL.progress(p.schedule ? p.schedule.sessions : [], p.syllabus);
      const stageLabel = { review: "Needs review", configure: "Needs setup", preview: "Awaiting approval", active: "Active" }[p.stage];
      return h("article", { class: "card plan-card study-card" },
        h("div", { class: "row-between" }, h("strong", { text: p.name }), h("span", { class: "badge " + (p.stage === "active" ? "active" : "neutral"), text: stageLabel })),
        h("p", { class: "muted small", text: `${SP.countTopics(p.syllabus)} topics · ${p.syllabus.units.length} units · ${p.source === "ai" ? "AI-analysed" : "rule-based parse"}` }),
        p.stage === "active" ? h("div", {}, bar(pr.pct), h("p", { class: "small muted", text: `${pr.pct}% done · exam ${ctx.fmt(PL.resolveEnd(p.config), ctx.SHORT)}` })) : null,
        h("div", { class: "plan-actions" },
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { ctx.state.study.activeId = p.id; view.screen = "project"; view.tab = "today"; view.editing = false; view.replan = false; ctx.save(); rerender(); } }, "Open"),
          h("button", { class: "btn btn-danger btn-sm", type: "button", onclick: () => deleteProject(p, rerender) }, icon("trash", 14), "Delete")));
    })));
    return wrap;
  }

  function deleteProject(p, rerender) {
    const linked = ctx.state.plans.find((x) => x.id === p.planId);
    if (!confirm(`Delete "${p.name}"?${linked ? " Its timeline in Plan Timelines is removed too." : ""} This cannot be undone.`)) return;
    ctx.state.study.projects = ctx.state.study.projects.filter((x) => x !== p);
    if (linked) {
      ctx.state.plans = ctx.state.plans.filter((x) => x.id !== linked.id);
      if (ctx.state.activePlanId === linked.id) ctx.state.activePlanId = ctx.state.plans[0] ? ctx.state.plans[0].id : null;
    }
    ctx.state.todos = ctx.state.todos.filter((t) => !t.src || !(p.schedule && p.schedule.sessions.some((s) => s.id === t.src)));
    if (ctx.state.study.activeId === p.id) ctx.state.study.activeId = ctx.state.study.projects[0] ? ctx.state.study.projects[0].id : null;
    view.screen = "home";
    ctx.save();
    rerender();
  }

  function page(root, c) {
    ctx = c;
    core = { ctx, SP, PL, backend, api, view, hhmm, unitColor, unitName, sessionsOn, missed, generate, reflow, setSessionDone, toggleSubtask, moveSession, removeSession, syncRadial, pushTodos, pullTodos, planSummary, current, isActive, checkBackend, stepper, stageOf, setStage, finish };
    if (!ctx.state.study) ctx.state.study = { projects: [], activeId: null };

    const rerender = () => {
      const p = current();
      if (view.screen === "project" && !p) view.screen = "home";
      if (p && isActive(p)) pullTodos(p);
      const kids = [banner(rerender)];
      core.rerender = rerender;
      if (view.screen === "new") kids.push(window.StudySetup.newSyllabus(core));
      else if (view.screen === "project" && p) {
        kids.push(ctx.h("div", { class: "row-between study-nav" },
          ctx.h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { view.screen = "home"; rerender(); } }, "← All syllabi"),
          ctx.h("strong", { class: "study-title", text: p.name })));
        const stage = stageOf(p);
        if (stage !== "active") kids.push(stepper(stage));
        if (stage === "review") kids.push(window.StudySetup.review(core, p));
        else if (stage === "configure") kids.push(window.StudySetup.configure(core, p));
        else if (stage === "preview") kids.push(window.StudyPlan.preview(core, p));
        else kids.push(window.StudyPlan.tracker(core, p));
      } else kids.push(home(rerender));
      root.replaceChildren(...kids);
    };

    if (view.screen === "home" && projects().some(isActive) && !view.visited) {
      view.visited = true;
      ctx.state.study.activeId = ctx.state.study.activeId || projects().find(isActive).id;
      if (current() && isActive(current())) view.screen = "project";
    }
    rerender();
    if (!backend.checked && !backend.checking) checkBackend().then(() => root.isConnected && rerender());
  }

  // card for the Overview page: today's study sessions across active syllabi
  function todayCard(c) {
    ctx = c;
    const { h, icon } = c;
    const active = (c.state.study ? c.state.study.projects : []).filter(isActive);
    const today = c.todayISO();
    const rows = [];
    active.forEach((p) => sessionsOn(p, today).forEach((s) => rows.push({ p, s })));
    if (!rows.length) return null;
    const box = h("section", { class: "card panel study-today-card" });
    const draw = () => {
      box.replaceChildren(
        h("div", { class: "row-between" }, h("h2", { text: "Today's study" }), h("a", { class: "link small", href: "#/study", text: "Open planner" })),
        h("ul", { class: "w-list" }, rows.map(({ p, s }) => h("li", {}, h("button", {
          class: "w-item" + (s.done ? " done" : ""), type: "button", "aria-pressed": String(s.done),
          onclick: () => { setSessionDone(p, s, !s.done); draw(); }
        }, h("span", { class: "check" + (s.done ? " on" : "") }, s.done ? icon("check", 12) : null),
        h("span", { class: "dot", style: `background:${unitColor(p, s.unitId)}` }),
        h("span", { class: "w-name", text: s.title }),
        h("span", { class: "badge neutral", text: hhmm(s.hours) }))))));
    };
    draw();
    return box;
  }

  return { page, todayCard };
})();
