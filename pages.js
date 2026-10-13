window.Pages = (() => {
  "use strict";

  const PRIORITIES = ["high", "medium", "low"];
  const PRIO_LABEL = { high: "High", medium: "Medium", low: "Low" };
  const PRIO_RANK = { high: 0, medium: 1, low: 2 };

  const prioSelect = (h, value) =>
    h("select", { class: "input", "aria-label": "Priority" },
      PRIORITIES.map((p) => h("option", { value: p, selected: p === value }, PRIO_LABEL[p])));

  // ---------- To-Do ----------
  function todo(root, c) {
    const { h, icon, state, save, toast, uid, todayISO, fmt, SHORT, bar, emptyState, isISO } = c;
    let filter = "all";
    let sort = "priority";
    let editingId = null;

    const text = h("input", { class: "input grow", type: "text", placeholder: "What needs doing?", maxlength: "200", "aria-label": "New to-do" });
    const prio = prioSelect(h, "medium");
    const due = h("input", { class: "input", type: "date", "aria-label": "Due date (optional)", title: "Due date (optional)" });
    const addForm = h("form", {
      class: "card form-card row-form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const t = text.value.trim();
        if (!t) return toast("Write what needs doing first.", "error");
        if (due.value && !isISO(due.value)) return toast("Pick a valid due date.", "error");
        state.todos.push({ id: uid(), text: t, priority: prio.value, due: due.value, done: false, created: Date.now() });
        save();
        text.value = "";
        due.value = "";
        renderAll();
        text.focus();
      }
    }, text, prio, due, h("button", { class: "btn btn-primary", type: "submit" }, icon("plus", 16), "Add"));

    const summary = h("div", { class: "card todo-summary" });
    const tabs = h("div", { class: "seg", role: "tablist" });
    const sortSel = h("select", {
      class: "input", "aria-label": "Sort by",
      onchange: (e) => { sort = e.target.value; renderList(); }
    }, [["priority", "Sort: Priority"], ["due", "Sort: Due date"], ["newest", "Sort: Newest"]].map(([v, l]) => h("option", { value: v }, l)));
    const clearBtn = h("button", {
      class: "btn btn-ghost btn-sm", type: "button",
      onclick: () => {
        const n = state.todos.filter((t) => t.done).length;
        if (!n || !confirm(`Delete ${n} completed to-do${n === 1 ? "" : "s"}?`)) return;
        state.todos = state.todos.filter((t) => !t.done);
        save();
        renderAll();
      }
    }, "Clear completed");
    const list = h("ul", { class: "todo-list" });

    const dueCmp = (a, b) => (a.due || "9999").localeCompare(b.due || "9999");
    const cmps = {
      priority: (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || dueCmp(a, b),
      due: (a, b) => dueCmp(a, b) || PRIO_RANK[a.priority] - PRIO_RANK[b.priority],
      newest: (a, b) => b.created - a.created
    };

    function editRow(t) {
      const tx = h("input", { class: "input grow", type: "text", value: t.text, maxlength: "200", "aria-label": "To-do text" });
      const pr = prioSelect(h, t.priority);
      const du = h("input", { class: "input", type: "date", value: t.due, "aria-label": "Due date" });
      return h("li", { class: "todo-item editing" }, h("form", {
        class: "row-form", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          if (!tx.value.trim()) return toast("To-do text can't be empty.", "error");
          if (du.value && !isISO(du.value)) return toast("Pick a valid due date.", "error");
          Object.assign(t, { text: tx.value.trim(), priority: pr.value, due: du.value });
          editingId = null;
          save();
          renderAll();
        }
      }, tx, pr, du,
      h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save"),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { editingId = null; renderList(); } }, "Cancel")));
    }

    function item(t) {
      if (editingId === t.id) return editRow(t);
      const today = todayISO();
      let dueLabel = "";
      let dueCls = "neutral";
      if (t.due) {
        if (!t.done && t.due < today) { dueLabel = `Overdue · ${fmt(t.due, SHORT)}`; dueCls = "late"; }
        else if (!t.done && t.due === today) { dueLabel = "Due today"; dueCls = "soon"; }
        else dueLabel = `Due ${fmt(t.due, SHORT)}`;
      }
      return h("li", { class: "todo-item" + (t.done ? " done" : "") },
        h("button", {
          class: "check" + (t.done ? " on" : ""), type: "button", "aria-pressed": String(t.done),
          "aria-label": `${t.done ? "Mark as not done" : "Mark as done"}: ${t.text}`,
          onclick: () => { t.done = !t.done; save(); renderAll(); }
        }, t.done ? icon("check", 14) : null),
        h("div", { class: "todo-main" },
          h("span", { class: "todo-text", text: t.text }),
          h("div", { class: "todo-meta" },
            h("span", { class: "prio-badge " + t.priority, text: PRIO_LABEL[t.priority] }),
            t.due ? h("span", { class: "badge " + dueCls, text: dueLabel }) : null)),
        h("div", { class: "item-actions" },
          h("button", { class: "icon-btn", type: "button", "aria-label": `Edit: ${t.text}`, onclick: () => { editingId = t.id; renderList(); } }, icon("edit", 16)),
          h("button", {
            class: "icon-btn danger", type: "button", "aria-label": `Delete: ${t.text}`,
            onclick: () => { state.todos = state.todos.filter((x) => x.id !== t.id); save(); renderAll(); }
          }, icon("trash", 16))));
    }

    function renderList() {
      const shown = state.todos.filter((t) => filter === "all" || (filter === "done" ? t.done : !t.done));
      shown.sort((a, b) => a.done - b.done || cmps[sort](a, b));
      if (shown.length) list.replaceChildren(...shown.map(item));
      else if (!state.todos.length) list.replaceChildren(emptyState("Nothing to do yet", "Add your first to-do above. Set a priority and due date to keep it on track."));
      else list.replaceChildren(emptyState(filter === "done" ? "Nothing completed yet" : "All clear", filter === "done" ? "Finish a to-do and it will show up here." : "No open to-dos. Nice work."));
    }

    function renderAll() {
      const done = state.todos.filter((t) => t.done).length;
      const total = state.todos.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const overdue = state.todos.filter((t) => !t.done && t.due && t.due < todayISO()).length;
      summary.replaceChildren(
        h("div", { class: "todo-summary-top" },
          h("strong", { text: `${total - done} open` }),
          h("span", { class: "muted small", text: `${done} of ${total} completed${overdue ? ` · ${overdue} overdue` : ""}` })),
        bar(pct));
      tabs.replaceChildren(...[["all", "All", total], ["active", "Active", total - done], ["done", "Done", done]].map(([k, label, n]) =>
        h("button", {
          type: "button", role: "tab", class: "seg-btn" + (filter === k ? " active" : ""), "aria-selected": String(filter === k),
          onclick: () => { filter = k; renderAll(); }
        }, `${label} (${n})`)));
      clearBtn.hidden = !done;
      renderList();
    }

    root.append(addForm, summary, h("div", { class: "toolbar" }, tabs, sortSel, clearBtn), list);
    renderAll();
  }

  // ---------- Manifestation ----------
  function manifest(root, c) {
    const { h, icon, state, save, toast, uid, todayISO, diffDays, fmt, bar, isISO } = c;
    let shift = 0;
    let editingAffirm = null;
    let editingGoal = null;

    // vision
    const vision = h("textarea", { class: "input vision", rows: "5", maxlength: "2000", placeholder: "Describe the life, business and person you are becoming…", "aria-label": "Vision statement" });
    vision.value = state.manifest.vision;
    const saved = h("span", { class: "small muted", text: "Changes save automatically" });
    vision.addEventListener("input", () => {
      state.manifest.vision = vision.value;
      save();
      saved.textContent = "Saved ✓";
    });

    // affirmations
    const featured = h("div", { class: "affirm-card" });
    const affirmList = h("ul", { class: "mini-list editable" });
    const affirmIn = h("input", { class: "input grow", type: "text", placeholder: "I am disciplined, focused and consistent…", maxlength: "200", "aria-label": "New affirmation" });
    const affirmForm = h("form", {
      class: "row-form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const t = affirmIn.value.trim();
        if (!t) return toast("Write an affirmation first.", "error");
        state.manifest.affirmations.push({ id: uid(), text: t });
        affirmIn.value = "";
        save();
        renderAffirm();
      }
    }, affirmIn, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, icon("plus", 16), "Add"));

    function renderAffirm() {
      const list = state.manifest.affirmations;
      const idx = list.length ? (((diffDays("1970-01-01", todayISO()) + shift) % list.length) + list.length) % list.length : 0;
      featured.replaceChildren(
        h("div", { class: "eyebrow", text: "Today's affirmation" }),
        list.length
          ? h("p", { class: "affirm-text", text: `“${list[idx].text}”` })
          : h("p", { class: "affirm-text faint", text: "Add an affirmation below and it will appear here every day." }),
        list.length > 1 ? h("button", { class: "btn btn-light btn-sm", type: "button", onclick: () => { shift++; renderAffirm(); } }, icon("refresh", 15), "Another one") : null);
      affirmList.replaceChildren(...list.map((a) => {
        if (editingAffirm === a.id) {
          const inp = h("input", { class: "input grow", type: "text", value: a.text, maxlength: "200", "aria-label": "Affirmation text" });
          return h("li", {}, h("form", {
            class: "row-form grow", novalidate: true,
            onsubmit: (e) => {
              e.preventDefault();
              if (!inp.value.trim()) return toast("Affirmation can't be empty.", "error");
              a.text = inp.value.trim();
              editingAffirm = null;
              save();
              renderAffirm();
            }
          }, inp,
          h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { editingAffirm = null; renderAffirm(); } }, "Cancel")));
        }
        return h("li", {},
          h("span", { class: "grow", text: a.text }),
          h("button", { class: "icon-btn", type: "button", "aria-label": `Edit: ${a.text}`, onclick: () => { editingAffirm = a.id; renderAffirm(); } }, icon("edit", 16)),
          h("button", {
            class: "icon-btn danger", type: "button", "aria-label": `Delete: ${a.text}`,
            onclick: () => { state.manifest.affirmations = state.manifest.affirmations.filter((x) => x.id !== a.id); save(); renderAffirm(); }
          }, icon("trash", 16)));
      }));
      if (!list.length) affirmList.replaceChildren(h("li", { class: "muted small" }, "No affirmations yet."));
    }

    // goals
    const goalList = h("ul", { class: "goal-list" });
    const goalProgress = h("div", { class: "goal-progress" });
    const gText = h("input", { class: "input grow", type: "text", placeholder: "Goal, e.g. 50k orders a month", maxlength: "150", "aria-label": "Goal" });
    const gAction = h("input", { class: "input grow", type: "text", placeholder: "Next action, e.g. List 200 SKUs", maxlength: "200", "aria-label": "Next action" });
    const gDate = h("input", { class: "input", type: "date", "aria-label": "Target date (optional)", title: "Target date (optional)" });
    const goalForm = h("form", {
      class: "row-form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        if (!gText.value.trim()) return toast("Write the goal first.", "error");
        if (gDate.value && !isISO(gDate.value)) return toast("Pick a valid target date.", "error");
        state.manifest.goals.push({ id: uid(), text: gText.value.trim(), action: gAction.value.trim(), target: gDate.value, done: false });
        gText.value = gAction.value = gDate.value = "";
        save();
        renderGoals();
      }
    }, gText, gAction, gDate, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, icon("plus", 16), "Add goal"));

    function goalEditRow(g) {
      const t = h("input", { class: "input grow", type: "text", value: g.text, maxlength: "150", "aria-label": "Goal" });
      const a = h("input", { class: "input grow", type: "text", value: g.action, maxlength: "200", "aria-label": "Next action" });
      const d = h("input", { class: "input", type: "date", value: g.target, "aria-label": "Target date" });
      return h("li", { class: "goal editing" }, h("form", {
        class: "row-form", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          if (!t.value.trim()) return toast("Goal can't be empty.", "error");
          if (d.value && !isISO(d.value)) return toast("Pick a valid target date.", "error");
          Object.assign(g, { text: t.value.trim(), action: a.value.trim(), target: d.value });
          editingGoal = null;
          save();
          renderGoals();
        }
      }, t, a, d,
      h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save"),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { editingGoal = null; renderGoals(); } }, "Cancel")));
    }

    function renderGoals() {
      const goals = state.manifest.goals;
      const done = goals.filter((g) => g.done).length;
      goalProgress.replaceChildren(...(goals.length
        ? [h("span", { class: "small muted", text: `${done} of ${goals.length} goals achieved` }), bar(Math.round((done / goals.length) * 100))]
        : []));
      goalList.replaceChildren(...(goals.length ? goals.map((g) => {
        if (editingGoal === g.id) return goalEditRow(g);
        const late = g.target && !g.done && g.target < todayISO();
        return h("li", { class: "goal" + (g.done ? " done" : "") },
          h("button", {
            class: "check" + (g.done ? " on" : ""), type: "button", "aria-pressed": String(g.done),
            "aria-label": `${g.done ? "Mark as not achieved" : "Mark as achieved"}: ${g.text}`,
            onclick: () => { g.done = !g.done; save(); renderGoals(); }
          }, g.done ? icon("check", 14) : null),
          h("div", { class: "todo-main" },
            h("span", { class: "todo-text", text: g.text }),
            g.action ? h("span", { class: "goal-action" }, h("b", { text: "Next: " }), g.action) : null,
            g.target ? h("div", { class: "todo-meta" }, h("span", { class: "badge " + (late ? "late" : "neutral"), text: `${late ? "Past target" : "Target"} · ${fmt(g.target)}` })) : null),
          h("div", { class: "item-actions" },
            h("button", { class: "icon-btn", type: "button", "aria-label": `Edit: ${g.text}`, onclick: () => { editingGoal = g.id; renderGoals(); } }, icon("edit", 16)),
            h("button", {
              class: "icon-btn danger", type: "button", "aria-label": `Delete: ${g.text}`,
              onclick: () => { state.manifest.goals = state.manifest.goals.filter((x) => x.id !== g.id); save(); renderGoals(); }
            }, icon("trash", 16))));
      }) : [h("li", { class: "muted small pad" }, "No goals yet. Turn your vision into a goal with a concrete next action.")]));
    }

    root.append(
      h("section", { class: "card vision-card" },
        h("div", { class: "card-head" }, h("h2", { text: "My vision" }), saved), vision),
      h("div", { class: "split" },
        h("section", { class: "card panel" }, h("h2", { text: "Daily affirmations" }), featured, affirmForm, affirmList),
        h("section", { class: "card panel" }, h("h2", { text: "Actionable goals" }), goalProgress, goalList, goalForm)));
    renderAffirm();
    renderGoals();
  }

  // ---------- Notes ----------
  function notes(root, c) {
    const { h, icon, state, save, toast, uid, emptyState } = c;
    let editing = null; // null | "new" | note id
    let query = "";

    const editorSlot = h("div", {});
    const grid = h("div", { class: "notes-wrap" });
    const search = h("input", { class: "input", type: "search", placeholder: "Search notes…", "aria-label": "Search notes" });
    search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); renderNotes(); });

    function renderEditor() {
      if (editing === null) return editorSlot.replaceChildren();
      const n = editing === "new" ? { title: "", body: "", pinned: false } : state.notes.find((x) => x.id === editing);
      if (!n) { editing = null; return editorSlot.replaceChildren(); }
      const title = h("input", { class: "input", type: "text", value: n.title, maxlength: "80", placeholder: "Title", "aria-label": "Note title" });
      const body = h("textarea", { class: "input", rows: "7", maxlength: "5000", placeholder: "Write your note…", "aria-label": "Note body" });
      body.value = n.body;
      const pin = h("input", { type: "checkbox", checked: n.pinned });
      editorSlot.replaceChildren(h("form", {
        class: "card form-card", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const t = title.value.trim();
          if (!t && !body.value.trim()) return toast("Add a title or some text before saving.", "error");
          if (editing === "new") state.notes.push({ id: uid(), title: t, body: body.value, pinned: pin.checked, updated: Date.now() });
          else Object.assign(n, { title: t, body: body.value, pinned: pin.checked, updated: Date.now() });
          editing = null;
          save();
          renderEditor();
          renderNotes();
          toast("Note saved");
        }
      },
      h("h2", { text: editing === "new" ? "New note" : "Edit note" }), title, body,
      h("div", { class: "row-between" },
        h("label", { class: "check-label" }, pin, " Pin to top"),
        h("div", { class: "row-end" },
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => { editing = null; renderEditor(); } }, "Cancel"),
          h("button", { class: "btn btn-primary", type: "submit" }, "Save note")))));
      title.focus();
    }

    function card(n) {
      return h("article", { class: "card note" + (n.pinned ? " pinned" : "") },
        h("h3", { text: n.title || "Untitled" }),
        h("p", { class: "note-body", text: n.body }),
        h("div", { class: "note-foot" },
          h("span", { class: "small muted", text: `Updated ${new Date(n.updated).toLocaleDateString("en-GB", c.SHORT)}` }),
          h("div", { class: "item-actions" },
            h("button", {
              class: "icon-btn" + (n.pinned ? " on" : ""), type: "button", "aria-pressed": String(n.pinned),
              "aria-label": n.pinned ? "Unpin note" : "Pin note", title: n.pinned ? "Unpin" : "Pin",
              onclick: () => { n.pinned = !n.pinned; save(); renderNotes(); }
            }, icon("pin", 16)),
            h("button", { class: "icon-btn", type: "button", "aria-label": `Edit note: ${n.title || "Untitled"}`, onclick: () => { editing = n.id; renderEditor(); editorSlot.scrollIntoView({ behavior: "smooth", block: "start" }); } }, icon("edit", 16)),
            h("button", {
              class: "icon-btn danger", type: "button", "aria-label": `Delete note: ${n.title || "Untitled"}`,
              onclick: () => {
                if (!confirm("Delete this note?")) return;
                state.notes = state.notes.filter((x) => x.id !== n.id);
                if (editing === n.id) { editing = null; renderEditor(); }
                save();
                renderNotes();
              }
            }, icon("trash", 16)))));
    }

    function renderNotes() {
      if (!state.notes.length) {
        return grid.replaceChildren(emptyState("No notes yet", "Capture ideas, links and reminders you can't afford to forget.", "Write a note", () => { editing = "new"; renderEditor(); }));
      }
      const match = state.notes.filter((n) => !query || (n.title + " " + n.body).toLowerCase().includes(query));
      if (!match.length) return grid.replaceChildren(emptyState("No matches", `Nothing found for "${search.value.trim()}".`));
      match.sort((a, b) => b.pinned - a.pinned || b.updated - a.updated);
      const pinned = match.filter((n) => n.pinned);
      const rest = match.filter((n) => !n.pinned);
      grid.replaceChildren(
        pinned.length ? h("h2", { class: "section-label", text: "Pinned" }) : null,
        pinned.length ? h("div", { class: "notes-grid" }, pinned.map(card)) : null,
        pinned.length && rest.length ? h("h2", { class: "section-label", text: "Others" }) : null,
        rest.length ? h("div", { class: "notes-grid" }, rest.map(card)) : null);
    }

    root.append(
      h("div", { class: "toolbar" },
        h("button", { class: "btn btn-primary", type: "button", onclick: () => { editing = "new"; renderEditor(); } }, icon("plus", 16), "New note"),
        h("div", { class: "search-wrap" }, icon("search", 16), search)),
      editorSlot, grid);
    renderNotes();
  }

  return { todo, manifest, notes };
})();
