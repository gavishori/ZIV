// Extra tabs that only the owner sees. Their content (and even their names) lives in Firestore at
// owner/tabs-<person> (field "json"), which the rules let only the owner read; nothing about them is in this repo.
// Each tab: { id, title, icon, html, questions: [{ id, t, a, p, src: [row indexes] }], tx: [rows], cols }.
// Answers to the questions are saved to owner/answers-<person> as they are typed.
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { OWNER_EMAIL } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => (n < 0 ? "-" : "") + "₪" + Math.abs(Number(n) || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });
const dmy = (d) => d ? d.split("-").reverse().join(".") : "";

let added = [];
let loadToken = 0;

export function clearOwnerTabs() {
  loadToken++;
  added.forEach((el) => el.remove());
  added = [];
}

export async function loadOwnerTabs(db, user, person) {
  clearOwnerTabs();
  if (user?.email !== OWNER_EMAIL) return;
  const token = loadToken;
  let tabs, answers = {};
  try {
    tabs = JSON.parse((await getDoc(doc(db, "owner", `tabs-${person}`))).data()?.json || "{}").tabs || [];
    answers = (await getDoc(doc(db, "owner", `answers-${person}`))).data()?.answers || {};
  } catch { return; }
  if (token !== loadToken) return; // switched person meanwhile
  const nav = $("sideNav"), foot = nav.querySelector(".side-nav-foot"), layout = $("appView");
  for (const tab of tabs) {
    const view = `x-${tab.id}`;
    const btn = document.createElement("button");
    btn.dataset.view = view;
    btn.textContent = `${tab.icon || "🔒"} ${tab.title}`;
    btn.title = "רק אתה רואה את הלשונית הזו";
    btn.onclick = () => window.dispatchEvent(new CustomEvent("ziv:show", { detail: view }));
    nav.insertBefore(btn, foot);
    const panel = document.createElement("main");
    panel.className = "panel view-panel xtab";
    panel.dataset.view = view;
    panel.innerHTML = `
      <div class="panel-head"><h2>${esc(tab.icon || "🔒")} ${esc(tab.title)} <span class="lock" title="רק אתה רואה את הלשונית הזו">🔒 רק לך</span></h2>
        <span class="snap-date">${tab.asOf ? "נכון ל-" + dmy(tab.asOf) : ""}</span></div>
      <div class="xtab-body">${tab.html || ""}</div>
      ${questionsHtml(tab, answers)}`;
    layout.appendChild(panel);
    added.push(btn, panel);
    wire(panel, tab, answers, db, person);
  }
}

function questionsHtml(tab, answers) {
  const qs = tab.questions || [];
  if (!qs.length) return "";
  return `
    <h3 class="snap-h" id="x-${tab.id}-q">שאלות פתוחות <small class="q-count"></small></h3>
    <p class="hint">כל תשובה נשמרת אוטומטית. כדי שהתשובות ייכנסו לניתוח, לוחצים ״העתקת כל התשובות״ ומדביקים ל-Claude.</p>
    <div class="q-list">${qs.map((q, i) => `
      <div class="q-card${(answers[q.id] || "").trim() ? " done" : ""}" id="q-${esc(q.id)}">
        <div class="q-head"><b>${i + 1}. ${esc(q.t)}</b><span class="q-st"></span></div>
        ${q.a ? `<div class="q-amt">${esc(q.a)}</div>` : ""}
        <p>${esc(q.p)}</p>
        ${q.src?.length ? `<button type="button" class="linklike q-src" data-q="${esc(q.id)}">${q.src.length} תנועות שהשאלה מבוססת עליהן ›</button><div class="q-rows" hidden></div>` : ""}
        <textarea data-q="${esc(q.id)}" placeholder="התשובה שלך…">${esc(answers[q.id] || "")}</textarea>
      </div>`).join("")}
    </div>
    <button type="button" class="ghost q-copy">📋 העתקת כל התשובות</button>`;
}

function rowsTable(tab, idx) {
  const rows = idx.map((i) => tab.tx[i]).filter(Boolean);
  const sum = rows.reduce((s, r) => s + r.a, 0);
  return `<div class="tablewrap"><table class="xt"><thead><tr><th>תאריך</th><th>פעולה</th><th>פרטים</th><th class="num">סכום</th><th class="num">יתרה</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${dmy(r.d)}</td><td>${esc(r.o)}</td><td>${esc(r.w)}</td>
      <td class="num ${r.a < 0 ? "neg" : "pos"}">${money(r.a)}</td><td class="num">${money(r.b)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3">סה״כ ${rows.length}</td><td class="num">${money(sum)}</td><td></td></tr></tfoot></table></div>`;
}

function wire(panel, tab, answers, db, person) {
  const ref = doc(db, "owner", `answers-${person}`);
  let timer;
  const refresh = () => {
    let done = 0;
    panel.querySelectorAll(".q-card").forEach((c) => {
      const has = (answers[c.id.slice(2)] || "").trim().length > 0;
      done += has;
      c.classList.toggle("done", has);
      c.querySelector(".q-st").textContent = has ? "✓ נענה" : "ממתין לתשובה";
    });
    const cnt = panel.querySelector(".q-count");
    if (cnt) cnt.textContent = `(${done}/${(tab.questions || []).length} נענו)`;
  };
  refresh();
  panel.addEventListener("input", (ev) => {
    const q = ev.target.dataset?.q;
    if (!q || ev.target.tagName !== "TEXTAREA") return;
    answers[q] = ev.target.value;
    refresh();
    clearTimeout(timer);
    timer = setTimeout(() => setDoc(ref, { answers, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {}), 700);
  });
  panel.addEventListener("click", async (ev) => {
    const src = ev.target.closest(".q-src");
    if (src) {
      const box = src.nextElementSibling;
      if (box.hidden) box.innerHTML = rowsTable(tab, tab.questions.find((q) => q.id === src.dataset.q).src);
      box.hidden = !box.hidden;
      return;
    }
    if (ev.target.closest(".q-copy")) {
      const text = (tab.questions || []).map((q, i) => `${i + 1}. ${q.t}\n${(answers[q.id] || "").trim() || "(אין תשובה)"}`).join("\n\n");
      try { await navigator.clipboard.writeText(text); ev.target.textContent = "הועתק ✓"; } catch { prompt("העתיקו:", text); }
      setTimeout(() => (ev.target.textContent = "📋 העתקת כל התשובות"), 2000);
      return;
    }
    // An insight points at a section ("month", "cats") or a question ("q:<id>").
    const go = ev.target.closest("[data-go]");
    if (go) {
      const dest = go.dataset.go;
      const el = dest.startsWith("q:") ? panel.querySelector(`#q-${CSS.escape(dest.slice(2))}`) : panel.querySelector(`#x-${dest}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 2600);
      }
      return;
    }
    // A row in a summary table shows the rows behind it.
    const tr = ev.target.closest("tr[data-cat]");
    if (tr) {
      const next = tr.nextElementSibling;
      if (next?.classList.contains("x-detail")) { next.remove(); return; }
      const idx = tab.tx.map((r, i) => (r.c === tr.dataset.cat ? i : -1)).filter((i) => i >= 0);
      const row = document.createElement("tr");
      row.className = "x-detail";
      row.innerHTML = `<td colspan="${tr.children.length}">${rowsTable(tab, idx)}</td>`;
      tr.after(row);
    }
  });
}
