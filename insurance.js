// Insurance page: the "Har HaBituach" summary, stored in Firestore at insurance/data
// (never in this public repo). Counts and premium totals are computed from the rows.
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n, digits = 2) => "₪" + (Number(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const monthNow = () => { const d = new Date(); return `${d.getMonth() + 1}/${d.getFullYear()}`; };
const COMPANIES = ["הראל", "מגדל", "הפניקס", "כלל", "מנורה", "הכשרה", "איילון", "AIG", "ביטוח ישיר"];
const ICONS = { teal: "🏠", orange: "🩺", green: "👨‍👩‍👧" };
const FREQS = ["חודשית", "שנתית", "חד פעמית"];
// Monthly cost of a row: annual premiums are spread over 12 months; one-time payments aren't recurring.
const monthly = (r) => r.freq === "חד פעמית" ? 0 : (Number(r.premium) || 0) / (r.freq === "שנתית" ? 12 : 1);

let user, ref, data = null, draft = null, unsub = null;

export function startInsurance(db, currentUser, docId = "data") {
  user = currentUser;
  ref = doc(db, "insurance", docId);
  if (unsub) unsub();
  data = draft = null;
  $("insBody").innerHTML = `<p class="soon">טוען…</p>`;
  unsub = onSnapshot(ref, (snap) => {
    data = snap.exists() ? snap.data() : null;
    if (!draft) render();
    window.dispatchEvent(new CustomEvent("ziv:data", { detail: { kind: "insurance", data } }));
  }, (err) => {
    $("insBody").innerHTML = `<p class="err">שגיאה בטעינת הביטוחים: ${esc(err.message)}</p>`;
  });
}
export function stopInsurance() {
  if (unsub) unsub();
  unsub = null;
  data = draft = null;
}

const rowsOf = (cat) => cat.sections.flatMap((s) => s.rows);
const sumMonthly = (rows) => rows.reduce((s, r) => s + monthly(r), 0);

function field(path, value, { type = "text", cls = "", ph = "", list = "" } = {}) {
  return `<input class="inv-in ${cls}" data-path="${path}" type="${type}" value="${esc(value)}"` +
    `${type === "number" ? ' step="any" inputmode="decimal"' : ""}${ph ? ` placeholder="${esc(ph)}"` : ""}${list ? ` list="${list}"` : ""}>`;
}

function render() {
  const d = draft || data;
  const body = $("insBody");
  $("insEditBtn").hidden = !!draft;
  $("insEditBar").hidden = !draft;
  if (!d) {
    body.innerHTML = `<p class="soon">עדיין אין נתונים. לחצו ״ייבוא קובץ נתונים״.</p>`;
    return;
  }
  const edit = !!draft;
  body.classList.toggle("editing", edit);
  const cats = d.categories || [];
  const all = cats.flatMap(rowsOf);

  // Monthly premiums by company, biggest first.
  const byCompany = {};
  for (const r of all) byCompany[r.company || "—"] = (byCompany[r.company || "—"] || 0) + monthly(r);
  const companies = Object.entries(byCompany).sort((a, b) => b[1] - a[1]);

  const head = `
    <div class="ins-rings">${cats.map((c, ci) => `
      <a class="ins-ring ${esc(c.color)}" href="#ins-cat-${ci}">
        <span class="ring-icon">${ICONS[c.color] || "📄"}</span>
        <span class="ring-name">${esc(c.name)}</span>
        <span class="ring-count">${rowsOf(c).length}</span>
      </a>`).join("")}
    </div>
    <div class="cards ins-cards">
      <div class="card main"><span>סה״כ פרמיות בחודש</span><b>${money(sumMonthly(all))}</b></div>
      <div class="card"><span>סה״כ בשנה</span><b>${money(sumMonthly(all) * 12, 0)}</b></div>
      <div class="card ins-companies"><span>לפי חברה (לחודש)</span>
        ${companies.map(([n, v]) => `<div><i class="co ${coClass(n)}">${esc(n)}</i><b>${money(v)}</b></div>`).join("")}
      </div>
    </div>
    <p class="inv-src">${esc(d.source || "הר הביטוח")}${d.asOf ? ` · מעודכן ל-${esc(d.asOf)}` : ""}</p>`;

  const sections = cats.map((c, ci) => `
    <section class="ins-cat ${esc(c.color)}" id="ins-cat-${ci}">
      <h3>${esc(c.name)} <small>${c.updated ? `מעודכן ל: ${esc(c.updated)}` : ""} · ${money(sumMonthly(rowsOf(c)))} לחודש</small></h3>
      <div class="ins-table">
        <div class="ins-row ins-th"><span>סוג</span><span>תקופת הביטוח</span><span>פרמיה</span><span>מס׳ פוליסה</span><span>חברה</span></div>
        ${c.sections.map((s, si) => `
          <div class="ins-sec">${esc(s.name)} <small>${s.rows.length}</small></div>
          ${s.rows.map((r, ri) => row(r, `categories.${ci}.sections.${si}.rows.${ri}`, ci, si, ri, edit)).join("")}
          ${edit ? `<button type="button" class="add-btn" data-act="addRow" data-ci="${ci}" data-si="${si}">+ פוליסה ל${esc(s.name)}</button>` : ""}`).join("")}
      </div>
    </section>`).join("");

  body.innerHTML = head + sections + `<datalist id="coList">${COMPANIES.map((c) => `<option value="${c}">`).join("")}</datalist>`;
}

function coClass(name) {
  return { "הראל": "harel", "מגדל": "migdal", "הפניקס": "phoenix", "כלל": "clal", "מנורה": "menora", "הכשרה": "hachshara" }[name] || "";
}

function row(r, path, ci, si, ri, edit) {
  if (edit) {
    return `<div class="ins-row edit">
      <span>${field(`${path}.type`, r.type, { ph: "סוג הכיסוי" })}${field(`${path}.note`, r.note || "", { cls: "note-in", ph: "פרטים נוספים" })}</span>
      <span>${field(`${path}.period`, r.period, { ph: "מתחדש / 01/01/2026-31/12/2026" })}</span>
      <span class="prem-edit">${field(`${path}.premium`, r.premium, { type: "number" })}
        <select class="inv-in" data-path="${path}.freq">${FREQS.map((f) => `<option${(r.freq || "חודשית") === f ? " selected" : ""}>${f}</option>`).join("")}</select></span>
      <span>${field(`${path}.policy`, r.policy, { cls: "ltr-in" })}</span>
      <span>${field(`${path}.company`, r.company, { list: "coList" })}</span>
      <button type="button" class="icon-del" data-act="delRow" data-ci="${ci}" data-si="${si}" data-ri="${ri}" title="מחיקת הפוליסה" aria-label="מחיקת הפוליסה">✕</button>
    </div>`;
  }
  return `<div class="ins-row">
    <span class="ins-type">${esc(r.type)}${r.note ? `<small>${esc(r.note)}</small>` : ""}</span>
    <span class="ins-period" data-label="תקופה">${esc(r.period)}</span>
    <span class="ins-prem" data-label="פרמיה"><b>${money(r.premium)}</b><small>${esc(r.freq || "חודשית")}</small></span>
    <span class="ins-pol ltr" data-label="פוליסה">${esc(r.policy)}</span>
    <span data-label="חברה"><i class="co ${coClass(r.company)}">${esc(r.company)}</i></span>
  </div>`;
}

// ---------- editing ----------
const getAt = (obj, path) => path.split(".").reduce((o, k) => o[k], obj);
function setAt(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  getAt(obj, keys.join("."))[last] = last === "premium" ? Number(value) || 0 : value;
}

$("insBody").addEventListener("input", (ev) => {
  const p = ev.target.dataset?.path;
  if (draft && p) setAt(draft, p, ev.target.value);
});
$("insBody").addEventListener("change", (ev) => {
  const p = ev.target.dataset?.path;
  if (draft && p) { setAt(draft, p, ev.target.value); if (/premium|freq/.test(p)) render(); }
});
$("insBody").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-act]");
  if (!b || !draft) return;
  const { act, ci, si, ri } = b.dataset;
  const rows = draft.categories[ci].sections[si].rows;
  if (act === "addRow") rows.push({ type: "", period: "", premium: 0, freq: "חודשית", policy: "", company: "" });
  if (act === "delRow" && confirm("למחוק את הפוליסה?")) rows.splice(ri, 1);
  render();
});

$("insEditBtn").onclick = () => { draft = structuredClone(data); render(); };
$("insCancelBtn").onclick = () => { draft = null; render(); };
$("insSaveBtn").onclick = () => save(false);

async function save(isImport) {
  try {
    const { updatedAt, updatedBy, ...clean } = draft;
    if (!isImport) {
      // A category edited by hand is marked as updated this month.
      const before = new Map((data?.categories || []).map((c) => [c.name, JSON.stringify(c.sections)]));
      for (const c of clean.categories) {
        if (before.get(c.name) !== JSON.stringify(c.sections)) c.updated = monthNow();
      }
    }
    await setDoc(ref, { ...clean, updatedAt: serverTimestamp(), updatedBy: user.email });
    draft = null;
    render();
    const t = $("toast");
    t.textContent = "נשמר";
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 2500);
  } catch (e) {
    alert("השמירה נכשלה: " + e.message);
  }
}

// Importing a JSON file (kept outside the repo) saves it right away.
$("insImportBtn").onclick = () => $("insImportFile").click();
$("insImportFile").onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.categories)) throw new Error("חסר categories");
    if (data && !confirm("הנתונים מהקובץ יחליפו את הנתונים השמורים. להמשיך?")) return;
    draft = parsed;
    await save(true);
  } catch (e) {
    alert("הקובץ לא תקין: " + e.message);
  }
};

window.addEventListener("beforeunload", (ev) => {
  if (draft) ev.preventDefault();
});
