(() => {
  const STORAGE_KEY = "radial-tracker-state-v1";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const PALETTE = ["#2563eb", "#16a34a", "#7c3aed", "#ea580c", "#dc2626", "#0891b2", "#a16207", "#db2777"];

  function defaultState() {
    const today = new Date();
    return {
      startDate: toISO(today),
      totalDays: 90,
      title: "90 DAYS\nACTION PLAN",
      categories: [
        { id: uid(), name: "DSA", color: "#2563eb" },
        { id: uid(), name: "SQL", color: "#16a34a" },
        { id: uid(), name: "Market Entry", color: "#7c3aed" },
        { id: uid(), name: "Guesstimate", color: "#ea580c" },
        { id: uid(), name: "RCA", color: "#dc2626" },
        { id: uid(), name: "Projects", color: "#7a5230" }
      ],
      ticks: {}
    };
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }
  function toISO(d) {
    return d.toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d;
  }
  function isWeekend(d) {
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.categories && parsed.startDate) return parsed;
      }
    } catch (e) {}
    return defaultState();
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- DOM refs ----------
  const periodButtons = document.getElementById("periodButtons");
  const customDaysInput = document.getElementById("customDays");
  const applyCustomBtn = document.getElementById("applyCustom");
  const startDateInput = document.getElementById("startDate");
  const taskListEl = document.getElementById("taskList");
  const addTaskForm = document.getElementById("addTaskForm");
  const newTaskName = document.getElementById("newTaskName");
  const newTaskColor = document.getElementById("newTaskColor");
  const svg = document.getElementById("chart");
  const centerTitle = document.getElementById("centerTitle");
  const centerDate = document.getElementById("centerDate");
  const statsEl = document.getElementById("stats");
  const resetBtn = document.getElementById("resetBtn");
  const tooltip = document.getElementById("tooltip");

  // ---------- Sidebar rendering ----------
  function renderSidebar() {
    // period buttons
    [...periodButtons.children].forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.days) === state.totalDays);
    });
    startDateInput.value = state.startDate;

    // task list
    taskListEl.innerHTML = "";
    state.categories.forEach((cat) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = cat.color;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = cat.name;
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove task";
      removeBtn.addEventListener("click", () => {
        state.categories = state.categories.filter((c) => c.id !== cat.id);
        delete state.ticks[cat.id];
        save();
        renderAll();
      });
      li.append(dot, name, removeBtn);
      taskListEl.appendChild(li);
    });

    centerTitle.textContent = state.title;
    const startD = new Date(state.startDate + "T00:00:00");
    centerDate.textContent = startD
      .toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
      .toUpperCase();

    // stats
    let done = 0;
    let total = state.categories.length * state.totalDays;
    state.categories.forEach((cat) => {
      const t = state.ticks[cat.id] || {};
      done += Object.values(t).filter(Boolean).length;
    });
    statsEl.textContent = total ? `${done} / ${total} tasks ticked (${Math.round((done / total) * 100)}%)` : "";
  }

  // ---------- Chart rendering ----------
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

  function el(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }

  function renderChart() {
    svg.innerHTML = "";
    const n = Math.max(1, state.totalDays);
    const catCount = Math.max(1, state.categories.length);

    const ringWidth = 44;
    const ringGap = 6;
    const innerHole = 130;
    const labelPad = 70;
    const outerR = innerHole + catCount * (ringWidth + ringGap);
    const size = (outerR + labelPad) * 2;
    const cx = size / 2;
    const cy = size / 2;

    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

    const GAP = 16; // degrees left open, so the wheel reads as a spiral with a start/end, not a closed loop
    const totalSpan = 360 - GAP;
    const anglePerDay = totalSpan / n;
    const angleOffset = 180 + GAP / 2; // opening centered at the bottom

    // weekend bands (drawn first, behind rings)
    for (let i = 0; i < n; i++) {
      const d = addDays(state.startDate, i);
      if (isWeekend(d)) {
        const start = angleOffset + i * anglePerDay;
        const end = start + anglePerDay;
        const band = el("path", {
          d: donutSegPath(cx, cy, innerHole - 4, outerR + 4, start, end),
          fill: "#cdd2db",
          "fill-opacity": 0.6,
          class: "weekend-band"
        });
        svg.appendChild(band);
      }
    }

    // rings per category
    state.categories.forEach((cat, ringIdx) => {
      const innerR = innerHole + ringIdx * (ringWidth + ringGap);
      const outer = innerR + ringWidth;
      const ticks = state.ticks[cat.id] || {};

      for (let i = 0; i < n; i++) {
        const d = addDays(state.startDate, i);
        const iso = toISO(d);
        const start = angleOffset + i * anglePerDay;
        const end = start + anglePerDay;
        const done = !!ticks[iso];
        const path = el("path", {
          d: donutSegPath(cx, cy, innerR, outer, start, end),
          fill: done ? cat.color : "transparent",
          "fill-opacity": done ? 0.9 : 1,
          class: "day-seg",
          "data-cat": cat.id,
          "data-date": iso
        });
        path.setAttribute("stroke", "none");
        path.addEventListener("click", () => toggleTick(cat.id, iso));
        path.addEventListener("mousemove", (ev) => showTooltip(ev, cat.name, d, done));
        path.addEventListener("mouseleave", hideTooltip);
        svg.appendChild(path);
      }

    });

    // radial spoke lines separating each day, drawn across the full ring stack
    for (let i = 0; i <= n; i++) {
      const angle = angleOffset + i * anglePerDay;
      const inner = polar(cx, cy, innerHole - 4, angle);
      const outer = polar(cx, cy, outerR + 4, angle);
      const line = el("line", {
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        stroke: "#b9bfca",
        "stroke-width": 1.2,
        "pointer-events": "none"
      });
      svg.appendChild(line);
    }

    // concentric ring boundary arcs for clarity (open, matching the gap)
    for (let ringIdx = 0; ringIdx <= state.categories.length; ringIdx++) {
      const r = innerHole + ringIdx * (ringWidth + ringGap) - (ringIdx === 0 ? 0 : ringGap / 2);
      const arc = el("path", {
        d: arcPath(cx, cy, r, angleOffset, angleOffset + totalSpan),
        fill: "none",
        stroke: "#d7dae0",
        "stroke-width": 1,
        "pointer-events": "none"
      });
      svg.appendChild(arc);
    }

    // opening end-caps: short radial lines closing off the start/end of the spiral
    [angleOffset, angleOffset + totalSpan].forEach((angle) => {
      const inner = polar(cx, cy, innerHole - 4, angle);
      const outer = polar(cx, cy, outerR + 4, angle);
      svg.appendChild(
        el("line", {
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
          stroke: "#9aa1b0",
          "stroke-width": 2,
          "pointer-events": "none"
        })
      );
    });

    // day / date labels around outer edge
    const step = n <= 31 ? 1 : n <= 62 ? 2 : n <= 120 ? 3 : 7;
    for (let i = 0; i < n; i += step) {
      const d = addDays(state.startDate, i);
      const start = angleOffset + i * anglePerDay;
      const mid = start + anglePerDay / 2;
      const pos = polar(cx, cy, outerR + 22, mid);
      const midNorm = ((mid % 360) + 360) % 360;
      let rot = mid;
      let anchor = "middle";
      if (midNorm > 90 && midNorm < 270) rot += 180;
      const t = el("text", {
        x: pos.x,
        y: pos.y,
        class: "day-label",
        "text-anchor": anchor,
        transform: `rotate(${rot}, ${pos.x}, ${pos.y})`
      });
      t.textContent = d.getDate();
      svg.appendChild(t);
    }

    // size the container / center label to match
    const container = document.getElementById("radialContainer");
    container.style.width = size + "px";
    container.style.height = size + "px";
  }

  function toggleTick(catId, iso) {
    if (!state.ticks[catId]) state.ticks[catId] = {};
    state.ticks[catId][iso] = !state.ticks[catId][iso];
    if (!state.ticks[catId][iso]) delete state.ticks[catId][iso];
    save();
    renderAll();
  }

  function showTooltip(ev, catName, date, done) {
    tooltip.textContent = `${catName} — ${date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    })} ${done ? "✓" : ""}`;
    tooltip.style.left = ev.clientX + "px";
    tooltip.style.top = ev.clientY + "px";
    tooltip.classList.add("visible");
  }
  function hideTooltip() {
    tooltip.classList.remove("visible");
  }

  function renderAll() {
    renderSidebar();
    renderChart();
  }

  // ---------- Events ----------
  periodButtons.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-days]");
    if (!btn) return;
    state.totalDays = Number(btn.dataset.days);
    save();
    renderAll();
  });

  applyCustomBtn.addEventListener("click", () => {
    const val = Number(customDaysInput.value);
    if (val > 0) {
      state.totalDays = Math.min(1000, Math.round(val));
      save();
      renderAll();
    }
  });

  startDateInput.addEventListener("change", () => {
    if (startDateInput.value) {
      state.startDate = startDateInput.value;
      save();
      renderAll();
    }
  });

  addTaskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = newTaskName.value.trim();
    if (!name) return;
    state.categories.push({ id: uid(), name, color: newTaskColor.value });
    newTaskName.value = "";
    newTaskColor.value = PALETTE[state.categories.length % PALETTE.length];
    save();
    renderAll();
  });

  centerTitle.addEventListener("blur", () => {
    state.title = centerTitle.textContent.trim() || defaultState().title;
    save();
  });

  resetBtn.addEventListener("click", () => {
    if (confirm("Clear all ticked days? This cannot be undone.")) {
      state.ticks = {};
      save();
      renderAll();
    }
  });

  renderAll();
})();
