/* Study Planner: schedule preview/editing (list + calendar, drag & drop), tracking views, rescheduling. */
window.StudyPlan = (() => {
  "use strict";

  const KIND_LABEL = { learn: "Learn", practice: "Practice", revision: "Revise", custom: "Custom" };
  const SLOT_LABEL = { morning: "morning", afternoon: "afternoon", evening: "evening" };
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const pad = (n) => String(n).padStart(2, "0");
  const monthOf = (iso) => iso.slice(0, 7);
  const shiftMonth = (m, d) => {
    const [y, mo] = m.split("-").map(Number);
    const dt = new Date(y, mo - 1 + d, 1);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
  };

  // ---------- session row ----------
  function sessionRow(core, p, s, o) {
    const { ctx, PL, hhmm, unitColor, unitName } = core;
    const { h, icon, toast, fmt } = ctx;
    const edit = o.edit;
    const warn = () => {
      const issues = PL.validateSchedule(p.schedule.sessions, p.config, ctx.todayISO()).filter((i) => i.date === s.date);
      if (issues.length) toast(issues[0].message, "error");
    };
    const after = (check) => { ctx.save(); if (check) warn(); o.redraw(); };
    const subs = s.subtasks.length ? h("ul", { class: "subtasks" }, s.subtasks.map((x, i) =>
      h("li", {}, o.track
        ? h("label", { class: "check-label small" }, h("input", { type: "checkbox", checked: x.done, onchange: () => { core.toggleSubtask(p, s, i); o.redraw(); } }), h("span", { class: x.done ? "struck" : "", text: x.text }))
        : h("span", { class: "small muted", text: "· " + x.text })))) : null;
    const row = h("li", {
      class: `sess ${s.kind}${s.done ? " done" : ""}${o.late ? " late" : ""}${s.overflow ? " overflow" : ""}`,
      draggable: !!edit,
      ondragstart: (e) => { if (!edit) return; o.drag.id = s.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.id); row.classList.add("dragging"); },
      ondragend: () => row.classList.remove("dragging"),
      ondragover: (e) => { if (edit && o.drag.id && o.drag.id !== s.id) e.preventDefault(); },
      ondrop: (e) => {
        if (!edit || !o.drag.id) return;
        e.preventDefault();
        e.stopPropagation();
        const src = p.schedule.sessions.find((x) => x.id === o.drag.id);
        o.drag.id = "";
        if (!src || src === s) return;
        src.date = s.date;
        src.seq = s.seq - 0.001;
        core.moveSession(p, src, s.date);
        after(true);
      }
    },
    h("div", { class: "sess-main" },
      o.track ? h("input", { class: "sess-check", type: "checkbox", checked: s.done, "aria-label": `Mark ${s.title} done`, onchange: (e) => { core.setSessionDone(p, s, e.target.checked); o.redraw(); } }) : (edit ? h("span", { class: "grip", "aria-hidden": "true", title: "Drag to another day", text: "⋮⋮" }) : null),
      h("span", { class: "dot", style: `background:${unitColor(p, s.unitId)}`, title: unitName(p, s.unitId) }),
      h("div", { class: "sess-body" },
        h("div", { class: "sess-title" }, h("strong", { class: s.done ? "struck" : "", text: s.title }),
          h("span", { class: `badge k-${s.kind}`, text: KIND_LABEL[s.kind] }),
          s.part ? h("span", { class: "badge neutral", text: `part ${s.part}` }) : null,
          SLOT_LABEL[s.slot] ? h("span", { class: "badge neutral", text: SLOT_LABEL[s.slot] }) : null,
          s.locked ? h("span", { class: "badge soon", title: "Date locked", text: "locked" }) : null,
          s.overflow ? h("span", { class: "badge late", title: "Did not fit before the deadline", text: "doesn't fit" }) : null,
          o.late ? h("span", { class: "badge late", text: "missed" }) : null),
        h("div", { class: "muted small", text: `${unitName(p, s.unitId)}${o.showDate ? ` · ${fmt(s.date, { weekday: "short", day: "numeric", month: "short" })}` : ""}` }),
        subs),
      !edit ? h("span", { class: "badge neutral hrs", text: hhmm(s.hours) }) : null),
    edit ? h("div", { class: "sess-edit" },
      h("label", { class: "field inline small" }, "Hours", h("input", { class: "input input-sm num", type: "number", min: "0.25", max: "16", step: "0.25", value: s.hours, onchange: (e) => { const v = Number(e.target.value); if (v >= 0.25 && v <= 16) s.hours = Math.round(v * 4) / 4; else e.target.value = s.hours; after(true); } })),
      h("label", { class: "field inline small" }, "Day", h("input", { class: "input input-sm", type: "date", value: s.date, onchange: (e) => { if (ctx.isISO(e.target.value)) { core.moveSession(p, s, e.target.value); after(true); } else e.target.value = s.date; } })),
      h("button", { class: "icon-btn" + (s.locked ? " on" : ""), type: "button", "aria-pressed": String(s.locked), title: s.locked ? "Unlock date (regenerate may move it)" : "Lock this date (kept when you regenerate or reschedule)", "aria-label": "Lock date", onclick: () => { s.locked = !s.locked; after(false); } }, icon("lock", 15)),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Move earlier in the day", title: "Earlier in the day", onclick: () => nudge(p, s, -1, o, after) }, "↑"),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Move later in the day", title: "Later in the day", onclick: () => nudge(p, s, 1, o, after) }, "↓"),
      h("button", { class: "icon-btn danger", type: "button", "aria-label": `Remove ${s.title}`, title: "Remove this session", onclick: () => { core.removeSession(p, s); after(false); } }, icon("trash", 15))) : null);
    return row;
  }

  function nudge(p, s, dir, o, after) {
    const day = p.schedule.sessions.filter((x) => x.date === s.date).sort((a, b) => a.seq - b.seq);
    const i = day.indexOf(s);
    const j = i + dir;
    if (j < 0 || j >= day.length) return;
    const t = day[j].seq;
    day[j].seq = s.seq;
    s.seq = t;
    after(false);
  }

  // ---------- add custom session ----------
  function addForm(core, p, getDate, redraw) {
    const { ctx } = core;
    const { h, icon, toast } = ctx;
    const title = h("input", { class: "input input-sm grow", type: "text", maxlength: "120", placeholder: "Add your own session (e.g. Mock test)", "aria-label": "Custom session title" });
    const hrs = h("input", { class: "input input-sm num", type: "number", min: "0.25", max: "16", step: "0.25", value: "1", "aria-label": "Hours" });
    const unit = h("select", { class: "input input-sm", "aria-label": "Unit" }, p.syllabus.units.map((u) => h("option", { value: u.id }, u.name)));
    return h("form", {
      class: "row-form add-session", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const t = title.value.trim();
        const date = getDate();
        if (!t) return toast("Name the session first.", "error");
        if (!ctx.isISO(date)) return toast("Pick a day first.", "error");
        const maxSeq = Math.max(0, ...p.schedule.sessions.map((s) => s.seq)) + 1;
        p.schedule.sessions.push({ id: ctx.uid(), date, kind: "custom", topicId: "", unitId: unit.value, title: t, part: "", hours: Math.min(16, Math.max(0.25, Math.round((Number(hrs.value) || 1) * 4) / 4)), seq: maxSeq, tail: false, scope: "", slot: "any", subtasks: [], done: false, locked: true, overflow: false });
        title.value = "";
        if (core.isActive(p)) core.syncRadial(p);
        ctx.save();
        redraw();
      }
    }, title, unit, hrs, h("button", { class: "btn btn-ghost btn-sm", type: "submit" }, icon("plus", 14), "Add"));
  }

  // ---------- schedule list + calendar ----------
  function scheduleView(core, p, o) {
    const { ctx, PL, view } = core;
    const { h, icon, todayISO } = ctx;
    const today = todayISO();
    const drag = { id: "" };
    const box = h("div", { class: "sched" });
    const sel = { day: "" };
    const draw = () => {
      const edit = o.edit();
      const sessions = p.schedule.sessions;
      const issues = PL.validateSchedule(sessions, p.config, today);
      const bad = new Map();
      issues.forEach((i) => bad.set(i.date, (bad.get(i.date) || []).concat(i.message)));
      const mode = view.sched || "list";
      const tabs = h("div", { class: "row-between" },
        h("div", { class: "seg", role: "tablist" }, [["list", "List"], ["calendar", "Calendar"]].map(([k, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(mode === k), class: "seg-btn" + (mode === k ? " active" : ""), onclick: () => { view.sched = k; draw(); } }, l))),
        edit ? h("span", { class: "muted small", text: "Drag sessions onto another day, or use the day and hour fields." }) : null);
      const kids = [tabs];
      if (issues.length && edit) kids.push(h("div", { class: "alert warn" }, icon("alert", 18), h("div", {}, h("strong", { text: `${issues.length} thing(s) to check after your edits` }), h("ul", { class: "small" }, issues.slice(0, 5).map((i) => h("li", { text: i.message }))))));
      const redraw = () => { draw(); if (o.onChange) o.onChange(); };
      const rowOpts = (s) => ({ edit, track: o.track, redraw, drag, late: o.track && !s.done && s.date < today, showDate: false });
      if (mode === "list") kids.push(listView(core, p, rowOpts, drag, redraw, edit, bad));
      else kids.push(calendarView(core, p, sel, drag, redraw, edit, bad, rowOpts));
      if (edit) kids.push(addForm(core, p, () => (mode === "calendar" ? sel.day : sel.day || today), redraw));
      box.replaceChildren(...kids);
    };
    draw();
    return box;
  }

  function dayHead(core, p, date, bad) {
    const { ctx, hhmm } = core;
    const { h, fmt } = ctx;
    const load = core.PL.dayLoad(p.schedule.sessions, date);
    return h("div", { class: "day-head" }, h("strong", { text: fmt(date, { weekday: "short", day: "numeric", month: "short" }) }),
      h("span", { class: "muted small", text: hhmm(load) }),
      bad.has(date) ? h("span", { class: "badge late", title: bad.get(date).join(" "), text: "check" }) : null,
      date === ctx.todayISO() ? h("span", { class: "badge active", text: "today" }) : null);
  }

  function listView(core, p, rowOpts, drag, redraw, edit, bad) {
    const { ctx } = core;
    const { h, fmt } = ctx;
    const byDate = new Map();
    p.schedule.sessions.forEach((s) => byDate.set(s.date, (byDate.get(s.date) || []).concat(s)));
    const dates = [...byDate.keys()].sort();
    if (!dates.length) return h("p", { class: "muted pad", text: "No sessions yet." });
    const weeks = new Map();
    dates.forEach((d) => {
      const dt = ctx.parseISO(d);
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
      const k = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
      weeks.set(k, (weeks.get(k) || []).concat(d));
    });
    const today = ctx.todayISO();
    let n = 0;
    return h("div", { class: "weeks" }, [...weeks.entries()].map(([monday, ds]) => {
      n++;
      const total = ds.reduce((a, d) => a + byDate.get(d).reduce((x, s) => x + s.hours, 0), 0);
      const done = ds.reduce((a, d) => a + byDate.get(d).filter((s) => s.done).reduce((x, s) => x + s.hours, 0), 0);
      const open = n <= 2 || ds.includes(today) || ds.some((d) => bad.has(d));
      return h("details", { class: "week card", open }, h("summary", {}, h("strong", { text: `Week of ${fmt(monday, { day: "numeric", month: "short" })}` }), h("span", { class: "muted small", text: ` · ${ds.length} day(s) · ${core.hhmm(Math.round(total * 4) / 4)}${done ? ` · ${core.hhmm(Math.round(done * 4) / 4)} done` : ""}` })),
        ds.map((d) => h("section", {
          class: "day", "data-date": d,
          ondragover: (e) => { if (edit && drag.id) { e.preventDefault(); } },
          ondrop: (e) => { if (!edit || !drag.id) return; e.preventDefault(); const s = p.schedule.sessions.find((x) => x.id === drag.id); drag.id = ""; if (s) { core.moveSession(p, s, d); ctx.save(); redraw(); } }
        }, dayHead(core, p, d, bad), h("ul", { class: "sess-list" }, byDate.get(d).sort((a, b) => a.seq - b.seq).map((s) => sessionRow(core, p, s, rowOpts(s)))))));
    }));
  }

  function calendarView(core, p, sel, drag, redraw, edit, bad, rowOpts) {
    const { ctx, view, PL } = core;
    const { h, icon, todayISO } = ctx;
    const today = todayISO();
    const dates = p.schedule.sessions.map((s) => s.date).sort();
    const first = dates[0] || today;
    const last = PL.resolveEnd(p.config);
    if (!view.month) view.month = today >= first && today <= last ? monthOf(today) : monthOf(first);
    const [y, mo] = view.month.split("-").map(Number);
    const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
    const dim = new Date(y, mo, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("div", { class: "cal-cell blank" }));
    for (let d = 1; d <= dim; d++) {
      const date = `${y}-${pad(mo)}-${pad(d)}`;
      const ss = core.sessionsOn(p, date);
      const total = ss.reduce((a, s) => a + s.hours, 0);
      const inRange = date >= (p.config.startDate < first ? p.config.startDate : first) && date <= last;
      cells.push(h("button", {
        type: "button",
        class: `cal-cell${date === today ? " today" : ""}${sel.day === date ? " sel" : ""}${!inRange ? " out" : ""}${bad.has(date) ? " bad" : ""}${date === last ? " deadline" : ""}`,
        "aria-label": `${date}: ${ss.length} session(s)`,
        onclick: () => { sel.day = date; redraw(); },
        ondragover: (e) => { if (edit && drag.id) e.preventDefault(); },
        ondrop: (e) => { if (!edit || !drag.id) return; e.preventDefault(); const s = p.schedule.sessions.find((x) => x.id === drag.id); drag.id = ""; if (s) { core.moveSession(p, s, date); sel.day = date; ctx.save(); redraw(); } }
      },
      h("span", { class: "cal-num" }, String(d), date === last ? icon("flag", 11) : null),
      total ? h("span", { class: "cal-hrs", text: core.hhmm(Math.round(total * 4) / 4) }) : null,
      h("span", { class: "cal-chips" }, ss.slice(0, 3).map((s) => h("span", {
        class: `chip-s${s.done ? " done" : ""}`, style: `border-color:${core.unitColor(p, s.unitId)}`, title: s.title, draggable: !!edit,
        ondragstart: (e) => { drag.id = s.id; e.dataTransfer.setData("text/plain", s.id); e.dataTransfer.effectAllowed = "move"; }
      }, s.title)), ss.length > 3 ? h("span", { class: "more", text: `+${ss.length - 3}` }) : null)));
    }
    const detailDate = sel.day && monthOf(sel.day) === view.month ? sel.day : "";
    const detail = detailDate
      ? h("div", { class: "card panel day-detail" }, dayHead(core, p, detailDate, bad),
        core.sessionsOn(p, detailDate).length ? h("ul", { class: "sess-list" }, core.sessionsOn(p, detailDate).map((s) => sessionRow(core, p, s, rowOpts(s)))) : h("p", { class: "muted small", text: "Nothing planned. " + (edit ? "Drop a session here or add one below." : "") }))
      : h("p", { class: "muted small", text: "Select a day to see and edit its sessions." });
    return h("div", { class: "cal" },
      h("div", { class: "cal-head" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Previous month", onclick: () => { view.month = shiftMonth(view.month, -1); redraw(); } }, "‹"),
        h("strong", { text: new Date(y, mo - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) }),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Next month", onclick: () => { view.month = shiftMonth(view.month, 1); redraw(); } }, "›"),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { view.month = monthOf(today); sel.day = today; redraw(); } }, "Today")),
      h("div", { class: "cal-grid", role: "grid" }, WD.map((d) => h("div", { class: "cal-dow", text: d })), cells),
      detail);
  }

  // ---------- conflict banner ----------
  function conflictBanner(core, p, conflict, apply) {
    const { ctx } = core;
    const { h, icon } = ctx;
    return h("div", { class: "alert warn conflict", role: "alert" }, icon("alert", 20),
      h("div", {},
        h("strong", { text: "This plan doesn't fully fit" }),
        h("p", { class: "small", text: conflict.message }),
        conflict.alternatives && conflict.alternatives.length
          ? h("div", { class: "alts" }, h("p", { class: "small muted", text: "Options (each one has been checked to fit):" }), conflict.alternatives.map((a) => h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => apply(a) }, a.label)))
          : h("p", { class: "small", text: "No automatic fix found. Increase study hours, move the deadline, or drop topics in the review step." })));
  }

  function applyAlt(core, p, alt, regenerate) {
    const patch = { ...alt.patch };
    if (patch.excludeTopicIds) {
      const ex = new Set(patch.excludeTopicIds);
      p.syllabus.units.forEach((u) => u.topics.forEach((t) => { if (ex.has(t.id)) t.excluded = true; }));
      delete patch.excludeTopicIds;
    }
    p.config = core.PL.sanitizeConfig({ ...p.config, ...patch }, core.ctx.todayISO());
    regenerate();
  }

  // ---------- preview (before approval) ----------
  function preview(core, p) {
    const { ctx, PL, view, hhmm } = core;
    const { h, icon, toast, fmt, bar } = ctx;
    const sc = p.schedule;
    const st = sc.stats || {};
    const regen = () => {
      const r = core.generate(p, { keepDone: !!view.replan });
      if (r.errors && r.errors.length) { toast(r.errors[0], "error"); return; }
      ctx.save();
      core.rerender();
      toast("Plan regenerated with your settings");
    };
    const stat = (label, value, sub) => h("div", { class: "pstat" }, h("div", { class: "stat-label", text: label }), h("div", { class: "stat-value", text: value }), h("div", { class: "stat-sub", text: sub || "" }));
    const pct = st.capacity ? Math.min(100, Math.round((st.required / st.capacity) * 100)) : 0;
    const unscheduled = sc.sessions.filter((s) => s.overflow);
    const kids = [
      h("section", { class: "card form-card" },
        h("div", { class: "row-between" }, h("h2", { text: "Preview your plan" }), h("span", { class: "badge soon", text: "Not saved to your tracker yet" })),
        h("p", { class: "muted small", text: "Check the schedule, edit anything, regenerate with different settings, then approve. Approving adds a timeline, progress rings and study tasks to your tracker." }),
        h("div", { class: "pstats" },
          stat("Topics", String(st.topics || 0), st.completedTopics ? `${st.completedTopics} already done` : ""),
          stat("Study days", String(st.studyDays || 0), `${fmt(p.config.startDate, ctx.SHORT)} → ${fmt(PL.resolveEnd(p.config), ctx.SHORT)}`),
          stat("Time needed", hhmm(st.required || 0), `${hhmm(st.capacity || 0)} available`),
          stat("Learning ends", st.lastLearnDate ? fmt(st.lastLearnDate, ctx.SHORT) : "-", st.spare ? `${hhmm(st.spare)} spare` : "")),
        bar(pct, sc.conflict ? "#d12f4f" : undefined)),
    ];
    if (sc.conflict) kids.push(conflictBanner(core, p, sc.conflict, (alt) => applyAlt(core, p, alt, regen)));
    if (unscheduled.length) kids.push(h("div", { class: "card panel" }, h("h2", { text: "Not scheduled" }), h("ul", { class: "mini-list" }, unscheduled.slice(0, 12).map((s) => h("li", { class: "small", text: `${s.title} · ${hhmm(s.hours)}` })))));
    if (sc.assumptions.length || sc.warnings.length) kids.push(h("details", { class: "card panel assumptions", open: sc.assumptions.length < 5 }, h("summary", { text: "Assumptions and notes" }),
      h("ul", { class: "note-list" }, [...sc.warnings.map((w) => h("li", { class: "warn", text: w })), ...sc.assumptions.map((a) => h("li", { text: a }))])));
    kids.push(scheduleView(core, p, { edit: () => true, track: false, onChange: () => ctx.save() }));
    kids.push(h("div", { class: "row-between sticky-actions" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => { core.setStage(p, "configure"); ctx.save(); core.rerender(); } }, "← Change settings"),
      h("div", { class: "row-form" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: regen }, icon("refresh", 16), "Regenerate"),
        h("button", {
          class: "btn btn-primary", type: "button",
          onclick: () => {
            const left = sc.sessions.filter((s) => s.overflow).reduce((a, s) => a + s.hours, 0);
            if ((sc.conflict || left) && !confirm(`${hhmm(left || (sc.conflict && sc.conflict.shortfall) || 0)} of work doesn't fit before the deadline and won't be in the plan. Approve anyway?`)) return;
            core.finish(p);
            core.syncRadial(p);
            ctx.save();
            view.tab = "today";
            view.editing = false;
            core.rerender();
            toast("Plan approved and added to your tracker");
          }
        }, icon("check", 16), "Approve & add to tracker"))));
    return h("div", { class: "study-preview" }, kids);
  }

  // ---------- tracker (approved plan) ----------
  function tracker(core, p) {
    const { ctx, PL, view, hhmm } = core;
    const { h, icon, toast, fmt, bar, todayISO } = ctx;
    const today = todayISO();
    const sessions = p.schedule.sessions;
    const pr = PL.progress(sessions, p.syllabus);
    const miss = core.missed(p);
    const content = h("div", { class: "tab-body" });

    const doReflow = () => {
      const r = core.reflow(p);
      if (r.errors && r.errors.length) return toast(r.errors[0], "error");
      core.syncRadial(p);
      ctx.save();
      core.rerender();
      toast(r.conflict ? "Rescheduled, but some work doesn't fit. See the options." : r.moved ? `Rescheduled ${r.moved} session(s)` : "Nothing needed moving");
    };
    const applyFix = (alt) => {
      const patch = { ...alt.patch };
      delete patch.excludeTopicIds;
      p.config = PL.sanitizeConfig({ ...p.config, ...patch }, today);
      doReflow();
    };

    const head = h("section", { class: "card panel track-head" },
      h("div", { class: "row-between" },
        h("div", {}, h("h2", { class: "study-h", text: p.name }), h("p", { class: "muted small", text: `${pr.pct}% done · ${hhmm(pr.doneHours)} of ${hhmm(pr.hours)} · exam ${fmt(PL.resolveEnd(p.config), ctx.SHORT)} · ${PL.progress(sessions, p.syllabus).topicsDone}/${pr.topicsTotal} topics finished` })),
        h("div", { class: "row-form" },
          miss.length ? h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: doReflow }, icon("refresh", 14), `Reschedule ${miss.length} missed`) : null,
          h("a", { class: "btn btn-ghost btn-sm", href: "#/overview", title: "See the radial wheel" }, "Radial wheel"))),
      bar(pr.pct));

    const tabs = [["today", "Today"], ["calendar", "Calendar"], ["progress", "Progress"], ["assistant", "Assistant"], ["plan", "Plan"]];
    const tabBar = h("div", { class: "seg tabbar", role: "tablist" }, tabs.map(([k, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(view.tab === k), class: "seg-btn" + (view.tab === k ? " active" : ""), onclick: () => { view.tab = k; core.rerender(); } }, l)));

    const kids = [head];
    if (p.schedule.conflict) kids.push(conflictBanner(core, p, p.schedule.conflict, applyFix));
    kids.push(tabBar, content);

    if (view.tab === "today") content.append(todayTab(core, p, miss, doReflow));
    else if (view.tab === "calendar") {
      content.append(h("div", { class: "row-between" }, h("p", { class: "muted small", text: "Click a day to tick sessions off. Turn on editing to drag, lock or change sessions." }),
        h("label", { class: "check-label" }, h("input", { type: "checkbox", checked: view.editing, onchange: (e) => { view.editing = e.target.checked; core.rerender(); } }), "Edit schedule")),
      scheduleView(core, p, { edit: () => view.editing, track: true, onChange: () => { core.syncRadial(p); ctx.save(); } }));
    } else if (view.tab === "progress") content.append(progressTab(core, p, pr));
    else if (view.tab === "assistant") content.append(window.StudyChat.render(core, p));
    else content.append(planTab(core, p, doReflow));
    return h("div", { class: "study-track" }, kids);
  }

  function todayTab(core, p, miss, doReflow) {
    const { ctx, PL, hhmm } = core;
    const { h, icon, toast, todayISO, fmt } = ctx;
    const today = todayISO();
    const box = h("div", { class: "today-tab" });
    const draw = () => {
      const sessions = p.schedule.sessions;
      const todays = core.sessionsOn(p, today);
      const missed = core.missed(p).sort((a, b) => (a.date < b.date ? -1 : 1));
      const next = sessions.filter((s) => !s.done && s.date > today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
      const nextDate = next.length ? next[0].date : "";
      const rowOpts = (s) => ({ edit: false, track: true, redraw: draw, drag: {}, late: s.date < today, showDate: s.date !== today });
      const parts = [];
      if (missed.length) parts.push(h("section", { class: "card panel missed" }, h("div", { class: "row-between" }, h("h2", { text: `Missed (${missed.length})` }), h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: doReflow }, icon("refresh", 14), "Reschedule missed")), h("ul", { class: "sess-list" }, missed.slice(0, 8).map((s) => sessionRow(core, p, s, rowOpts(s)))), missed.length > 8 ? h("p", { class: "muted small", text: `+${missed.length - 8} more` }) : null));
      const dayTotal = todays.reduce((a, s) => a + s.hours, 0);
      const dayDone = todays.filter((s) => s.done).reduce((a, s) => a + s.hours, 0);
      parts.push(h("section", { class: "card panel" }, h("div", { class: "row-between" }, h("h2", { text: "Today" }), todays.length ? h("span", { class: "muted small", text: `${hhmm(Math.round(dayDone * 4) / 4)} of ${hhmm(Math.round(dayTotal * 4) / 4)} done` }) : null),
        todays.length ? h("ul", { class: "sess-list" }, todays.map((s) => sessionRow(core, p, s, rowOpts(s)))) : h("p", { class: "muted", text: today > PL.resolveEnd(p.config) ? "Your plan has ended." : today < p.config.startDate ? `Your plan starts on ${fmt(p.config.startDate)}.` : "No study session today. Rest, or pull something forward from the next days." })));
      if (nextDate) {
        const upcoming = next.filter((s) => s.date <= core.ctx.toISOAdd(nextDate, 3)).slice(0, 10);
        parts.push(h("section", { class: "card panel" }, h("h2", { text: "Coming up" }), h("ul", { class: "sess-list" }, upcoming.map((s) => sessionRow(core, p, s, rowOpts(s))))));
      }
      parts.push(h("div", { class: "row-form" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { const n = core.pushTodos(p, 7); ctx.save(); toast(n ? `Added ${n} session(s) to your To-Do list` : "The next 7 days are already in your To-Do list"); } }, icon("todo", 14), "Add next 7 days to To-Do"),
        h("span", { class: "muted small", text: "Ticking a to-do there also ticks the session here." })));
      box.replaceChildren(...parts);
    };
    draw();
    return box;
  }

  function progressTab(core, p, pr) {
    const { ctx, hhmm } = core;
    const { h, bar, fmt, todayISO } = ctx;
    const today = todayISO();
    const sessions = p.schedule.sessions.filter((s) => !s.overflow);
    const planned = sessions.filter((s) => s.date <= today).reduce((a, s) => a + s.hours, 0);
    const done = sessions.filter((s) => s.done).reduce((a, s) => a + s.hours, 0);
    const delta = Math.round((done - planned) * 4) / 4;
    const status = !planned ? "Not started yet" : delta >= -0.25 ? (delta > 0.25 ? `${hhmm(delta)} ahead of schedule` : "On track") : `${hhmm(-delta)} behind schedule`;
    const weeks = new Map();
    sessions.forEach((s) => {
      const dt = ctx.parseISO(s.date);
      dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
      const k = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      const w = weeks.get(k) || { plan: 0, done: 0 };
      w.plan += s.hours;
      if (s.done) w.done += s.hours;
      weeks.set(k, w);
    });
    const maxW = Math.max(1, ...[...weeks.values()].map((w) => w.plan));
    const finalRev = sessions.find((s) => s.scope === "final");
    return h("div", { class: "progress-tab" },
      h("section", { class: "card panel" }, h("h2", { text: "Pace" }),
        h("div", { class: "pace " + (delta < -0.25 ? "behind" : "ok") }, h("strong", { text: status }), h("span", { class: "muted small", text: `${hhmm(Math.round(done * 4) / 4)} done vs ${hhmm(Math.round(planned * 4) / 4)} planned up to today` })),
        finalRev ? h("p", { class: "muted small", text: `Final revision starts ${fmt(finalRev.date)}.` }) : null),
      h("section", { class: "card panel" }, h("h2", { text: "By unit" }), h("ul", { class: "unit-progress" }, pr.units.filter((u) => u.hours).map((u) =>
        h("li", {}, h("div", { class: "row-between" }, h("span", { class: "dot", style: `background:${core.unitColor(p, u.id)}` }), h("strong", { class: "grow", text: u.name }), h("span", { class: "small muted", text: `${u.pct}% · ${hhmm(u.doneHours)}/${hhmm(u.hours)}` })), bar(u.pct, core.unitColor(p, u.id)))))),
      h("section", { class: "card panel" }, h("h2", { text: "Week by week" }), h("div", { class: "weekbars" }, [...weeks.entries()].map(([k, w]) =>
        h("div", { class: "wb", title: `Week of ${k}: ${hhmm(Math.round(w.done * 4) / 4)} of ${hhmm(Math.round(w.plan * 4) / 4)}` },
          h("div", { class: "wb-bar" }, h("i", { class: "plan", style: `height:${(w.plan / maxW) * 100}%` }), h("i", { class: "done", style: `height:${(w.done / maxW) * 100}%` })),
          h("span", { class: "small muted", text: fmt(k, ctx.SHORT) }))))));
  }

  function planTab(core, p, doReflow) {
    const { ctx, PL, view } = core;
    const { h, icon, toast, fmt } = ctx;
    const c = p.config;
    const rows = [
      ["Plan window", `${fmt(c.startDate)} → ${fmt(PL.resolveEnd(c))}`],
      ["Study time", `${c.hoursPerDay}h on weekdays${c.weekendHours != null ? `, ${c.weekendHours}h on weekends` : ""}`],
      ["Strategy", { order: "Syllabus order", easy: "Easiest first", hard: "Toughest first", custom: "Custom plan" }[c.strategy]],
      ["Level", c.level], ["Practice / revision / buffer", `${c.practicePct}% / ${c.revisionPct}% / ${c.bufferPct}%`],
      ["Source", p.source === "ai" ? `AI analysis${p.aiModel ? ` (${p.aiModel})` : ""}` : "Rule-based parse (no AI)"]
    ];
    const linked = ctx.state.plans.find((x) => x.id === p.planId);
    return h("div", { class: "plan-tab" },
      h("section", { class: "card panel" }, h("h2", { text: "Plan settings" }), h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
        h("div", { class: "row-form" },
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { view.replan = true; view.replanStage = "configure"; ctx.save(); core.rerender(); } }, "Edit settings & re-plan"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: doReflow }, icon("refresh", 14), "Reschedule unfinished work"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { view.replan = true; view.replanStage = "review"; ctx.save(); core.rerender(); } }, "Edit syllabus"))),
      h("section", { class: "card panel" }, h("h2", { text: "Tracker sync" }),
        h("p", { class: "muted small", text: linked ? `Linked to the timeline "${linked.name}". Ticking sessions updates its rings.` : "The linked timeline was removed. Create it again to see this plan on the radial wheel." }),
        h("div", { class: "row-form" },
          linked ? h("a", { class: "btn btn-ghost btn-sm", href: "#/plans" }, "Open Plan Timelines") : h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { p.planId = ""; core.syncRadial(p); ctx.save(); core.rerender(); toast("Timeline created"); } }, "Recreate timeline"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { const n = core.pushTodos(p, 14); ctx.save(); toast(n ? `Added ${n} to-do(s)` : "Already added"); } }, "Add next 14 days to To-Do"))),
      p.rawText ? h("details", { class: "card panel" }, h("summary", { text: "Syllabus text" }), h("pre", { class: "raw-text", text: p.rawText.slice(0, 5000) })) : null);
  }

  return { preview, tracker };
})();
