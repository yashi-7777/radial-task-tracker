/* Study Planner: conversational assistant. Replies come from the server's AI; proposed plan changes need a click to apply. */
window.StudyChat = (() => {
  "use strict";

  const SUGGESTIONS = ["What should I study next?", "I missed some sessions. What do you suggest?", "Explain the hardest topic in my syllabus", "Which topics are likely most important?"];

  function render(core, p) {
    const { ctx, SP, PL, backend, view } = core;
    const { h, icon, toast } = ctx;
    const box = h("section", { class: "card panel chat" });

    if (!backend.ok || !backend.ai || (backend.authRequired && !backend.authorized)) {
      const why = !backend.ok
        ? "The planner server is not connected."
        : backend.authRequired && !backend.authorized ? "The server needs your access token." : "AI is not configured on the server.";
      box.append(
        h("h2", { text: "AI assistant" }),
        h("div", { class: "alert warn" }, icon("alert", 18), h("div", {}, h("strong", { text: `The assistant is unavailable. ${why}` }),
          h("ol", { class: "small steps" },
            h("li", { text: "Run the planner server (npm install, then npm start) or deploy it." }),
            h("li", { text: "Set ANTHROPIC_API_KEY in the server's .env file and restart it." }),
            h("li", { text: "If the app is on GitHub Pages, put the server's URL (and access token) in Connection settings above." })))),
        h("p", { class: "muted small", text: "Everything else in the planner (plans, calendar, rescheduling, progress) works without AI." }));
      return box;
    }

    const list = h("div", { class: "chat-log", role: "log", "aria-live": "polite" });
    const input = h("textarea", { class: "input chat-input", rows: "2", maxlength: "2000", placeholder: "Ask about your syllabus or your plan…", "aria-label": "Message the assistant" });
    const send = h("button", { class: "btn btn-primary", type: "submit", "aria-label": "Send" }, icon("spark", 16), "Send");
    let error = "";

    const applyAction = (a) => {
      const r = () => {
        const res = core.reflow(p);
        if (res.errors && res.errors.length) { toast(res.errors[0], "error"); return false; }
        return true;
      };
      let ok = false;
      if (a.tool === "reschedule_missed") ok = r();
      else if (a.tool === "set_daily_hours") {
        p.config = PL.sanitizeConfig({ ...p.config, hoursPerDay: a.input.hours }, ctx.todayISO());
        ok = r();
      } else if (a.tool === "extend_deadline") {
        const d = a.input.date;
        if (!ctx.isISO(d) || d <= PL.resolveEnd(p.config)) { toast("That date isn't later than your current deadline.", "error"); return; }
        if (ctx.diffDays(p.config.startDate, d) + 1 > PL.MAX_DAYS) { toast("That is too far out for one plan.", "error"); return; }
        p.config = PL.sanitizeConfig({ ...p.config, mode: "date", endDate: d }, ctx.todayISO());
        ok = r();
      } else if (a.tool === "mark_topic_complete") {
        const t = PL.findTopic(p.syllabus, a.input.topic);
        if (!t) { toast(`Couldn't find a topic called "${a.input.topic}".`, "error"); return; }
        ok = PL.markTopicComplete(p, t.id);
        if (ok) p.schedule.sessions = p.schedule.sessions.slice();
      }
      if (!ok) return;
      a.applied = true;
      core.syncRadial(p);
      ctx.save();
      toast("Plan updated");
      core.rerender();
    };

    function draw() {
      const kids = [];
      if (!p.chat.length) {
        kids.push(h("div", { class: "chat-empty" }, h("p", { class: "muted", text: "Ask about topics in your syllabus, what to study next, or how to adjust the plan. Answers about the syllabus come only from your uploaded text; anything outside it is labelled." }),
          h("div", { class: "chips wrap" }, SUGGESTIONS.map((s) => h("button", { type: "button", class: "chip", onclick: () => ask(s) }, s)))));
      }
      p.chat.forEach((m) => {
        kids.push(h("div", { class: `msg ${m.role}` }, h("div", { class: "bubble" }, ...m.content.split(/\n{2,}/).map((para) => h("p", { text: para }))),
          m.actions && m.actions.length ? h("div", { class: "actions" }, m.actions.map((a) => a.applied
            ? h("span", { class: "badge ok", text: `Applied: ${a.label}` })
            : h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => applyAction(a) }, icon("check", 14), a.label))) : null));
      });
      if (view.chatBusy) kids.push(h("div", { class: "msg assistant" }, h("div", { class: "bubble typing" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Thinking…")));
      if (error) kids.push(h("div", { class: "alert error", role: "alert" }, icon("alert", 18), h("div", {}, error)));
      list.replaceChildren(...kids);
      list.scrollTop = list.scrollHeight;
      send.disabled = view.chatBusy;
      input.disabled = view.chatBusy;
    }

    async function ask(text) {
      const t = (text || input.value).trim();
      if (!t || view.chatBusy) return;
      error = "";
      p.chat.push({ role: "user", content: t.slice(0, 2000), actions: [] });
      p.chat = p.chat.slice(-40);
      input.value = "";
      view.chatBusy = true;
      ctx.save();
      draw();
      try {
        const r = await core.api("/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: p.chat.slice(-12).map((m) => ({ role: m.role, content: m.content })),
            syllabusText: (p.rawText || SP.toText(p.syllabus)).slice(0, 60000), planSummary: core.planSummary(p), today: ctx.todayISO()
          })
        });
        p.chat.push({ role: "assistant", content: r.reply, actions: (r.actions || []).map((a) => ({ ...a, applied: false })) });
        p.chat = p.chat.slice(-40);
      } catch (e) {
        error = e.message;
      }
      view.chatBusy = false;
      ctx.save();
      if (box.isConnected) draw();
    }

    const form = h("form", { class: "chat-form", onsubmit: (e) => { e.preventDefault(); ask(); } }, input, send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
    box.append(
      h("div", { class: "row-between" }, h("h2", { text: "AI assistant" }),
        p.chat.length ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { if (confirm("Clear this conversation?")) { p.chat = []; ctx.save(); draw(); } } }, "Clear") : null),
      list, form, h("p", { class: "hint", text: `Answers use your uploaded syllabus text and plan progress.${backend.model ? ` Model: ${backend.model}.` : ""} Plan changes are only proposals until you apply them.` }));
    draw();
    return box;
  }

  return { render };
})();
