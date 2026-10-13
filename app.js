(() => {
  "use strict";

  const KEY = "radial-tracker-state-v2";
  const LEGACY_KEY = "radial-tracker-state-v1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#F58529", "#DD2A7B", "#8134AF", "#515BD4", "#FCAF45", "#FD1D1D", "#C13584", "#405DE6"];
  const PRIORITIES = ["high", "medium", "low"];
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const MAX_DAYS = 1000;
  const SHORT = { day: "2-digit", month: "short" };

  // ---------- utils ----------
  const $ = (id) => document.getElementById(id);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s;
  const todayISO = () => toISO(new Date());
  const addDays = (s, n) => {
    const d = parseISO(s);
    d.setDate(d.getDate() + n);
    return d;
  };
  const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const fmt = (s, opts = { day: "2-digit", month: "short", year: "numeric" }) =>
    parseISO(s).toLocaleDateString("en-GB", opts);

  const ICONS = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    plans: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    todo: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    manifest: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    notes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
    collapse: '<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
  };

  function icon(name, size = 18) {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || "";
    return s;
  }

  // Tiny DOM builder: h("div", {class, onclick, ...attrs}, ...children). Text is never parsed as HTML.
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    kids.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      e.append(c.nodeType ? c : document.createTextNode(c));
    });
    return e;
  }

  const bar = (pct, color) =>
    h("div", { class: "bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" },
      h("i", { style: `width:${pct}%;${color ? "background:" + color : ""}` }));

  function emptyState(title, text, label, onClick) {
    return h("div", { class: "empty" },
      h("div", { class: "empty-ico" }, icon("spark", 26)),
      h("h3", { text: title }),
      h("p", { text }),
      label ? h("button", { class: "btn btn-primary", type: "button", onclick: onClick }, label) : null);
  }

  let toastTimer;
  function toast(msg, type = "ok") {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 2800);
  }

  // ---------- state ----------
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

  function newPlan(name, startDate, totalDays) {
    return { id: uid(), name, title: name, startDate, totalDays, categories: [], ticks: {} };
  }

  function defaultState() {
    const plan = newPlan("90 Days Action Plan", todayISO(), 90);
    plan.title = "90 DAYS\nACTION PLAN";
    plan.categories = ["DSA", "SQL", "Market Entry", "Guesstimate", "RCA", "Projects"].map((name, i) => ({
      id: uid(), name, color: PALETTE[i], deadline: ""
    }));
    return sanitize({ plans: [plan], activePlanId: plan.id });
  }

  function sanitizePlan(p) {
    const categories = arr(p.categories).filter(isObj).map((c) => ({
      id: str(c.id, 40) || uid(),
      name: str(c.name, 40).trim() || "Task",
      color: HEX.test(c.color) ? c.color : PALETTE[0],
      deadline: isISO(c.deadline) ? c.deadline : ""
    }));
    const ticks = {};
    categories.forEach((c) => {
      const src = isObj(p.ticks) && isObj(p.ticks[c.id]) ? p.ticks[c.id] : {};
      const keys = Object.keys(src).filter((k) => src[k] && isISO(k));
      if (keys.length) ticks[c.id] = Object.fromEntries(keys.map((k) => [k, true]));
    });
    const name = str(p.name, 60).trim() || "Untitled plan";
    return {
      id: str(p.id, 40) || uid(),
      name,
      title: str(p.title, 60).trim() || name,
      startDate: isISO(p.startDate) ? p.startDate : todayISO(),
      totalDays: clamp(Math.round(Number(p.totalDays)) || 30, 1, MAX_DAYS),
      categories,
      ticks
    };
  }

  // Validates and normalises any state-shaped object (saved data and imported files).
  function sanitize(raw) {
    if (!isObj(raw) || !Array.isArray(raw.plans)) throw new Error("This file is not a valid tracker backup.");
    const plans = raw.plans.filter(isObj).map(sanitizePlan);
    const m = isObj(raw.manifest) ? raw.manifest : {};
    return {
      version: 2,
      plans,
      activePlanId: plans.some((p) => p.id === raw.activePlanId) ? raw.activePlanId : plans[0] ? plans[0].id : null,
      todos: arr(raw.todos).filter(isObj).map((t) => ({
        id: str(t.id, 40) || uid(),
        text: str(t.text, 200).trim(),
        priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
        due: isISO(t.due) ? t.due : "",
        done: !!t.done,
        created: Number(t.created) || Date.now()
      })).filter((t) => t.text),
      manifest: {
        vision: str(m.vision, 2000),
        affirmations: arr(m.affirmations).filter(isObj)
          .map((a) => ({ id: str(a.id, 40) || uid(), text: str(a.text, 200).trim() })).filter((a) => a.text),
        goals: arr(m.goals).filter(isObj).map((g) => ({
          id: str(g.id, 40) || uid(),
          text: str(g.text, 150).trim(),
          action: str(g.action, 200).trim(),
          target: isISO(g.target) ? g.target : "",
          done: !!g.done
        })).filter((g) => g.text)
      },
      notes: arr(raw.notes).filter(isObj).map((n) => ({
        id: str(n.id, 40) || uid(),
        title: str(n.title, 80).trim(),
        body: str(n.body, 5000),
        pinned: !!n.pinned,
        updated: Number(n.updated) || Date.now()
      })).filter((n) => n.title || n.body.trim()),
      ui: { collapsed: !!(isObj(raw.ui) && raw.ui.collapsed) }
    };
  }

  // v1 stored a single plan and keyed days by UTC date, which is off by one day in timezones ahead of UTC.
  function migrateLegacy(old) {
    const startDate = isISO(old.startDate) ? old.startDate : todayISO();
    const keyMap = {};
    for (let i = 0; i < MAX_DAYS; i++) {
      const d = addDays(startDate, i);
      keyMap[d.toISOString().slice(0, 10)] = toISO(d);
    }
    const ticks = {};
    Object.entries(isObj(old.ticks) ? old.ticks : {}).forEach(([cid, t]) => {
      ticks[cid] = {};
      Object.keys(isObj(t) ? t : {}).forEach((k) => {
        if (t[k] && keyMap[k]) ticks[cid][keyMap[k]] = true;
      });
    });
    const title = typeof old.title === "string" ? old.title : "Action Plan";
    const plan = {
      id: uid(),
      name: title.replace(/\s+/g, " ").trim() || "Action Plan",
      title,
      startDate,
      totalDays: old.totalDays,
      categories: old.categories,
      ticks
    };
    return sanitize({ plans: [plan], activePlanId: plan.id });
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return sanitize(JSON.parse(raw));
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (isObj(legacy) && Array.isArray(legacy.categories) && legacy.startDate) return migrateLegacy(legacy);
    } catch (e) {
      console.warn("Could not read saved data, starting fresh.", e);
    }
    return defaultState();
  }

  const state = load();
  const widgetRoots = new Set(); // containers currently showing the compact widget (popup page or floating window)

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      toast("Could not save: browser storage is full or blocked.", "error");
    }
    widgetRoots.forEach(renderWidget);
  }

  function setState(next) {
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, next);
  }

  function replaceState(next) {
    setState(next);
    save();
  }

  // ---------- selectors / progress ----------
  const getPlan = (id) => state.plans.find((p) => p.id === id) || null;
  const activePlan = () => getPlan(state.activePlanId) || state.plans[0] || null;
  const planEnd = (plan) => toISO(addDays(plan.startDate, plan.totalDays - 1));

  function planStatus(plan) {
    const t = todayISO();
    if (t < plan.startDate) return { key: "upcoming", label: `Starts in ${diffDays(t, plan.startDate)}d` };
    if (t > planEnd(plan)) return { key: "ended", label: "Ended" };
    return { key: "active", label: `Day ${diffDays(plan.startDate, t) + 1} of ${plan.totalDays}` };
  }

  // A task with a deadline is measured from plan start up to that deadline; otherwise across the whole plan.
  function taskProgress(plan, cat) {
    let total = plan.totalDays;
    if (cat.deadline) total = clamp(diffDays(plan.startDate, cat.deadline) + 1, 1, plan.totalDays);
    const last = toISO(addDays(plan.startDate, total - 1));
    const done = Object.keys(plan.ticks[cat.id] || {}).filter((k) => k >= plan.startDate && k <= last).length;
    return { done, total, pct: Math.round((done / total) * 100) };
  }

  function planProgress(plan) {
    let done = 0;
    let total = 0;
    plan.categories.forEach((c) => {
      const p = taskProgress(plan, c);
      done += p.done;
      total += p.total;
    });
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function todoStats() {
    const t = todayISO();
    const open = state.todos.filter((x) => !x.done);
    return {
      total: state.todos.length,
      open: open.length,
      done: state.todos.length - open.length,
      overdue: open.filter((x) => x.due && x.due < t).length,
      today: open.filter((x) => x.due === t).length
    };
  }

  function toggleTick(plan, catId, iso) {
    const t = plan.ticks[catId] || (plan.ticks[catId] = {});
    if (t[iso]) delete t[iso];
    else t[iso] = true;
    if (!Object.keys(t).length) delete plan.ticks[catId];
    save();
  }

  function deadlineBadge(plan, cat) {
    if (!cat.deadline) return null;
    const p = taskProgress(plan, cat);
    const diff = diffDays(todayISO(), cat.deadline);
    let cls = "soon";
    let label;
    if (p.pct === 100) {
      cls = "ok";
      label = "Complete";
    } else if (diff < 0) {
      cls = "late";
      label = `Deadline passed · ${p.pct}%`;
    } else if (diff === 0) label = "Due today";
    else label = `${diff}d left`;
    return h("span", { class: "badge " + cls, title: `Deadline ${fmt(cat.deadline)}`, text: label });
  }

  function statCard(ico, label, value, sub, pct) {
    return h("div", { class: "stat card" },
      h("div", { class: "stat-ico" }, icon(ico, 20)),
      h("div", { class: "stat-body" },
        h("div", { class: "stat-label", text: label }),
        h("div", { class: "stat-value", text: value }),
        h("div", { class: "stat-sub", text: sub })),
      pct == null ? null : bar(pct));
  }

  // ---------- radial chart ----------
  function polar(cx, cy, r, angleDeg) {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function arcPath(cx, cy, r, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const p1 = polar(cx, cy, r, startAngle);
    const p2 = polar(cx, cy, r, endAngle);
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
  }

  function donutSegPath(cx, cy, innerR, outerR, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const p1 = polar(cx, cy, outerR, startAngle);
    const p2 = polar(cx, cy, outerR, endAngle);
    const p3 = polar(cx, cy, innerR, endAngle);
    const p4 = polar(cx, cy, innerR, startAngle);
    return [
      `M ${p1.x} ${p1.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
      `L ${p3.x} ${p3.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
      "Z"
    ].join(" ");
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }

  const tooltip = $("tooltip");
  function showTooltip(ev, text) {
    tooltip.textContent = text;
    tooltip.style.left = ev.clientX + "px";
    tooltip.style.top = ev.clientY + "px";
    tooltip.classList.add("visible");
  }
  const hideTooltip = () => tooltip.classList.remove("visible");

  function drawChart(plan, svg, container, onTick, compact = false) {
    svg.replaceChildren();
    const n = Math.max(1, plan.totalDays);
    const catCount = Math.max(1, plan.categories.length);

    const ringWidth = compact ? 38 : 44;
    const ringGap = compact ? 5 : 6;
    const innerHole = compact ? 80 : 130;
    const labelPad = compact ? 50 : 70;
    const outerR = innerHole + catCount * (ringWidth + ringGap);
    const size = (outerR + labelPad) * 2;
    const cx = size / 2;
    const cy = size / 2;

    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

    const GAP = plan.categories.length ? (compact ? 56 : 44) : 16; // opening left in the wheel; it holds the task names at the start of each ring
    const totalSpan = 360 - GAP;
    const anglePerDay = totalSpan / n;
    const angleOffset = 180 + GAP / 2; // opening centred at the bottom

    const days = Array.from({ length: n }, (_, i) => {
      const d = addDays(plan.startDate, i);
      return { d, iso: toISO(d), start: angleOffset + i * anglePerDay };
    });

    days.forEach(({ d, start }) => {
      if (!isWeekend(d)) return;
      svg.appendChild(svgEl("path", {
        d: donutSegPath(cx, cy, innerHole - 4, outerR + 4, start, start + anglePerDay),
        fill: "#e6d9f3",
        "fill-opacity": 0.65,
        class: "weekend-band"
      }));
    });

    const deadlineMarks = [];
    plan.categories.forEach((cat, ringIdx) => {
      const innerR = innerHole + ringIdx * (ringWidth + ringGap);
      const outer = innerR + ringWidth;
      const ticks = plan.ticks[cat.id] || {};

      days.forEach(({ d, iso, start }) => {
        const done = !!ticks[iso];
        const path = svgEl("path", {
          d: donutSegPath(cx, cy, innerR, outer, start, start + anglePerDay),
          fill: done ? cat.color : "transparent",
          "fill-opacity": done ? 0.92 : 1,
          class: "day-seg",
          "data-cat": cat.id,
          "data-date": iso
        });
        path.addEventListener("click", () => onTick(cat.id, iso));
        path.addEventListener("mousemove", (ev) =>
          showTooltip(ev, `${cat.name} — ${d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}${done ? " ✓" : ""}${cat.deadline === iso ? " · deadline" : ""}`));
        path.addEventListener("mouseleave", hideTooltip);
        svg.appendChild(path);
        if (cat.deadline === iso) {
          deadlineMarks.push(svgEl("path", {
            d: donutSegPath(cx, cy, innerR, outer, start, start + anglePerDay),
            fill: "none", stroke: "#262626", "stroke-width": 2.2, "pointer-events": "none"
          }));
        }
      });
    });

    // radial spokes separating each day across the full ring stack
    for (let i = 0; i <= n; i++) {
      const angle = angleOffset + i * anglePerDay;
      const a = polar(cx, cy, innerHole - 4, angle);
      const b = polar(cx, cy, outerR + 4, angle);
      svg.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#dbdbdb", "stroke-width": 1.2, "pointer-events": "none" }));
    }

    // concentric ring boundaries (open, matching the gap)
    for (let ringIdx = 0; ringIdx <= plan.categories.length; ringIdx++) {
      const r = innerHole + ringIdx * (ringWidth + ringGap) - (ringIdx === 0 ? 0 : ringGap / 2);
      svg.appendChild(svgEl("path", {
        d: arcPath(cx, cy, r, angleOffset, angleOffset + totalSpan),
        fill: "none", stroke: "#e3e3e3", "stroke-width": 1, "pointer-events": "none"
      }));
    }

    // end-caps closing off the start and end of the spiral
    [angleOffset, angleOffset + totalSpan].forEach((angle) => {
      const a = polar(cx, cy, innerHole - 4, angle);
      const b = polar(cx, cy, outerR + 4, angle);
      svg.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#8e8e8e", "stroke-width": 2, "pointer-events": "none" }));
    });

    // task names sit in the opening, right at the start of their own ring
    plan.categories.forEach((cat, ringIdx) => {
      const rMid = innerHole + ringIdx * (ringWidth + ringGap) + ringWidth / 2;
      const a = polar(cx, cy, rMid, angleOffset);
      const b = polar(cx, cy, rMid, angleOffset + totalSpan);
      const y = (a.y + polar(cx, cy, rMid, 180).y) / 2;
      const width = b.x - a.x - 8;
      svg.appendChild(svgEl("rect", {
        x: a.x + 4, y: y - (compact ? 13 : 15), width, height: compact ? 26 : 30, rx: 8, fill: cat.color, "fill-opacity": 0.14, "pointer-events": "none"
      }));
      svg.appendChild(svgEl("circle", { cx: a.x + 14, cy: y, r: 4.5, fill: cat.color, "pointer-events": "none" }));
      const textW = width - 28;
      const label = svgEl("text", { x: a.x + 24, y, class: "ring-label", "dominant-baseline": "central", style: compact ? "font-size:16px" : "" });
      if (cat.name.length * (compact ? 9.4 : 7.4) > textW) {
        label.setAttribute("textLength", textW);
        label.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
      label.textContent = cat.name;
      svg.appendChild(label);
    });

    deadlineMarks.forEach((m) => svg.appendChild(m));

    const todayIdx = diffDays(plan.startDate, todayISO());
    if (todayIdx >= 0 && todayIdx < n) {
      const s = days[todayIdx].start;
      svg.appendChild(svgEl("path", {
        d: donutSegPath(cx, cy, innerHole - 4, outerR + 4, s, s + anglePerDay),
        fill: "none", stroke: "#DD2A7B", "stroke-width": 2.5, "pointer-events": "none"
      }));
    }

    // day-of-month labels around the outer edge
    const step = compact ? (n <= 16 ? 1 : n <= 31 ? 2 : n <= 62 ? 4 : n <= 120 ? 10 : 30) : n <= 31 ? 1 : n <= 62 ? 2 : n <= 120 ? 3 : 7;
    for (let i = 0; i < n; i += step) {
      const mid = days[i].start + anglePerDay / 2;
      const pos = polar(cx, cy, outerR + 22, mid);
      const midNorm = ((mid % 360) + 360) % 360;
      const rot = midNorm > 90 && midNorm < 270 ? mid + 180 : mid;
      const t = svgEl("text", {
        x: pos.x, y: pos.y, class: "day-label", "text-anchor": "middle", style: compact ? "font-size:15px" : "",
        transform: `rotate(${rot}, ${pos.x}, ${pos.y})`
      });
      t.textContent = days[i].d.getDate();
      svg.appendChild(t);
    }

    container.style.setProperty("--wheel", size + "px");
    container.style.setProperty("--hole", (((innerHole - 4) * 2) / size * 100).toFixed(1));
    container.classList.toggle("tiny-hole", ((innerHole - 4) * 2) / size < 0.26);
  }

  // ---------- Overview ----------
  function pageOverview(root) {
    if (!state.plans.length) {
      root.append(emptyState("No timelines yet", "Create a plan to start tracking progress on your radial wheel.", "Create a plan", () => (location.hash = "#/plans")));
      return;
    }

    const statsEl = h("section", { class: "stats-grid" });
    const stripEl = h("section", { class: "plan-strip", "aria-label": "Your plans" });
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Radial progress chart. Click a segment to tick or untick a day.");
    const titleEl = h("div", { class: "center-title", contenteditable: "true", role: "textbox", "aria-label": "Plan title" });
    titleEl.setAttribute("spellcheck", "false");
    const dateEl = h("div", { class: "center-date" });
    const container = h("div", { class: "radial-container" }, svg,
      h("div", { class: "center-label" }, titleEl, h("div", { class: "center-sub", text: "STARTING FROM" }), dateEl));

    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleEl.blur();
      }
    });
    titleEl.addEventListener("blur", () => {
      const plan = activePlan();
      plan.title = titleEl.textContent.trim().slice(0, 60) || plan.name;
      titleEl.textContent = plan.title;
      save();
    });

    // controls (static form parts are built once; dynamic parts are refreshed)
    const periodBtns = [[10, "10 Days"], [30, "1 Month"], [90, "3 Months"], [365, "1 Year"]].map(([d, label]) =>
      h("button", { type: "button", "data-days": d, onclick: () => setDays(d) }, label));
    const customInput = h("input", { class: "input", type: "number", min: "1", max: String(MAX_DAYS), placeholder: "Custom days", "aria-label": "Custom number of days" });
    const applyCustom = () => {
      const v = Number(customInput.value);
      if (!Number.isInteger(v) || v < 1 || v > MAX_DAYS) return toast(`Enter a whole number of days between 1 and ${MAX_DAYS}.`, "error");
      customInput.value = "";
      setDays(v);
    };
    customInput.addEventListener("keydown", (e) => e.key === "Enter" && applyCustom());
    const startInput = h("input", { class: "input", type: "date", "aria-label": "Start date" });
    startInput.addEventListener("change", () => {
      if (!isISO(startInput.value)) {
        toast("Pick a valid start date.", "error");
        return refresh();
      }
      activePlan().startDate = startInput.value;
      save();
      refresh();
    });

    const taskListEl = h("ul", { class: "task-list" });
    const newName = h("input", { class: "input", type: "text", placeholder: "New task name", maxlength: "24", "aria-label": "New task name" });
    const newColor = h("input", { type: "color", "aria-label": "Task colour" });
    const nextColor = () => (newColor.value = PALETTE[activePlan().categories.length % PALETTE.length].toLowerCase());
    const addForm = h("form", {
      class: "add-task-form",
      onsubmit: (e) => {
        e.preventDefault();
        const name = newName.value.trim();
        if (!name) return toast("Give the task a name first.", "error");
        const plan = activePlan();
        plan.categories.push({ id: uid(), name, color: newColor.value, deadline: "" });
        newName.value = "";
        nextColor();
        save();
        refresh();
      }
    }, newColor, newName, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Add"));

    const progressText = h("div", { class: "stats-text" });
    const clearBtn = h("button", {
      class: "btn btn-danger btn-block", type: "button",
      onclick: () => {
        if (confirm("Clear all ticked days in this plan? This cannot be undone.")) {
          activePlan().ticks = {};
          save();
          refresh();
        }
      }
    }, "Clear all ticks");

    const controls = h("aside", { class: "controls" },
      h("section", { class: "card panel" }, h("h2", { text: "Time Period" }),
        h("div", { class: "period-buttons" }, periodBtns),
        h("div", { class: "custom-period" }, customInput, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: applyCustom }, "Set")),
        h("label", { class: "start-date-label" }, "Start date", startInput)),
      h("section", { class: "card panel" }, h("h2", { text: "Tasks" }), taskListEl, addForm,
        h("a", { class: "link small", href: "#/plans" }, "Set deadlines in Plan Timelines →")),
      h("section", { class: "card panel" }, h("h2", { text: "Legend" }),
        h("div", { class: "legend" },
          h("div", { class: "legend-item" }, h("span", { class: "swatch done" }), "Done"),
          h("div", { class: "legend-item" }, h("span", { class: "swatch pending" }), "Pending"),
          h("div", { class: "legend-item" }, h("span", { class: "swatch weekend" }), "Weekend"),
          h("div", { class: "legend-item" }, h("span", { class: "swatch today" }), "Today"),
          h("div", { class: "legend-item" }, h("span", { class: "swatch deadline" }), "Deadline")),
        progressText, clearBtn));

    function setDays(n) {
      activePlan().totalDays = n;
      save();
      refresh();
    }

    function renderStats(plan) {
      const pr = planProgress(plan);
      const ts = todoStats();
      const t = todayISO();
      const running = t >= plan.startDate && t <= planEnd(plan);
      const tickedToday = running ? plan.categories.filter((c) => plan.ticks[c.id] && plan.ticks[c.id][t]).length : 0;
      const activeCount = state.plans.filter((p) => planStatus(p).key === "active").length;
      const upcoming = state.plans.filter((p) => planStatus(p).key === "upcoming").length;
      statsEl.replaceChildren(
        statCard("trend", "Plan progress", `${pr.pct}%`, `${pr.done}/${pr.total} ticks · ${plan.name}`, pr.pct),
        statCard("sun", "Today", running ? `${tickedToday}/${plan.categories.length}` : "—",
          running ? "tasks ticked today" : "this plan isn't running today",
          running && plan.categories.length ? Math.round((tickedToday / plan.categories.length) * 100) : null),
        statCard("todo", "To-dos", `${ts.open} open`, `${ts.done} done · ${ts.overdue} overdue`,
          ts.total ? Math.round((ts.done / ts.total) * 100) : null),
        statCard("layers", "Active plans", `${activeCount}/${state.plans.length}`, `${upcoming} upcoming · ${state.plans.length - activeCount - upcoming} ended`));
    }

    function renderStrip() {
      const current = activePlan().id;
      stripEl.replaceChildren(...state.plans.map((p) => {
        const st = planStatus(p);
        const pr = planProgress(p);
        return h("button", {
          type: "button",
          class: "plan-chip" + (p.id === current ? " selected" : ""),
          "aria-pressed": String(p.id === current),
          onclick: () => {
            state.activePlanId = p.id;
            save();
            nextColor();
            refresh();
          }
        },
        h("div", { class: "plan-chip-top" }, h("strong", { text: p.name }), h("span", { class: "badge " + st.key, text: st.label })),
        h("div", { class: "muted small", text: `${fmt(p.startDate, SHORT)} → ${fmt(planEnd(p), SHORT)}` }),
        bar(pr.pct),
        h("div", { class: "small muted", text: `${pr.pct}% · ${p.categories.length} task${p.categories.length === 1 ? "" : "s"}` }));
      }));
    }

    function renderControls(plan) {
      periodBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.days) === plan.totalDays));
      startInput.value = plan.startDate;
      taskListEl.replaceChildren(...(plan.categories.length
        ? plan.categories.map((cat) => {
          const p = taskProgress(plan, cat);
          return h("li", {},
            h("span", { class: "dot", style: `background:${cat.color}` }),
            h("span", { class: "name", text: cat.name, title: cat.name }),
            h("span", { class: "small muted", text: `${p.pct}%` }),
            h("button", {
              class: "icon-btn danger", type: "button", title: "Remove task", "aria-label": `Remove ${cat.name}`,
              onclick: () => {
                if (!confirm(`Remove "${cat.name}" and its ticks?`)) return;
                plan.categories = plan.categories.filter((c) => c.id !== cat.id);
                delete plan.ticks[cat.id];
                save();
                nextColor();
                refresh();
              }
            }, icon("x", 15)));
        })
        : [h("li", { class: "muted small" }, "No tasks yet. Add one below to create your first ring.")]));
      const pr = planProgress(plan);
      progressText.textContent = pr.total ? `${pr.done} / ${pr.total} ticked (${pr.pct}%)` : "";
    }

    function refresh() {
      const plan = activePlan();
      renderStats(plan);
      renderStrip();
      renderControls(plan);
      titleEl.textContent = plan.title;
      dateEl.textContent = fmt(plan.startDate, { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
      drawChart(plan, svg, container, (catId, iso) => {
        toggleTick(plan, catId, iso);
        refresh();
      });
    }

    root.append(statsEl, stripEl,
      h("div", { class: "overview-grid" }, h("div", { class: "card canvas-card" }, h("div", { class: "canvas-scroll" }, container)), controls));
    nextColor();
    refresh();
  }

  // ---------- Plan Timelines ----------
  function validatePlanFields(name, start, days) {
    if (!name.trim()) return "Give the plan a name.";
    if (!isISO(start)) return "Pick a valid start date.";
    const d = Number(days);
    if (!Number.isInteger(d) || d < 1 || d > MAX_DAYS) return `Duration must be a whole number between 1 and ${MAX_DAYS} days.`;
    return "";
  }

  function pagePlans(root) {
    let editingId = null;
    const list = h("div", { class: "plans-grid" });

    const nameIn = h("input", { class: "input", type: "text", placeholder: "e.g. Placement prep", maxlength: "60", "aria-label": "Plan name" });
    const startIn = h("input", { class: "input", type: "date", value: todayISO(), "aria-label": "Start date" });
    const daysIn = h("input", { class: "input", type: "number", min: "1", max: String(MAX_DAYS), value: "30", "aria-label": "Duration in days" });
    const createForm = h("form", {
      class: "card form-card",
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const err = validatePlanFields(nameIn.value, startIn.value, daysIn.value);
        if (err) return toast(err, "error");
        const plan = newPlan(nameIn.value.trim(), startIn.value, Number(daysIn.value));
        state.plans.push(plan);
        state.activePlanId = plan.id;
        save();
        nameIn.value = "";
        renderList();
        toast(`"${plan.name}" created. Add its first task below.`);
      }
    },
    h("h2", { text: "New timeline" }),
    h("div", { class: "form-grid" },
      h("label", { class: "field" }, "Name", nameIn),
      h("label", { class: "field" }, "Start date", startIn),
      h("label", { class: "field" }, "Duration (days)", daysIn),
      h("div", { class: "field" }, "Quick pick",
        h("div", { class: "chips" }, [7, 30, 90].map((d) => h("button", { class: "chip", type: "button", onclick: () => (daysIn.value = d) }, `${d}d`))))),
    h("button", { class: "btn btn-primary", type: "submit" }, icon("plus", 16), "Create timeline"));

    function taskRow(plan, cat) {
      const p = taskProgress(plan, cat);
      const end = planEnd(plan);
      const dl = h("input", {
        class: "input input-sm", type: "date", value: cat.deadline, min: plan.startDate, max: end,
        "aria-label": `Deadline for ${cat.name}`,
        onchange: (e) => {
          const v = e.target.value;
          if (v && (!isISO(v) || v < plan.startDate || v > end)) {
            toast(`Deadline must fall between ${fmt(plan.startDate)} and ${fmt(end)}.`, "error");
            return renderList();
          }
          cat.deadline = v;
          save();
          renderList();
        }
      });
      return h("li", { class: "ptask" },
        h("div", { class: "ptask-main" }, h("span", { class: "dot", style: `background:${cat.color}` }), h("strong", { text: cat.name }), deadlineBadge(plan, cat)),
        h("div", { class: "ptask-side" }, dl,
          h("span", { class: "small muted", text: `${p.done}/${p.total} · ${p.pct}%` }),
          h("button", {
            class: "icon-btn danger", type: "button", "aria-label": `Remove ${cat.name}`,
            onclick: () => {
              if (!confirm(`Remove "${cat.name}" and its progress?`)) return;
              plan.categories = plan.categories.filter((c) => c.id !== cat.id);
              delete plan.ticks[cat.id];
              save();
              renderList();
            }
          }, icon("x", 16))),
        bar(p.pct, cat.color));
    }

    function addTaskForm(plan) {
      const color = h("input", { type: "color", value: PALETTE[plan.categories.length % PALETTE.length].toLowerCase(), "aria-label": "Task colour" });
      const name = h("input", { class: "input", type: "text", placeholder: "Add a task", maxlength: "24", "aria-label": "Task name" });
      const end = planEnd(plan);
      const dl = h("input", { class: "input input-sm", type: "date", min: plan.startDate, max: end, "aria-label": "Task deadline (optional)", title: "Deadline (optional)" });
      return h("form", {
        class: "add-task-form wrap",
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          if (!name.value.trim()) return toast("Give the task a name first.", "error");
          if (dl.value && (!isISO(dl.value) || dl.value < plan.startDate || dl.value > end)) {
            return toast(`Deadline must fall between ${fmt(plan.startDate)} and ${fmt(end)}.`, "error");
          }
          plan.categories.push({ id: uid(), name: name.value.trim(), color: color.value, deadline: dl.value });
          save();
          renderList();
        }
      }, color, name, dl, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Add"));
    }

    function editForm(plan) {
      const n = h("input", { class: "input", type: "text", value: plan.name, maxlength: "60", "aria-label": "Plan name" });
      const s = h("input", { class: "input", type: "date", value: plan.startDate, "aria-label": "Start date" });
      const d = h("input", { class: "input", type: "number", min: "1", max: String(MAX_DAYS), value: String(plan.totalDays), "aria-label": "Duration in days" });
      return h("form", {
        class: "edit-form", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const err = validatePlanFields(n.value, s.value, d.value);
          if (err) return toast(err, "error");
          if (plan.title === plan.name) plan.title = n.value.trim();
          plan.name = n.value.trim();
          plan.startDate = s.value;
          plan.totalDays = Number(d.value);
          editingId = null;
          save();
          renderList();
          toast("Timeline updated");
        }
      },
      h("div", { class: "form-grid" },
        h("label", { class: "field" }, "Name", n),
        h("label", { class: "field" }, "Start date", s),
        h("label", { class: "field" }, "Days", d)),
      h("div", { class: "row-end" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { editingId = null; renderList(); } }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save")));
    }

    function planCard(plan) {
      const st = planStatus(plan);
      const pr = planProgress(plan);
      const head = editingId === plan.id
        ? editForm(plan)
        : h("div", { class: "plan-head" },
          h("div", {}, h("h3", { text: plan.name }),
            h("p", { class: "muted small", text: `${fmt(plan.startDate)} → ${fmt(planEnd(plan))} · ${plan.totalDays} days` })),
          h("span", { class: "badge " + st.key, text: st.label }));
      return h("article", { class: "card plan-card" + (plan.id === state.activePlanId ? " is-active" : "") },
        head,
        h("div", { class: "plan-progress" }, bar(pr.pct), h("span", { class: "small muted", text: `${pr.pct}% · ${pr.done}/${pr.total} ticks` })),
        plan.categories.length
          ? h("ul", { class: "ptask-list" }, plan.categories.map((c) => taskRow(plan, c)))
          : h("p", { class: "muted small", text: "No tasks yet. Add the first one below." }),
        addTaskForm(plan),
        h("div", { class: "plan-actions" },
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { state.activePlanId = plan.id; save(); location.hash = "#/overview"; } }, "Open radial"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { editingId = plan.id; renderList(); } }, icon("edit", 15), "Edit"),
          h("button", {
            class: "btn btn-danger btn-sm", type: "button",
            onclick: () => {
              if (!confirm(`Delete "${plan.name}" and all its progress?`)) return;
              state.plans = state.plans.filter((p) => p.id !== plan.id);
              if (state.activePlanId === plan.id) state.activePlanId = state.plans[0] ? state.plans[0].id : null;
              save();
              renderList();
            }
          }, icon("trash", 15), "Delete")));
    }

    function renderList() {
      list.replaceChildren(...(state.plans.length
        ? state.plans.map(planCard)
        : [emptyState("No timelines yet", "Use the form above to create your first one.")]));
    }

    root.append(createForm,
      h("p", { class: "muted small hint" }, "Each timeline is fully independent. Task progress is measured from the start up to its deadline, or across the whole plan if no deadline is set."),
      list);
    renderList();
  }

  // ---------- 7 / 30 / 90-day views ----------
  const win = { planId: null, mode: "30", custom: 14, anchor: "today" };

  function pageWindows(root) {
    if (!state.plans.length) {
      root.append(emptyState("No timelines yet", "Create a plan first, then filter it by 7, 30 or 90 days.", "Create a plan", () => (location.hash = "#/plans")));
      return;
    }
    if (!getPlan(win.planId)) win.planId = activePlan().id;

    const body = h("div", { class: "win-body" });
    const tabs = h("div", { class: "seg", role: "tablist" });
    const customIn = h("input", { class: "input input-sm", type: "number", min: "1", max: "365", value: String(win.custom), "aria-label": "Custom number of days" });
    const applyCustom = () => {
      const v = Number(customIn.value);
      if (!Number.isInteger(v) || v < 1 || v > 365) return toast("Enter a whole number of days between 1 and 365.", "error");
      win.custom = v;
      renderBody();
    };
    customIn.addEventListener("keydown", (e) => e.key === "Enter" && applyCustom());
    const customWrap = h("div", { class: "custom-inline" }, customIn, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: applyCustom }, "Apply"));

    const planSel = h("select", {
      class: "input", "aria-label": "Plan",
      onchange: (e) => { win.planId = e.target.value; renderBody(); }
    }, state.plans.map((p) => h("option", { value: p.id, selected: p.id === win.planId }, p.name)));
    const anchorSel = h("select", {
      class: "input", "aria-label": "Window start",
      onchange: (e) => { win.anchor = e.target.value; renderBody(); }
    }, h("option", { value: "today", selected: win.anchor === "today" }, "Starting today"),
    h("option", { value: "plan", selected: win.anchor === "plan" }, "From plan start"));

    const windowDays = () => (win.mode === "custom" ? win.custom : Number(win.mode));

    function renderTabs() {
      tabs.replaceChildren(...["7", "30", "90", "custom"].map((m) =>
        h("button", {
          type: "button", role: "tab", class: "seg-btn" + (win.mode === m ? " active" : ""), "aria-selected": String(win.mode === m),
          onclick: () => { win.mode = m; renderTabs(); renderBody(); }
        }, m === "custom" ? "Custom" : `${m} days`)));
      customWrap.hidden = win.mode !== "custom";
    }

    function renderBody() {
      const plan = getPlan(win.planId);
      const n = windowDays();
      const start = win.anchor === "plan" ? plan.startDate : todayISO();
      const dates = Array.from({ length: n }, (_, i) => toISO(addDays(start, i)));
      const end = dates[n - 1];
      const pend = planEnd(plan);
      const today = todayISO();
      const inPlan = (d) => d >= plan.startDate && d <= pend;
      const applicable = dates.filter(inPlan).length;

      let doneAll = 0;
      const rows = plan.categories.map((cat) => {
        const t = plan.ticks[cat.id] || {};
        const done = dates.filter((d) => inPlan(d) && t[d]).length;
        doneAll += done;
        const pct = applicable ? Math.round((done / applicable) * 100) : 0;
        return h("article", { class: "card task-row" },
          h("div", { class: "task-row-head" },
            h("span", { class: "dot", style: `background:${cat.color}` }), h("strong", { text: cat.name }), deadlineBadge(plan, cat),
            h("span", { class: "muted small push", text: `${done}/${applicable} days · ${pct}%` })),
          bar(pct, cat.color),
          h("div", { class: "day-grid" }, dates.map((d, i) => {
            const dt = parseISO(d);
            const on = !!t[d];
            return h("button", {
              type: "button",
              class: "day-cell" + (on ? " on" : "") + (d === today ? " today" : "") + (isWeekend(dt) ? " weekend" : "") + (cat.deadline === d ? " deadline" : ""),
              style: `--c:${cat.color}`,
              disabled: !inPlan(d),
              "aria-pressed": String(on),
              "aria-label": `${cat.name}, ${fmt(d)}`,
              title: `${fmt(d, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}${cat.deadline === d ? " · deadline" : ""}`,
              "data-m": i === 0 || dt.getDate() === 1 ? dt.toLocaleDateString("en-GB", { month: "short" }) : null,
              onclick: () => { toggleTick(plan, cat.id, d); renderBody(); }
            }, String(dt.getDate()));
          })));
      });

      const pct = applicable && plan.categories.length ? Math.round((doneAll / (applicable * plan.categories.length)) * 100) : 0;
      const deadlines = plan.categories.filter((c) => c.deadline && c.deadline >= start && c.deadline <= end)
        .sort((a, b) => a.deadline.localeCompare(b.deadline));
      const todos = state.todos.filter((t) => !t.done && t.due && t.due >= start && t.due <= end)
        .sort((a, b) => a.due.localeCompare(b.due));

      body.replaceChildren(
        h("section", { class: "stats-grid" },
          statCard("calendar", "Window", `${n} days`, `${fmt(start, SHORT)} – ${fmt(end, SHORT)}`),
          statCard("trend", "Progress in window", `${pct}%`, `${doneAll}/${applicable * plan.categories.length} ticks`, pct),
          statCard("layers", "Plan days in window", `${applicable}/${n}`, planStatus(plan).label),
          statCard("flag", "Deadlines", String(deadlines.length), "task deadlines in this window")),
        plan.categories.length
          ? h("div", { class: "task-rows" }, rows)
          : emptyState("This plan has no tasks", "Add tasks in Plan Timelines to see them here.", "Add tasks", () => (location.hash = "#/plans")),
        h("div", { class: "split" },
          h("section", { class: "card panel" }, h("h2", { text: "Deadlines in this window" }),
            deadlines.length
              ? h("ul", { class: "mini-list" }, deadlines.map((c) =>
                h("li", {}, h("span", { class: "dot", style: `background:${c.color}` }), h("span", { class: "grow", text: c.name }),
                  h("span", { class: "muted small", text: fmt(c.deadline, SHORT) }), deadlineBadge(plan, c))))
              : h("p", { class: "muted small", text: "No task deadlines fall in this window." })),
          h("section", { class: "card panel" }, h("h2", { text: "To-dos due in this window" }),
            todos.length
              ? h("ul", { class: "mini-list" }, todos.map((t) =>
                h("li", {}, h("span", { class: "prio " + t.priority, title: t.priority + " priority" }), h("span", { class: "grow", text: t.text }),
                  h("span", { class: "muted small", text: fmt(t.due, SHORT) }))))
              : h("p", { class: "muted small", text: "Nothing due in this window." }))));
    }

    root.append(
      h("div", { class: "toolbar card" }, h("label", { class: "field inline" }, "Plan", planSel), tabs, customWrap, h("label", { class: "field inline" }, "Window", anchorSel)),
      body);
    renderTabs();
    renderBody();
  }

  // ---------- compact widget (popup page or always-on-top floating window) ----------
  const PRIO_RANK = { high: 0, medium: 1, low: 2 };

  function wheelBox(plan) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Radial progress chart");
    const container = h("div", { class: "radial-container w-wheel" }, svg,
      h("div", { class: "center-label" },
        h("div", { class: "center-title", text: plan.title }),
        h("div", { class: "center-sub", text: "STARTING FROM" }),
        h("div", { class: "center-date", text: fmt(plan.startDate, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() })));
    drawChart(plan, svg, container, (catId, iso) => toggleTick(plan, catId, iso), true);
    return container;
  }

  function renderWidget(box) {
    if (!box.isConnected) return widgetRoots.delete(box);
    const ae = box.ownerDocument.activeElement;
    if (ae && ae.tagName === "INPUT" && box.contains(ae) && ae.value) return; // don't wipe a half-typed to-do
    const plan = activePlan();
    const t = todayISO();

    const head = h("div", { class: "w-head" },
      h("strong", { class: "w-title", text: "Action Plan" }),
      state.plans.length > 1
        ? h("select", {
          class: "input input-sm w-select", "aria-label": "Plan",
          onchange: (e) => { state.activePlanId = e.target.value; save(); }
        }, state.plans.map((p) => h("option", { value: p.id, selected: p.id === plan.id }, p.name)))
        : null,
      h("a", { class: "icon-btn", href: location.href.split("#")[0], target: "_blank", rel: "noopener", title: "Open dashboard", "aria-label": "Open dashboard" }, icon("overview", 16)));

    let planCard;
    if (!plan) {
      planCard = h("section", { class: "w-card" }, h("p", { class: "muted small", text: "No plans yet. Create one in the dashboard." }));
    } else {
      const st = planStatus(plan);
      const pr = planProgress(plan);
      const running = t >= plan.startDate && t <= planEnd(plan);
      let today;
      if (!plan.categories.length) today = h("p", { class: "muted small", text: "No tasks in this plan yet." });
      else if (!running) today = h("p", { class: "muted small", text: "This plan isn't running today." });
      else {
        today = h("ul", { class: "w-list" }, plan.categories.map((cat) => {
          const on = !!(plan.ticks[cat.id] && plan.ticks[cat.id][t]);
          return h("li", {}, h("button", {
            class: "w-item" + (on ? " done" : ""), type: "button", "aria-pressed": String(on),
            title: on ? "Untick for today" : "Tick for today",
            onclick: () => { toggleTick(plan, cat.id, t); }
          }, h("span", { class: "check" + (on ? " on" : "") }, on ? icon("check", 12) : null),
          h("span", { class: "dot", style: `background:${cat.color}` }),
          h("span", { class: "w-name", text: cat.name }),
          deadlineBadge(plan, cat)));
        }));
      }
      planCard = h("section", { class: "w-card" },
        h("div", { class: "w-row" }, h("strong", { text: plan.name }), h("span", { class: "badge " + st.key, text: st.label })),
        h("div", { class: "w-big" }, `${pr.pct}%`, h("span", { class: "muted small", text: ` ${pr.done}/${pr.total} ticks` })),
        bar(pr.pct),
        wheelBox(plan),
        h("h3", { class: "w-sub", text: "Today" }),
        today);
    }

    const open = state.todos.filter((x) => !x.done)
      .sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || (a.due || "9999").localeCompare(b.due || "9999"));
    const input = h("input", { class: "input input-sm grow", type: "text", placeholder: "Quick add a to-do", maxlength: "200", "aria-label": "Quick add a to-do" });
    const todoCard = h("section", { class: "w-card" },
      h("div", { class: "w-row" }, h("h3", { class: "w-sub", text: "To-dos" }), h("span", { class: "muted small", text: `${open.length} open` })),
      open.length
        ? h("ul", { class: "w-list" }, open.slice(0, 7).map((x) => {
          const late = x.due && x.due < t;
          return h("li", {}, h("button", {
            class: "w-item", type: "button", title: "Mark as done",
            onclick: () => { x.done = true; save(); }
          }, h("span", { class: "check" }),
          h("span", { class: "prio " + x.priority, title: x.priority + " priority" }),
          h("span", { class: "w-name", text: x.text, title: x.text }),
          x.due ? h("span", { class: "badge " + (late ? "late" : x.due === t ? "soon" : "neutral"), text: x.due === t ? "Today" : fmt(x.due, SHORT) }) : null));
        }))
        : h("p", { class: "muted small", text: "Nothing pending. Nice work." }),
      open.length > 7 ? h("p", { class: "muted small", text: `+${open.length - 7} more in the dashboard` }) : null,
      h("form", {
        class: "row-form", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (!v) return;
          state.todos.push({ id: uid(), text: v, priority: "medium", due: "", done: false, created: Date.now() });
          input.value = "";
          save();
        }
      }, input, h("button", { class: "btn btn-primary btn-sm", type: "submit", "aria-label": "Add to-do" }, icon("plus", 14))));

    box.replaceChildren(head, planCard, todoCard);
  }

  function pageWidget(root) {
    const box = h("div", { class: "widget" });
    root.append(box);
    widgetRoots.add(box);
    renderWidget(box);
  }

  // Default: a normal small window that stays behind other apps (visible on the desktop).
  // onTop: an always-on-top floating window where the browser supports it.
  async function openWidget(onTop) {
    if (onTop && !window.documentPictureInPicture) toast("Your browser can't float windows on top. Opened as a normal window instead.", "error");
    if (onTop && window.documentPictureInPicture) {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 760 });
        pip.document.head.append(
          h("link", { rel: "stylesheet", href: new URL("styles.css?v=5", location.href).href }),
          h("title", { text: "Action Plan widget" }));
        pip.document.body.className = "widget-mode pip";
        const box = h("div", { class: "widget" });
        pip.document.body.append(box);
        widgetRoots.add(box);
        renderWidget(box);
        pip.addEventListener("pagehide", () => widgetRoots.delete(box));
        return;
      } catch (err) {
        console.warn("Floating window unavailable, falling back to a pop-up.", err);
      }
    }
    const w = window.open(location.href.split("#")[0] + "#/widget", "radialWidget", "popup=yes,width=400,height=780");
    if (!w) toast("Allow pop-ups for this page to open the widget.", "error");
  }

  // ---------- shell: routing, sidebar, import / export ----------
  const ctx = {
    state, save, h, icon, bar, toast, uid, todayISO, diffDays, fmt, SHORT, emptyState, statCard, clamp, isISO, parseISO
  };

  const routes = [
    { id: "overview", label: "Overview", sub: "Your radial tracker, stats and active plans", icon: "overview", render: pageOverview },
    { id: "plans", label: "Plan Timelines", sub: "Independent plans with their own tasks and deadlines", icon: "plans", render: pagePlans },
    { id: "windows", label: "7/30/90-Day Plans", sub: "Zoom into the next 7, 30, 90 or custom days", icon: "calendar", render: pageWindows },
    { id: "todo", label: "To-Do List", sub: "Capture, prioritise and finish tasks", icon: "todo", render: (r) => window.Pages.todo(r, ctx) },
    { id: "manifest", label: "Manifestation", sub: "Vision, daily affirmations and actionable goals", icon: "manifest", render: (r) => window.Pages.manifest(r, ctx) },
    { id: "notes", label: "Important Notes", sub: "Pin, edit and keep what matters", icon: "notes", render: (r) => window.Pages.notes(r, ctx) },
    { id: "widget", label: "Widget", sub: "Compact view", icon: "overview", render: pageWidget, hidden: true }
  ];

  const appEl = $("app");
  const view = $("view");
  const nav = $("nav");

  function currentRoute() {
    const id = location.hash.replace(/^#\/?/, "");
    return routes.some((r) => r.id === id) ? id : "overview";
  }

  function render() {
    hideTooltip();
    const id = currentRoute();
    const r = routes.find((x) => x.id === id);
    nav.querySelectorAll(".nav-link").forEach((a) => {
      const on = a.dataset.route === id;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("pageTitle").textContent = r.label;
    $("pageSub").textContent = r.sub;
    $("topDate").textContent = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    document.title = `${r.label} · Radial Action Plan`;
    document.body.classList.toggle("widget-mode", id === "widget");
    const page = h("div", { class: "page page-" + id });
    view.replaceChildren(page);
    view.scrollTop = 0;
    setNavOpen(false);
    try {
      r.render(page);
    } catch (err) {
      console.error(err);
      page.replaceChildren(emptyState("Something went wrong", "This page failed to load. Reload the page, or restore from a JSON backup."));
    }
  }

  function setNavOpen(open) {
    appEl.classList.toggle("nav-open", open);
    $("menuBtn").setAttribute("aria-expanded", String(open));
  }

  function applySidebar() {
    appEl.classList.toggle("collapsed", !!state.ui.collapsed);
    collapseBtn.setAttribute("aria-expanded", String(!state.ui.collapsed));
    collapseBtn.title = state.ui.collapsed ? "Expand menu" : "Collapse menu";
  }

  function navButton(ico, label, onclick) {
    return h("button", { class: "nav-link nav-btn", type: "button", title: label, onclick }, icon(ico), h("span", { class: "label", text: label }));
  }

  function exportData() {
    const payload = { app: "radial-task-tracker", version: 2, exportedAt: new Date().toISOString(), data: state };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = h("a", { href: url, download: `radial-tracker-backup-${todayISO()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup downloaded");
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast("Could not read that file.", "error");
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        const raw = isObj(obj) && isObj(obj.data) ? obj.data : obj;
        const next = isObj(raw) && !raw.plans && raw.categories && raw.startDate ? migrateLegacy(raw) : sanitize(raw);
        if (!confirm(`Import ${next.plans.length} plan(s), ${next.todos.length} to-do(s) and ${next.notes.length} note(s)? This replaces all current data in this browser.`)) return;
        replaceState(next);
        applySidebar();
        render();
        toast("Data imported");
      } catch (e) {
        toast(e instanceof SyntaxError ? "That file is not valid JSON." : e.message, "error");
      }
    };
    reader.readAsText(file);
  }

  const importFile = $("importFile");
  importFile.addEventListener("change", () => {
    importData(importFile.files[0]);
    importFile.value = "";
  });

  nav.append(...routes.filter((r) => !r.hidden).map((r) =>
    h("a", { class: "nav-link", href: "#/" + r.id, title: r.label, "data-route": r.id }, icon(r.icon), h("span", { class: "label", text: r.label }))));
  const collapseBtn = navButton("collapse", "Collapse menu", () => {
    state.ui.collapsed = !state.ui.collapsed;
    save();
    applySidebar();
  });
  collapseBtn.classList.add("collapse-btn");
  $("sidebarFoot").append(
    navButton("layers", "Desktop widget", () => openWidget(false)),
    navButton("pin", "Widget always on top", () => openWidget(true)),
    navButton("download", "Export JSON", exportData),
    navButton("upload", "Import JSON", () => importFile.click()),
    collapseBtn);
  $("menuBtn").append(icon("menu", 22));
  $("menuBtn").addEventListener("click", () => setNavOpen(!appEl.classList.contains("nav-open")));
  $("scrim").addEventListener("click", () => setNavOpen(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && setNavOpen(false));
  window.addEventListener("hashchange", render);
  // keep every open window (dashboard, pop-up widget, other tabs) in sync
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      setState(sanitize(JSON.parse(e.newValue)));
    } catch {
      return;
    }
    applySidebar();
    widgetRoots.forEach(renderWidget);
    const a = document.activeElement;
    if (currentRoute() !== "widget" && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render();
  });

  applySidebar();
  save();
  render();
  // enable transitions only after the first paint so a saved collapsed state doesn't animate on load
  requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.remove("no-anim")));
})();
