// Investments page: Phoenix policies summary, stored in Firestore at investments/data
// (never in this public repo). Group and overall totals and dates are computed from the policies.
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "₪" + Math.round(Number(n) || 0).toLocaleString("he-IL");
const showDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const NUM_KEYS = new Set(["total", "liquid", "pension"]);
const TRACK_COLS = [["name", "שם מסלול"], ["pct", "אחוז מהתיק"], ["ytd", "תשואה שנה נוכחית"], ["feeDeposit", "ד.נ הפקדה"], ["feeSaving", "ד.נ חיסכון"], ["total", "צבירה"]];

let db, user, ref, data = null, draft = null, unsub = null;
let imported = new WeakSet(); // policies that came from an imported file in this edit session

const blankPolicy = () => ({ number: "", product: "", dataDate: "", returnDate: "", total: 0, liquid: 0, extra: [], tracks: [] });
// A policy's own values without its dates, to tell whether it was edited.
const policyValues = ({ dataDate, returnDate, ...rest }) => JSON.stringify(rest);

export function startInvestments(firestore, currentUser, docId = "data") {
  db = firestore;
  user = currentUser;
  ref = doc(db, "investments", docId);
  if (unsub) unsub();
  data = draft = null;
  $("invBody").innerHTML = `<p class="soon">טוען…</p>`;
  unsub = onSnapshot(ref, (snap) => {
    data = snap.exists() ? snap.data() : null;
    if (!draft) render();
    window.dispatchEvent(new CustomEvent("ziv:data", { detail: { kind: "investments", data } }));
  }, (err) => {
    $("invBody").innerHTML = `<p class="err">שגיאה בטעינת ההשקעות: ${esc(err.message)}</p>`;
  });
}
export function stopInvestments() {
  if (unsub) unsub();
  unsub = null;
  data = draft = null;
}

function totals(groups) {
  const g = groups.map((gr) => ({
    total: gr.policies.reduce((s, p) => s + (Number(p.total) || 0), 0),
    liquid: gr.policies.reduce((s, p) => s + (Number(p.liquid) || 0), 0),
    pension: Number(gr.pension) || 0,
    // A product type is as fresh as its newest policy.
    updated: gr.policies.map((p) => p.dataDate || "").sort().pop() || "",
  }));
  const sum = (k) => g.reduce((s, x) => s + x[k], 0);
  return { groups: g, total: sum("total"), liquid: sum("liquid"), pension: sum("pension"),
    asOf: g.map((x) => x.updated).sort().pop() || "" };
}

// In edit mode each editable value is an input bound to its path in the draft
// (e.g. "groups.0.policies.1.total"). Dates are never edited: they come with the loaded
// data, and a policy changed by hand is stamped with the day it is saved.
function field(path, value, { type = "text", cls = "", ph = "" } = {}) {
  return `<input class="inv-in ${cls}" data-path="${path}" type="${type}" value="${esc(value)}"` +
    `${type === "number" ? ' step="any" inputmode="decimal"' : ""}${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
}
const del = (attrs, title) => `<button type="button" class="icon-del" ${attrs} title="${title}" aria-label="${title}">✕</button>`;

function render() {
  const d = draft || data;
  const body = $("invBody");
  $("invEditBtn").hidden = !!draft;
  $("invEditBar").hidden = !draft;
  if (!d) {
    body.innerHTML = `<p class="soon">עדיין אין נתונים. לחצו ״עריכה״ כדי להזין, או ייבאו קובץ נתונים.</p>`;
    return;
  }
  const t = totals(d.groups || []);
  const edit = !!draft;
  body.classList.toggle("editing", edit);

  const head = `
    <div class="cards inv-cards">
      <div class="card"><span>סה״כ חיסכון</span><b>${money(t.total)}</b></div>
      <div class="card"><span>חיסכון נזיל</span><b>${money(t.liquid)}</b></div>
      <div class="card"><span>קצבה צפויה לגיל פרישה</span><b>${money(t.pension)}</b></div>
    </div>
    <p class="inv-src">${esc(d.source || "הפניקס")}${t.asOf ? ` · נכון ל-${showDate(t.asOf)}` : ""}</p>`;

  const summary = `
    <h3>סכום צבירה לפי סוגי מוצרים</h3>
    <div class="inv-summary">${(d.groups || []).map((g, gi) => `
      <div class="inv-sum-row">
        <div class="inv-sum-name">
          ${edit ? field(`groups.${gi}.name`, g.name, { cls: "name", ph: "שם סוג המוצר" }) : `<b>${esc(g.name)}</b>`}
          ${t.groups[gi].updated ? `<small>מעודכן לתאריך ${showDate(t.groups[gi].updated)}</small>` : ""}
        </div>
        <div class="kv"><small>סכום חיסכון</small><b>${money(t.groups[gi].total)}</b></div>
        <div class="kv"><small>קצבה צפויה לגיל פרישה</small>${edit ? field(`groups.${gi}.pension`, g.pension || 0, { type: "number" }) : `<b>${g.pension ? money(g.pension) : "—"}</b>`}</div>
        <div class="kv"><small>חיסכון נזיל</small><b>${money(t.groups[gi].liquid)}</b></div>
        ${edit ? del(`data-act="delGroup" data-gi="${gi}"`, "מחיקת סוג המוצר") : ""}
      </div>`).join("")}
    </div>
    ${edit ? `<button type="button" class="add-btn" data-act="addGroup">+ סוג מוצר</button>` : ""}`;

  const policies = (d.groups || []).map((g, gi) => `
    <h4>${esc(g.name)} <small>| ${g.policies.length} ${g.policies.length === 1 ? "פוליסה" : "פוליסות"}</small></h4>
    ${g.policies.map((p, pi) => policyCard(p, `groups.${gi}.policies.${pi}`, gi, pi, edit)).join("")}
    ${edit ? `<button type="button" class="add-btn" data-act="addPolicy" data-gi="${gi}">+ פוליסה</button>` : ""}`).join("");

  body.innerHTML = head + summary + `<h3>פירוט מוצרים</h3>` + policies;
}

function policyCard(p, path, gi, pi, edit) {
  const kv = (label, inner) => `<div class="kv"><small>${label}</small>${inner}</div>`;
  const val = (inner) => `<b>${inner}</b>`;
  const extras = (p.extra || []).map((x, xi) => edit
    ? `<div class="kv kv-edit">${field(`${path}.extra.${xi}.label`, x.label, { cls: "lbl", ph: "שם השדה" })}${field(`${path}.extra.${xi}.value`, x.value, { ph: "ערך" })}
        ${del(`data-act="delExtra" data-path="${path}" data-i="${xi}"`, "מחיקת השדה")}</div>`
    : kv(esc(x.label), val(esc(x.value)))).join("");
  const tracks = p.tracks || [];
  const trackTable = (tracks.length || edit) ? `
    <details class="inv-tracks"${edit ? " open" : ""}>
      <summary>פירוט מסלולי ההשקעה בפוליסה</summary>
      ${tracks.length ? `<div class="tablewrap"><table>
        <thead><tr>${TRACK_COLS.map(([, l]) => `<th>${l}</th>`).join("")}${edit ? "<th></th>" : ""}</tr></thead>
        <tbody>${tracks.map((tr, ti) => `<tr>${TRACK_COLS.map(([k]) => {
          const v = tr[k] ?? "";
          if (edit) return `<td>${field(`${path}.tracks.${ti}.${k}`, v, { type: k === "total" ? "number" : "text" })}</td>`;
          const cls = k === "ytd" && String(v).trim().startsWith("-") ? "neg" : "";
          return `<td class="${k === "name" ? "" : "num"} ${cls}">${k === "total" ? money(v) : esc(v)}</td>`;
        }).join("")}${edit ? `<td>${del(`data-act="delTrack" data-path="${path}" data-i="${ti}"`, "מחיקת המסלול")}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>` : ""}
      ${edit ? `<button type="button" class="add-btn" data-act="addTrack" data-path="${path}">+ מסלול</button>` : ""}
    </details>` : "";
  const dates = [p.dataDate && `הנתונים מעודכנים ל-${showDate(p.dataDate)}`, p.returnDate && `התשואה מעודכנת ל-${showDate(p.returnDate)}`]
    .filter(Boolean).join(" | ");

  return `
    <div class="inv-policy">
      ${edit ? del(`data-act="delPolicy" data-gi="${gi}" data-pi="${pi}"`, "מחיקת הפוליסה") : ""}
      <div class="inv-policy-head">
        ${edit
          ? `<label class="inline">מספר פוליסה ${field(`${path}.number`, p.number, { cls: "polnum" })}</label>
             <label class="inline grow">מוצר ${field(`${path}.product`, p.product, { cls: "name" })}</label>`
          : `<span>מספר פוליסה <b class="ltr">${esc(p.number)}</b></span><span class="muted">| ${esc(p.product)}</span>`}
      </div>
      ${dates ? `<p class="inv-dates">${dates}</p>` : ""}
      <div class="inv-grid">
        ${kv("סכום חיסכון", edit ? field(`${path}.total`, p.total, { type: "number" }) : val(money(p.total)))}
        ${kv("חיסכון נזיל", edit ? field(`${path}.liquid`, p.liquid, { type: "number" }) : val(money(p.liquid)))}
        ${extras}
        ${edit ? `<button type="button" class="add-btn in-grid" data-act="addExtra" data-path="${path}">+ שדה</button>` : ""}
      </div>
      ${trackTable}
    </div>`;
}

// ---------- editing ----------
const getAt = (obj, path) => path.split(".").reduce((o, k) => o[k], obj);
function setAt(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.length ? getAt(obj, keys.join(".")) : obj;
  parent[last] = NUM_KEYS.has(last) ? Number(value) || 0 : value;
}

$("invBody").addEventListener("input", (ev) => {
  const p = ev.target.dataset?.path;
  if (draft && p && ev.target.classList.contains("inv-in")) setAt(draft, p, ev.target.value);
});
$("invBody").addEventListener("change", (ev) => {
  // Re-render after a number changes so computed totals update.
  if (draft && ev.target.type === "number") render();
});
$("invBody").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-act]");
  if (!b || !draft) return;
  const { act, gi, pi, path, i } = b.dataset;
  if (act === "addGroup") draft.groups.push({ name: "", pension: 0, policies: [] });
  if (act === "delGroup" && confirm("למחוק את סוג המוצר וכל הפוליסות שלו?")) draft.groups.splice(gi, 1);
  if (act === "addPolicy") draft.groups[gi].policies.push(blankPolicy());
  if (act === "delPolicy" && confirm("למחוק את הפוליסה?")) draft.groups[gi].policies.splice(pi, 1);
  if (act === "addExtra") (getAt(draft, path).extra ||= []).push({ label: "", value: "" });
  if (act === "delExtra") getAt(draft, path).extra.splice(i, 1);
  if (act === "addTrack") (getAt(draft, path).tracks ||= []).push({ name: "", pct: "", ytd: "", feeDeposit: "", feeSaving: "", total: 0 });
  if (act === "delTrack") getAt(draft, path).tracks.splice(i, 1);
  render();
});

$("invEditBtn").onclick = () => {
  draft = structuredClone(data || { source: "הפניקס", groups: [] });
  imported = new WeakSet();
  render();
};
$("invCancelBtn").onclick = () => { draft = null; render(); };
$("invSaveBtn").onclick = () => save();
async function save() {
  try {
    const { updatedAt, updatedBy, asOf, ...clean } = draft;
    // Imported policies keep their own dates; a policy changed by hand gets today's date.
    const before = new Map((data?.groups || []).flatMap((g) => g.policies).map((p) => [p.number, policyValues(p)]));
    for (const g of clean.groups) {
      delete g.updated;
      for (const p of g.policies) {
        if (!imported.has(p) && before.get(p.number) !== policyValues(p)) {
          p.dataDate = today();
          p.returnDate = "";
        }
      }
    }
    await setDoc(ref, { ...clean, updatedAt: serverTimestamp(), updatedBy: user.email });
    draft = null;
    render();
    showToast("נשמר");
  } catch (e) {
    alert("השמירה נכשלה: " + e.message);
  }
}
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 2500);
}

// Load a JSON file with the same shape (kept outside the repo); its dates are kept as is.
$("invImportBtn").onclick = () => $("invImportFile").click();
$("invImportFile").onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.groups)) throw new Error("חסר groups");
    // An import is saved right away, so the data stays until the next update.
    if (data && !confirm("הנתונים מהקובץ יחליפו את הנתונים השמורים. להמשיך?")) return;
    draft = parsed;
    imported = new WeakSet(parsed.groups.flatMap((g) => g.policies || []));
    await save();
  } catch (e) {
    alert("הקובץ לא תקין: " + e.message);
  }
};

// Don't lose unsaved edits by closing or reloading the page.
window.addEventListener("beforeunload", (ev) => {
  if (draft) ev.preventDefault();
});
