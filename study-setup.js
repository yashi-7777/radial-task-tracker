/* Study Planner: upload, review/correct the parsed syllabus, and configure the plan (with an adaptive questionnaire). */
window.StudySetup = (() => {
  "use strict";

  const ALLOWED = ["pdf", "xlsx", "xls", "docx", "csv", "tsv", "txt", "md"];
  const LOCAL = ["txt", "md", "csv", "tsv"]; // parsed in the browser, no server needed
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  // ---------- upload ----------
  function newSyllabus(core) {
    const { ctx, SP, PL, backend, view } = core;
    const { h, icon, toast } = ctx;
    let mode = "file";
    let file = null;
    let useAi = backend.ai;
    const status = h("div", { class: "upload-status", role: "status", "aria-live": "polite" });
    const nameIn = h("input", { class: "input", type: "text", maxlength: "80", placeholder: "e.g. MBA Operations Management", "aria-label": "Syllabus name" });
    const fileIn = h("input", { type: "file", accept: ALLOWED.map((e) => "." + e).join(","), hidden: true, onchange: () => setFile(fileIn.files[0]) });
    const text = h("textarea", { class: "input paste-box", rows: "10", placeholder: "Paste your syllabus here. Units, topics and bullet lists work best.", "aria-label": "Syllabus text" });
    const fileLabel = h("span", { class: "muted small", text: "PDF, Excel (.xlsx/.xls), Word (.docx), CSV, TXT or MD · up to 10 MB" });
    const drop = h("div", {
      class: "dropzone", tabindex: "0", role: "button", "aria-label": "Choose a syllabus file",
      onclick: () => fileIn.click(),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); },
      ondragleave: () => drop.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); setFile(e.dataTransfer.files[0]); }
    }, icon("upload", 28), h("strong", { text: "Drop your syllabus here, or click to browse" }), fileLabel);
    const aiBox = h("input", { type: "checkbox", checked: useAi, disabled: !backend.ai, onchange: () => (useAi = aiBox.checked) });
    const go = h("button", { class: "btn btn-primary", type: "button", onclick: () => run() }, icon("spark", 16), "Analyse syllabus");
    const modeBtns = [["file", "Upload file"], ["text", "Paste text"]].map(([k, label]) =>
      h("button", { type: "button", class: "seg-btn" + (k === mode ? " active" : ""), onclick: () => { mode = k; refreshMode(); } }, label));

    function setFile(f) {
      if (!f) return;
      const err = checkFile(f);
      if (err) { file = null; fileLabel.textContent = "PDF, Excel (.xlsx/.xls), Word (.docx), CSV, TXT or MD · up to 10 MB"; return showError(err); }
      file = f;
      status.replaceChildren();
      fileLabel.textContent = `${f.name} · ${(f.size / 1024).toFixed(f.size > 1048576 ? 0 : 1)} KB`;
      drop.classList.add("has-file");
      if (!nameIn.value) nameIn.value = f.name.replace(/\.[^.]+$/, "").slice(0, 80);
    }

    function checkFile(f) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED.includes(ext)) {
        const hint = ext === "doc" ? " Save it as .docx or PDF." : /^(jpe?g|png|heic|gif|webp)$/.test(ext) ? " Images are not supported (no OCR). Paste the text instead." : "";
        return `.${ext || "?"} files are not supported.${hint} Use PDF, Excel, Word (.docx), CSV, TXT or MD.`;
      }
      const max = LOCAL.includes(ext) ? 2 * 1048576 : backend.maxBytes;
      if (f.size === 0) return "That file is empty.";
      if (f.size > max) return `That file is too large (${(f.size / 1048576).toFixed(1)} MB). The limit is ${Math.round(max / 1048576)} MB.`;
      return "";
    }

    function showError(msg, extra) {
      status.replaceChildren(h("div", { class: "alert error", role: "alert" }, icon("alert", 18), h("div", {}, h("strong", { text: msg }), extra || null)));
    }
    const showBusy = (msg) => status.replaceChildren(h("div", { class: "alert busy" }, h("span", { class: "spinner", "aria-hidden": "true" }), msg));

    function refreshMode() {
      modeBtns.forEach((b, i) => b.classList.toggle("active", ["file", "text"][i] === mode));
      drop.hidden = mode !== "file";
      text.hidden = mode !== "text";
    }

    async function readInput() {
      if (mode === "text") {
        const t = text.value.trim();
        if (t.length < 15) throw new Error("Paste some syllabus text first (at least a line or two).");
        if (t.length > 400000) throw new Error("That text is too long. Paste one subject at a time.");
        return { text: t, rows: null, fileName: "pasted text", warnings: [] };
      }
      if (!file) throw new Error("Choose a file first, or switch to Paste text.");
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "txt" || ext === "md") {
        const t = (await file.text()).replace(/^﻿/, "");
        if (!t.trim()) throw new Error("That file has no text.");
        return { text: t, rows: null, fileName: file.name, warnings: [] };
      }
      if (ext === "csv" || ext === "tsv") {
        const rows = SP.parseDelimited(await file.text(), ext === "tsv" ? "\t" : ",");
        return { text: null, sheets: [{ name: "Sheet1", rows }], fileName: file.name, warnings: [] };
      }
      if (!backend.ok) {
        const e = new Error(`${ext.toUpperCase()} files are read by the planner server, which is not connected.`);
        e.hint = "Connect the server (Connection settings above), or paste the text / upload a TXT or CSV version instead.";
        throw e;
      }
      showBusy(`Reading ${file.name}…`);
      const r = await core.api("/api/parse", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" }, body: file });
      return { text: r.text || null, sheets: r.sheets || null, fileName: file.name, warnings: r.warnings || [] };
    }

    async function run() {
      go.disabled = true;
      try {
        const input = await readInput();
        let parsed;
        if (input.sheets) {
          const per = input.sheets.map((s) => SP.parseRows(s.rows, { sheetName: input.sheets.length > 1 ? s.name : "", title: nameIn.value }));
          parsed = { syllabus: SP.merge(per.map((x) => x.syllabus), nameIn.value), warnings: per.flatMap((x) => x.warnings) };
        } else parsed = SP.parseText(input.text, { title: nameIn.value });
        const rawText = input.text || SP.toText(parsed.syllabus);
        const notes = [...input.warnings, ...parsed.warnings];
        let syllabus = parsed.syllabus;
        let source = "rules";
        let aiModel = "";
        if (useAi && backend.ai) {
          showBusy("Analysing with AI… this can take up to a minute for long syllabi.");
          try {
            const r = await core.api("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: rawText, fileName: input.fileName }) });
            syllabus = r.syllabus;
            source = "ai";
            aiModel = r.model || "";
            notes.unshift(`Analysed by AI${aiModel ? ` (${aiModel})` : ""}. Difficulty, importance and hours are AI estimates: check them below.`);
            if (r.truncated) notes.push("The document was long, so only the first part was sent to the AI. Check that nothing is missing.");
          } catch (e) {
            notes.unshift(`AI analysis failed: ${e.message} Showing the rule-based parse instead.`);
            toast("AI analysis failed. Using the rule-based parse.", "error");
          }
        } else {
          notes.unshift(backend.ai ? "Parsed with built-in rules (AI was switched off). Difficulty, importance and hours are not estimated, so defaults are assumed." : "Parsed with built-in rules. AI is not configured, so difficulty, importance and hours are not estimated and defaults are assumed.");
        }
        const name = nameIn.value.trim() || syllabus.title || input.fileName.replace(/\.[^.]+$/, "") || "My syllabus";
        if (!SP.countTopics(syllabus)) {
          showError("No topics could be found in this syllabus.", h("p", { class: "small", text: "Check the file has readable text, or start empty and add units and topics yourself." }));
          status.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => create(name, { units: [{ name: "Unit 1", topics: [] }] }, "rules", "", rawText, ["Started empty."]) }, "Start with an empty syllabus"));
          go.disabled = false;
          return;
        }
        create(name, syllabus, source, aiModel, rawText, notes, input.fileName);
      } catch (e) {
        showError(e.message, e.hint ? h("p", { class: "small", text: e.hint }) : null);
        go.disabled = false;
      }
    }

    function create(name, syllabus, source, aiModel, rawText, notes, fileName = "") {
      const today = ctx.todayISO();
      const p = PL.sanitizeProject({
        id: ctx.uid(), name, fileName, source, aiModel, rawText, notes, syllabus, stage: "review", createdAt: Date.now(),
        config: { ...PL.defaultConfig(today), endDate: detectDeadline(rawText, today) || PL.defaultConfig(today).endDate },
        answered: {}
      }, today);
      p.detectedDeadline = detectDeadline(rawText, today) || "";
      ctx.state.study.projects.push(p);
      ctx.state.study.activeId = p.id;
      view.screen = "project";
      ctx.save();
      core.rerender();
    }

    refreshMode();
    return h("section", { class: "card form-card study-new" },
      h("div", { class: "row-between" }, h("h2", { text: "New syllabus" }), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { view.screen = "home"; core.rerender(); } }, "Cancel")),
      h("label", { class: "field" }, "Name", nameIn),
      h("div", { class: "seg", role: "group", "aria-label": "Input type" }, modeBtns),
      drop, fileIn, text,
      h("label", { class: "check-label ai-opt" }, aiBox, h("span", { text: backend.ai ? "Analyse with AI (extracts topics, estimates difficulty, importance and hours)" : "AI analysis unavailable: the server has no AI key configured" })),
      h("div", { class: "row-end" }, go),
      status);
  }

  // best-effort exam date detection ("Exam: 15 Dec 2026", "Final examination on 2026-12-15")
  function detectDeadline(text, today) {
    if (!text) return "";
    const re = /(exam|examination|deadline|test|assessment|submission)[^\n\d]{0,40}?(\d{4}-\d{2}-\d{2}|\d{1,2}[\s/\-.](?:[a-z]{3,9}|\d{1,2})[\s/\-.,]+\d{4})/gi;
    let m;
    while ((m = re.exec(text))) {
      const iso = toIso(m[2]);
      if (iso && iso > today) return iso;
    }
    return "";
  }
  function toIso(s) {
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let y; let mo; let d;
    if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if ((m = s.match(/^(\d{1,2})[\s/\-.]([a-z]{3,9})[\s/\-.,]+(\d{4})$/i)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) [y, mo, d] = [+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]];
    else if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.,\s]+(\d{4})$/))) [y, mo, d] = [+m[3], +m[2], +m[1]]; // day first
    else return "";
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // ---------- review / correct ----------
  function review(core, p) {
    const { ctx, SP, view } = core;
    const { h, icon, toast, uid } = ctx;
    const save = () => ctx.save();
    const again = () => { ctx.save(); core.rerender(); };
    const s = p.syllabus;
    const remaining = () => s.units.flatMap((u) => u.topics).filter((t) => !t.done && !t.excluded).length;

    const num = (t, key, lo, hi, step) => h("input", {
      class: "input input-sm num", type: "number", min: String(lo), max: String(hi), step: String(step), value: t[key] == null ? "" : t[key], placeholder: "auto", "aria-label": key,
      onchange: (e) => { const v = e.target.value === "" ? null : SP.normHours(e.target.value); t[key] = v; e.target.value = v == null ? "" : v; save(); }
    });

    function topicRow(u, t) {
      const more = h("div", { class: "topic-more", hidden: true },
        h("label", { class: "field" }, "Subtopics (one per line)", h("textarea", { class: "input", rows: "3", value: t.subtopics.join("\n"), onchange: (e) => { t.subtopics = e.target.value.split("\n").map((x) => SP.cleanName(x, 120)).filter(Boolean).slice(0, 25); save(); } })),
        h("label", { class: "field" }, "Learn these first (topic names, comma separated)", h("input", { class: "input", type: "text", value: t.prereqs.join(", "), onchange: (e) => { t.prereqs = e.target.value.split(",").map((x) => SP.cleanName(x, 140)).filter(Boolean).slice(0, 8); save(); } })));
      return h("li", { class: "topic-row" + (t.done || t.excluded ? " off" : "") },
        h("div", { class: "topic-line" },
          h("input", { class: "input input-sm topic-name", type: "text", value: t.name, maxlength: "140", "aria-label": "Topic name", onchange: (e) => { const v = SP.cleanName(e.target.value, 140); if (!v) { e.target.value = t.name; return; } t.name = v; save(); } }),
          h("select", { class: "input input-sm", "aria-label": "Difficulty", onchange: (e) => { t.difficulty = e.target.value || null; save(); } },
            [["", "Difficulty"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]].map(([v, l]) => h("option", { value: v, selected: (t.difficulty || "") === v }, l))),
          h("select", { class: "input input-sm", "aria-label": "Exam importance", onchange: (e) => { t.importance = e.target.value ? Number(e.target.value) : null; save(); } },
            [["", "Importance"], ...[1, 2, 3, 4, 5].map((n) => [String(n), `${n}/5`])].map(([v, l]) => h("option", { value: v, selected: String(t.importance || "") === v }, l))),
          num(t, "hours", 0.25, 40, 0.25),
          h("label", { class: "check-label small", title: "Already studied: left out of the plan" }, h("input", { type: "checkbox", checked: t.done, onchange: (e) => { t.done = e.target.checked; again(); } }), "Done"),
          h("label", { class: "check-label small", title: "Skip: left out of the plan" }, h("input", { type: "checkbox", checked: t.excluded, onchange: (e) => { t.excluded = e.target.checked; again(); } }), "Skip"),
          h("button", { class: "icon-btn", type: "button", title: "Subtopics and prerequisites", "aria-label": "Subtopics and prerequisites", onclick: () => { more.hidden = !more.hidden; } }, icon("edit", 15)),
          h("button", { class: "icon-btn danger", type: "button", title: "Remove topic", "aria-label": `Remove ${t.name}`, onclick: () => { u.topics = u.topics.filter((x) => x !== t); again(); } }, icon("x", 15))),
        t.subtopics.length ? h("p", { class: "muted small subs", text: "Subtopics: " + t.subtopics.join(" · ") }) : null,
        more);
    }

    function unitCard(u, ui) {
      const addIn = h("input", { class: "input input-sm grow", type: "text", placeholder: "Add a topic (paste several lines to add many)", "aria-label": `Add topic to ${u.name}` });
      const add = () => {
        const names = addIn.value.split("\n").map((x) => SP.cleanName(x, 140)).filter(Boolean);
        if (!names.length) return;
        names.forEach((n) => u.topics.push({ id: uid(), name: n, subtopics: [], difficulty: null, importance: null, hours: null, prereqs: [], done: false, excluded: false }));
        again();
      };
      addIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      addIn.addEventListener("paste", () => setTimeout(() => { if (addIn.value.includes("\n")) add(); }, 0));
      const move = (d) => { const j = ui + d; if (j < 0 || j >= s.units.length) return; [s.units[ui], s.units[j]] = [s.units[j], s.units[ui]]; again(); };
      return h("article", { class: "card unit-card" },
        h("div", { class: "unit-head" },
          h("input", { class: "input unit-name", type: "text", value: u.name, maxlength: "120", "aria-label": "Unit name", onchange: (e) => { u.name = SP.cleanName(e.target.value, 120) || u.name; e.target.value = u.name; save(); } }),
          h("label", { class: "field inline small", title: "Lecture hours stated in the syllabus (used to estimate study time)" }, "Lecture h",
            h("input", { class: "input input-sm num", type: "number", min: "0", max: "40", step: "0.5", value: u.lectureHours == null ? "" : u.lectureHours, onchange: (e) => { u.lectureHours = e.target.value === "" ? null : SP.normHours(e.target.value); save(); } })),
          h("button", { class: "icon-btn", type: "button", title: "Move up", "aria-label": "Move unit up", disabled: ui === 0, onclick: () => move(-1) }, "↑"),
          h("button", { class: "icon-btn", type: "button", title: "Move down", "aria-label": "Move unit down", disabled: ui === s.units.length - 1, onclick: () => move(1) }, "↓"),
          h("button", { class: "icon-btn danger", type: "button", title: "Delete unit", "aria-label": `Delete ${u.name}`, onclick: () => { if (u.topics.length && !confirm(`Delete "${u.name}" and its ${u.topics.length} topic(s)?`)) return; s.units = s.units.filter((x) => x !== u); again(); } }, icon("trash", 15))),
        u.topics.length ? h("ul", { class: "topic-list" }, u.topics.map((t) => topicRow(u, t))) : h("p", { class: "muted small pad", text: "No topics in this unit yet." }),
        h("div", { class: "row-form" }, addIn, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: add }, icon("plus", 14), "Add")));
    }

    const raw = p.rawText ? h("details", { class: "card panel" }, h("summary", { text: "Source text used for parsing" }), h("pre", { class: "raw-text", text: p.rawText.slice(0, 6000) + (p.rawText.length > 6000 ? "\n…" : "") })) : null;
    return h("div", { class: "study-review" },
      h("section", { class: "card form-card" },
        h("div", { class: "row-between" }, h("h2", { text: "Review the parsed syllabus" }), h("span", { class: "badge " + (p.source === "ai" ? "active" : "neutral"), text: p.source === "ai" ? "AI analysis" : "Rule-based parse" })),
        h("p", { class: "muted small", text: `${s.units.length} unit(s) · ${SP.countTopics(s)} topic(s) found. Fix names, drop what does not belong, and set what you know. Blank difficulty, importance or hours are filled with documented defaults.` }),
        p.notes.length ? h("ul", { class: "note-list" }, p.notes.map((n) => h("li", { class: /fail/i.test(n) ? "bad" : "", text: n }))) : null,
        h("label", { class: "field" }, "Plan name", h("input", { class: "input", type: "text", value: p.name, maxlength: "80", onchange: (e) => { p.name = e.target.value.trim().slice(0, 80) || p.name; e.target.value = p.name; save(); } }))),
      ...s.units.map(unitCard),
      h("div", { class: "row-form" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => { s.units.push({ id: uid(), name: `Unit ${s.units.length + 1}`, lectureHours: null, topics: [] }); again(); } }, icon("plus", 16), "Add unit")),
      raw,
      h("div", { class: "row-between sticky-actions" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => { view.screen = "home"; core.rerender(); } }, "Save & close"),
        h("button", {
          class: "btn btn-primary", type: "button",
          onclick: () => {
            if (!remaining()) return toast("Add at least one topic that is not marked Done or Skip.", "error");
            core.setStage(p, "configure");
            again();
          }
        }, "Next: configure plan →")));
  }

  // ---------- configure ----------
  function configure(core, p) {
    const { ctx, PL } = core;
    const { h, icon, toast, fmt, todayISO } = ctx;
    const c = p.config;
    const today = todayISO();
    p.answered = p.answered || {};
    const save = () => ctx.save();
    const mark = (...keys) => keys.forEach((k) => (p.answered[k] = true));
    const topics = () => p.syllabus.units.flatMap((u) => u.topics.map((t) => ({ t, u })));
    const live = () => topics().filter(({ t }) => !t.done && !t.excluded);

    const capacity = h("div", { class: "capacity", role: "status" });
    function drawCapacity() {
      const r = PL.buildPlan(p.syllabus, c, { today, noAlternatives: true });
      if (r.errors.length) return capacity.replaceChildren(h("div", { class: "alert error" }, icon("alert", 18), r.errors.join(" ")));
      if (!r.stats || !r.stats.required) return capacity.replaceChildren(h("div", { class: "alert info" }, "Nothing left to schedule."));
      const pct = Math.min(100, Math.round((r.stats.required / Math.max(1, r.stats.capacity)) * 100));
      capacity.replaceChildren(
        h("div", { class: "alert " + (r.conflict ? "warn" : "ok") }, icon(r.conflict ? "alert" : "check", 18),
          h("div", {}, h("strong", { text: r.conflict ? "This will not fit as set" : "This fits your time" }),
            h("p", { class: "small", text: `Needs about ${r.stats.required}h (learning ${r.stats.learn}h, practice ${r.stats.practice}h, revision ${r.stats.revisionUnit + r.stats.revisionFinal}h). You have ${r.stats.capacity}h across ${r.stats.studyDays} study days.${r.conflict ? " You can still generate a plan: it will show exactly what does not fit and offer fixes." : ""}` }))),
        ctx.bar(pct, r.conflict ? "#d12f4f" : undefined));
    }
    const changed = (...keys) => { mark(...keys); save(); drawCapacity(); drawGate(); };

    // ----- adaptive questionnaire: only what is still unknown -----
    const unanswered = (k) => !p.answered[k];
    const noneDone = () => !topics().some(({ t }) => t.done);
    const noDifficulty = () => topics().every(({ t }) => !t.difficulty);
    const noImportance = () => topics().every(({ t }) => !t.importance);
    const essential = ["deadline", "hours", "days", "level"];

    const questions = h("div", { class: "questions" });
    const gate = h("div", { class: "gate" });
    const answeredCount = () => essential.filter((k) => p.answered[k]).length;

    function qCard(key, title, hint, body, opts = {}) {
      return h("div", { class: "q-card", "data-q": key },
        h("div", { class: "q-title" }, h("strong", { text: title }), opts.optional ? h("span", { class: "badge neutral", text: "Optional" }) : h("span", { class: "badge soon", text: "Needed" })),
        hint ? h("p", { class: "muted small", text: hint }) : null,
        body,
        h("div", { class: "row-end" },
          opts.optional ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { mark(key); drawQuestions(); drawGate(); save(); } }, opts.skipLabel || "Skip") : null,
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { if (opts.onConfirm && opts.onConfirm() === false) return; mark(key); save(); drawQuestions(); drawCapacity(); drawGate(); } }, opts.confirmLabel || "Confirm")));
    }

    function drawQuestions() {
      const cards = [];
      if (unanswered("deadline")) {
        const dateIn = h("input", { class: "input", type: "date", min: today, value: c.mode === "date" ? c.endDate : "", "aria-label": "Exam date" });
        const daysIn = h("input", { class: "input", type: "number", min: "1", max: String(PL.MAX_DAYS), value: c.mode === "days" ? c.days : "", placeholder: "e.g. 45", "aria-label": "Number of days" });
        const detected = p.detectedDeadline && p.detectedDeadline > today ? p.detectedDeadline : "";
        if (detected && c.mode === "date" && c.endDate === detected) dateIn.value = detected;
        cards.push(qCard("deadline", "When is your exam or deadline?",
          detected ? `We found ${fmt(detected)} in your file. Confirm or change it.` : "Pick the exam date, or just say how many days you have.",
          h("div", { class: "q-fields" }, h("label", { class: "field" }, "Exam / deadline date", dateIn), h("span", { class: "muted small", text: "or" }), h("label", { class: "field" }, "Days available", daysIn)),
          {
            onConfirm: () => {
              if (dateIn.value) {
                if (dateIn.value < c.startDate) { toast("The exam date can't be before the start date.", "error"); return false; }
                c.mode = "date"; c.endDate = dateIn.value;
              } else if (Number(daysIn.value) >= 1) { c.mode = "days"; c.days = Math.min(PL.MAX_DAYS, Math.round(Number(daysIn.value))); }
              else { toast("Enter an exam date or a number of days.", "error"); return false; }
            }
          }));
      }
      if (unanswered("hours")) {
        const hIn = h("input", { class: "input", type: "number", min: "0.5", max: "16", step: "0.25", value: c.hoursPerDay, "aria-label": "Hours per day" });
        const wIn = h("input", { class: "input", type: "number", min: "0", max: "16", step: "0.25", value: c.weekendHours == null ? "" : c.weekendHours, placeholder: "same", "aria-label": "Weekend hours" });
        cards.push(qCard("hours", "How many hours can you study per day?", "Be realistic: the plan never schedules more than this (a small buffer is kept free).",
          h("div", { class: "q-fields" }, h("label", { class: "field" }, "Weekdays (hours)", hIn), h("label", { class: "field" }, "Weekends (hours, optional)", wIn)),
          { onConfirm: () => { const v = Number(hIn.value); if (!(v >= 0.5 && v <= 16)) { toast("Enter between 0.5 and 16 hours.", "error"); return false; } c.hoursPerDay = Math.round(v * 4) / 4; c.weekendHours = wIn.value === "" ? null : Math.min(16, Math.max(0, Math.round(Number(wIn.value) * 4) / 4)); } }));
      }
      if (unanswered("days")) {
        const sel = new Set(c.studyDays);
        const chips = DAY_ORDER.map((d) => h("button", { type: "button", class: "chip" + (sel.has(d) ? " on" : ""), "aria-pressed": String(sel.has(d)), onclick: (e) => { if (sel.has(d)) sel.delete(d); else sel.add(d); e.currentTarget.classList.toggle("on", sel.has(d)); e.currentTarget.setAttribute("aria-pressed", String(sel.has(d))); } }, DAY_NAMES[d]));
        cards.push(qCard("days", "Which days can you study?", "Unselected days get no sessions.", h("div", { class: "chips wrap" }, chips),
          { onConfirm: () => { if (!sel.size) { toast("Pick at least one day.", "error"); return false; } c.studyDays = [...sel].sort(); } }));
      }
      if (unanswered("level")) {
        const pick = (lvl) => { c.level = lvl; mark("level"); save(); drawQuestions(); drawCapacity(); drawGate(); };
        cards.push(h("div", { class: "q-card", "data-q": "level" },
          h("div", { class: "q-title" }, h("strong", { text: "How prepared are you right now?" }), h("span", { class: "badge soon", text: "Needed" })),
          h("p", { class: "muted small", text: "Beginners get more time per topic, advanced students less." }),
          h("div", { class: "chips wrap" }, [["beginner", "Just starting"], ["intermediate", "Know the basics"], ["advanced", "Mostly revising"]].map(([k, l]) => h("button", { type: "button", class: "chip" + (c.level === k ? " on" : ""), onclick: () => pick(k) }, l)))));
      }
      if (unanswered("completed") && noneDone() && topics().length > 3) {
        const sel = new Set();
        cards.push(qCard("completed", "Have you already finished any topics?", "Finished topics are left out of the plan.", topicPicker(sel, topics()),
          { optional: true, skipLabel: "None yet", confirmLabel: "Mark as done", onConfirm: () => { topics().forEach(({ t }) => { if (sel.has(t.id)) t.done = true; }); } }));
      }
      if (unanswered("difficult") && noDifficulty()) {
        const sel = new Set();
        cards.push(qCard("difficult", "Which topics do you find hardest?", "They are given more time and drive the Toughest First order.", topicPicker(sel, live()),
          { optional: true, confirmLabel: "Mark as hard", onConfirm: () => { live().forEach(({ t }) => { if (sel.has(t.id)) t.difficulty = "hard"; }); } }));
      }
      if (unanswered("priority") && noImportance()) {
        const sel = new Set();
        cards.push(qCard("priority", "Anything that matters most for the exam?", "Selected topics get top importance and are scheduled earlier when you turn on importance weighting.", topicPicker(sel, live()),
          { optional: true, confirmLabel: "Prioritise", onConfirm: () => { live().forEach(({ t }) => { if (sel.has(t.id)) t.importance = 5; }); if (sel.size) c.weightImportance = true; } }));
      }
      if (unanswered("slot")) {
        const pick = (v) => { c.revisionSlot = v; mark("slot"); save(); drawQuestions(); };
        cards.push(h("div", { class: "q-card", "data-q": "slot" },
          h("div", { class: "q-title" }, h("strong", { text: "When do you prefer to practise and revise?" }), h("span", { class: "badge neutral", text: "Optional" })),
          h("div", { class: "chips wrap" }, [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["any", "No preference"]].map(([k, l]) => h("button", { type: "button", class: "chip" + (c.revisionSlot === k ? " on" : ""), onclick: () => pick(k) }, l)))));
      }
      const done = essential.every((k) => p.answered[k]);
      questions.replaceChildren(
        h("div", { class: "row-between" }, h("h2", { text: "A few quick questions" }), h("span", { class: "muted small", text: `${answeredCount()} of ${essential.length} essentials answered` })),
        ...(cards.length ? cards : [h("p", { class: "muted small", text: done ? "All set. Fine-tune anything below, then generate your plan." : "" })]));
    }

    function topicPicker(sel, list) {
      const box = h("div", { class: "picker" });
      const filter = h("input", { class: "input input-sm", type: "search", placeholder: "Filter topics", "aria-label": "Filter topics", oninput: draw });
      function draw() {
        const f = filter.value.toLowerCase();
        box.replaceChildren(...list.filter(({ t, u }) => !f || (t.name + u.name).toLowerCase().includes(f)).slice(0, 80).map(({ t, u }) =>
          h("label", { class: "check-label pick" }, h("input", { type: "checkbox", checked: sel.has(t.id), onchange: (e) => { if (e.target.checked) sel.add(t.id); else sel.delete(t.id); } }), h("span", { text: t.name }), h("span", { class: "muted small", text: u.name }))));
      }
      draw();
      return h("div", {}, filter, box);
    }

    function drawGate() {
      const ok = essential.every((k) => p.answered[k]);
      gate.replaceChildren(h("div", { class: "row-between sticky-actions" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => { core.setStage(p, "review"); save(); core.rerender(); } }, "← Back to syllabus"),
        h("button", {
          class: "btn btn-primary", type: "button", disabled: !ok, title: ok ? "" : "Answer the essential questions first",
          onclick: () => {
            const r = core.generate(p, { keepDone: !!core.view.replan });
            if (r.errors && r.errors.length) return toast(r.errors[0], "error");
            core.setStage(p, "preview");
            save();
            core.rerender();
          }
        }, icon("spark", 16), ok ? "Generate study plan" : "Answer the essential questions to continue")));
    }

    // ----- fine-tune -----
    const tune = h("details", { class: "card panel fine-tune" });
    function drawTune() {
      const f = (label, el, hint) => h("label", { class: "field" }, label, el, hint ? h("span", { class: "hint", text: hint }) : null);
      const numIn = (key, lo, hi, step, ...marks) => h("input", { class: "input", type: "number", min: String(lo), max: String(hi), step: String(step), value: c[key] == null ? "" : c[key], onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value !== "") c[key] = Math.min(hi, Math.max(lo, v)); else if (key === "weekendHours") c[key] = null; e.target.value = c[key] == null ? "" : c[key]; changed(...marks); } });
      const dateIn = (key, ...marks) => h("input", { class: "input", type: "date", value: c[key], onchange: (e) => { if (ctx.isISO(e.target.value)) { c[key] = e.target.value; changed(...marks); } else e.target.value = c[key]; } });
      const days = h("div", { class: "chips wrap" }, DAY_ORDER.map((d) => h("button", { type: "button", class: "chip" + (c.studyDays.includes(d) ? " on" : ""), "aria-pressed": String(c.studyDays.includes(d)), onclick: () => { c.studyDays = c.studyDays.includes(d) ? c.studyDays.filter((x) => x !== d) : [...c.studyDays, d].sort(); changed("days"); drawTune(); tune.open = true; } }, DAY_NAMES[d])));
      const blockIn = h("input", { class: "input", type: "date", "aria-label": "Add a day off" });
      const blocked = h("div", { class: "chips wrap" },
        c.blockedDates.map((d) => h("button", { type: "button", class: "chip on", title: "Remove", onclick: () => { c.blockedDates = c.blockedDates.filter((x) => x !== d); changed(); drawTune(); tune.open = true; } }, `${fmt(d, ctx.SHORT)} ✕`)),
        blockIn, h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { if (ctx.isISO(blockIn.value) && !c.blockedDates.includes(blockIn.value)) { c.blockedDates = [...c.blockedDates, blockIn.value].sort(); changed(); drawTune(); tune.open = true; } } }, "Add day off"));
      const sel = (key, opts, ...marks) => h("select", { class: "input", onchange: (e) => { c[key] = e.target.value; changed(...marks); } }, opts.map(([v, l]) => h("option", { value: v, selected: c[key] === v }, l)));
      const strategies = [
        ["order", "Syllabus order", "Follow units and topics exactly as written."],
        ["easy", "Easiest first", "Build momentum with simpler topics, then ramp up."],
        ["hard", "Toughest first", "Tackle the hardest, highest-effort topics while you are fresh."],
        ["custom", "Custom plan", "Rank topics, lock dates, prioritise units, skip and allocate hours yourself."]
      ];
      tune.replaceChildren(
        h("summary", { text: "Fine-tune everything" }),
        h("div", { class: "tune-grid" },
          h("div", { class: "tune-col" }, h("h3", { class: "section-label", text: "Time" }),
            f("Start date", dateIn("startDate", "deadline")),
            f("Plan until", sel("mode", [["date", "An exam date"], ["days", "A number of days"]], "deadline")),
            c.mode === "date" ? f("Exam / deadline date", dateIn("endDate", "deadline")) : f("Number of days", numIn("days", 1, PL.MAX_DAYS, 1, "deadline")),
            f("Hours per day", numIn("hoursPerDay", 0.5, 16, 0.25, "hours")),
            f("Weekend hours (optional)", numIn("weekendHours", 0, 16, 0.25, "hours"), "Leave blank to use the same hours"),
            f("Study days", days), f("Days off", blocked)),
          h("div", { class: "tune-col" }, h("h3", { class: "section-label", text: "Preparation" }),
            f("Current level", sel("level", [["beginner", "Just starting"], ["intermediate", "Know the basics"], ["advanced", "Mostly revising"]], "level")),
            f("Practice time (% of each topic)", numIn("practicePct", 0, 100, 5)),
            f("Revision time (% of total study)", numIn("revisionPct", 0, 100, 5)),
            f("Daily buffer kept free (%)", numIn("bufferPct", 0, 50, 5), "Slack for overruns and life"),
            f("Revision timing", sel("revisionTiming", [["both", "After each unit + final days"], ["end", "Final days only"], ["spread", "After each unit only"]])),
            f("Preferred practice/revision time", sel("revisionSlot", [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["any", "No preference"]], "slot"))),
          h("div", { class: "tune-col wide" }, h("h3", { class: "section-label", text: "Strategy" }),
            h("div", { class: "strategy-grid", role: "radiogroup", "aria-label": "Planning strategy" }, strategies.map(([k, t, d]) =>
              h("button", { type: "button", role: "radio", "aria-checked": String(c.strategy === k), class: "strategy" + (c.strategy === k ? " on" : ""), onclick: () => { c.strategy = k; changed(); drawTune(); drawCustom(); tune.open = true; } }, h("strong", { text: t }), h("span", { class: "small", text: d })))),
            h("label", { class: "check-label" }, h("input", { type: "checkbox", checked: c.weightImportance, onchange: (e) => { c.weightImportance = e.target.checked; changed(); } }), "Weigh by exam importance (more important topics first)"),
            h("label", { class: "check-label" }, h("input", { type: "checkbox", checked: c.respectPrereqs, onchange: (e) => { c.respectPrereqs = e.target.checked; changed(); } }), "Respect prerequisites (a topic never comes before what it depends on)"))));
    }

    // ----- custom plan editor -----
    const custom = h("section", { class: "card panel custom-plan" });
    function orderedLive() {
      const idx = new Map(c.customOrder.map((id, i) => [id, i]));
      return live().sort((a, b) => (idx.has(a.t.id) ? idx.get(a.t.id) : 1e6) - (idx.has(b.t.id) ? idx.get(b.t.id) : 1e6));
    }
    function drawCustom() {
      custom.hidden = c.strategy !== "custom";
      if (custom.hidden) return;
      const list = orderedLive();
      const setOrder = (arr) => { c.customOrder = arr.map(({ t }) => t.id); changed(); drawCustom(); };
      let dragIdx = -1;
      const rows = list.map(({ t, u }, i) => h("li", {
        class: "rank-row", draggable: true,
        ondragstart: (e) => { dragIdx = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); },
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => { e.preventDefault(); if (dragIdx < 0 || dragIdx === i) return; const a = list.slice(); const [m] = a.splice(dragIdx, 1); a.splice(i, 0, m); setOrder(a); }
      },
      h("span", { class: "grip", "aria-hidden": "true", text: "⋮⋮" }),
      h("span", { class: "rank-n", text: String(i + 1) }),
      h("span", { class: "rank-name" }, h("strong", { text: t.name }), h("span", { class: "muted small", text: ` ${u.name}` })),
      h("input", { class: "input input-sm num", type: "number", min: "0.25", max: "40", step: "0.25", placeholder: "hours", value: t.hours == null ? "" : t.hours, "aria-label": `Hours for ${t.name}`, onchange: (e) => { t.hours = e.target.value === "" ? null : Math.round(Math.min(40, Math.max(0.25, Number(e.target.value))) * 4) / 4; save(); drawCapacity(); } }),
      h("input", { class: "input input-sm", type: "date", title: "Lock this topic to a date", "aria-label": `Lock date for ${t.name}`, min: c.startDate, value: c.lockedTopicDates[t.id] || "", onchange: (e) => { if (ctx.isISO(e.target.value)) c.lockedTopicDates[t.id] = e.target.value; else delete c.lockedTopicDates[t.id]; changed(); } }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Move up", disabled: i === 0, onclick: () => { const a = list.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; setOrder(a); } }, "↑"),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Move down", disabled: i === list.length - 1, onclick: () => { const a = list.slice(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; setOrder(a); } }, "↓"),
      h("button", { class: "icon-btn danger", type: "button", title: "Skip this topic", "aria-label": `Skip ${t.name}`, onclick: () => { t.excluded = true; changed(); drawCustom(); } }, icon("x", 14))));
      const skipped = topics().filter(({ t }) => t.excluded && !t.done);
      custom.replaceChildren(
        h("h2", { text: "Custom plan" }),
        h("p", { class: "muted small", text: "Drag topics (or use the arrows) to set the order. Optionally allocate hours and lock a topic to a date. Units marked high priority go first." }),
        h("div", { class: "unit-prio" }, p.syllabus.units.map((u) => h("label", { class: "field inline small" }, u.name, h("select", { class: "input input-sm", onchange: (e) => { if (e.target.value === "normal") delete c.unitPriority[u.id]; else c.unitPriority[u.id] = e.target.value; changed(); } }, [["high", "High"], ["normal", "Normal"], ["low", "Low"]].map(([v, l]) => h("option", { value: v, selected: (c.unitPriority[u.id] || "normal") === v }, l)))))),
        h("ol", { class: "rank-list" }, rows),
        skipped.length ? h("div", { class: "muted small" }, "Skipped: ", skipped.map(({ t }) => h("button", { type: "button", class: "chip on", title: "Include again", onclick: () => { t.excluded = false; changed(); drawCustom(); } }, `${t.name} ✕`))) : null);
    }

    drawQuestions();
    drawTune();
    drawCustom();
    drawCapacity();
    drawGate();
    return h("div", { class: "study-config" },
      h("section", { class: "card form-card" }, questions),
      capacity, tune, custom, gate);
  }

  return { newSyllabus, review, configure, detectDeadline };
})();
