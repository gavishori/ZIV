// Investments page: Phoenix policies summary, stored in Firestore at investments/data
// (never in this public repo). Group and overall totals are computed from the policies.
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "₪" + Math.round(Number(n) || 0).toLocaleString("he-IL");
const showDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const NUM_KEYS = new Set(["total", "liquid", "pension"]);
const TRACK_COLS = [["name", "שם מסלול"], ["pct", "אחוז מהתיק"], ["ytd", "תשואה שנה נוכחית"], ["feeDeposit", "ד.נ הפקדה"], ["feeSaving", "ד.נ חיסכון"], ["total", "צבירה"]];

let db, user, ref, data = null, draft = null, unsub = null;

const blankPolicy = () => ({ number: "", product: "", dataDate: "", returnDate: "", total: 0, liquid: 0, extra: [], tracks: [] });

export function startInvestments(firestore, currentUser) {
  db = firestore;
  user = currentUser;
  ref = doc(db, "investments", "data");
  if (unsub) unsub();
  unsub = onSnapshot(ref, (snap) => {
    data = snap.exists() ? snap.data() : null;
    if (!draft) render();
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
  }));
  const sum = (k) => g.reduce((s, x) => s + x[k], 0);
  return { groups: g, total: sum("total"), liquid: sum("liquid"), pension: sum("pension") };
}

// In edit mode every value is an input bound to its path in the draft (e.g. "groups.0.policies.1.total").
function field(path, value, { type = "text", cls = "" } = {}) {
  if (!draft) return null;
  return `<input class="inv-in ${cls}" data-path="${path}" type="${type}" value="${esc(value)}"${type === "number" ? ' step="any"' : ""}>`;
}

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

  const head = `
    <div class="cards inv-cards">
      <div class="card"><span>סה״כ חיסכון</span><b>${money(t.total)}</b></div>
      <div class="card"><span>חיסכון נזיל</span><b>${money(t.liquid)}</b></div>
      <div class="card"><span>קצבה צפויה לגיל פרישה</span><b>${money(t.pension)}</b></div>
    </div>
    <p class="inv-src">מקור: ${edit ? field("source", d.source) : esc(d.source || "")}
      · נכון ל-${edit ? field("asOf", d.asOf, { type: "date" }) : showDate(d.asOf)}</p>`;

  const summary = `
    <h3>סכום צבירה לפי סוגי מוצרים</h3>
    <div class="inv-summary">${(d.groups || []).map((g, gi) => `
      <div class="inv-sum-row">
        <div class="inv-sum-name"><b>${edit ? field(`groups.${gi}.name`, g.name, { cls: "wide" }) : esc(g.name)}</b>
          <small>מעודכן לתאריך ${edit ? field(`groups.${gi}.updated`, g.updated, { type: "date" }) : showDate(g.updated)}</small></div>
        <div><b>${money(t.groups[gi].total)}</b><small>סכום חיסכון</small></div>
        <div><b>${edit ? field(`groups.${gi}.pension`, g.pension || 0, { type: "number" }) : (g.pension ? money(g.pension) : "—")}</b><small>קצבה צפויה לגיל פרישה</small></div>
        <div><b>${money(t.groups[gi].liquid)}</b><small>חיסכון נזיל</small></div>
        ${edit ? `<button type="button" class="danger sm" data-act="delGroup" data-gi="${gi}">מחיקת סוג</button>` : ""}
      </div>`).join("")}
    </div>
    ${edit ? `<button type="button" class="ghost sm" data-act="addGroup">+ סוג מוצר</button>` : ""}`;

  const policies = (d.groups || []).map((g, gi) => `
    <h3>${esc(g.name)} <small>| ${g.policies.length} ${g.policies.length === 1 ? "פוליסה" : "פוליסות"}</small></h3>
    ${g.policies.map((p, pi) => policyCard(p, `groups.${gi}.policies.${pi}`, gi, pi, edit)).join("")}
    ${edit ? `<button type="button" class="ghost sm" data-act="addPolicy" data-gi="${gi}">+ פוליסה ל${esc(g.name)}</button>` : ""}`).join("");

  body.innerHTML = head + summary + `<h3 class="inv-detail-title">פירוט מוצרים</h3>` + policies;
}

function policyCard(p, path, gi, pi, edit) {
  const kv = (label, inner) => `<div class="kv"><small>${label}</small><b>${inner}</b></div>`;
  const extras = (p.extra || []).map((x, xi) => edit
    ? `<div class="kv">${field(`${path}.extra.${xi}.label`, x.label, { cls: "lbl" })}${field(`${path}.extra.${xi}.value`, x.value)}
        <button type="button" class="danger xs" data-act="delExtra" data-path="${path}" data-i="${xi}">✕</button></div>`
    : kv(esc(x.label), esc(x.value))).join("");
  const tracks = p.tracks || [];
  const trackTable = (tracks.length || edit) ? `
    <details class="inv-tracks"${edit ? " open" : ""}>
      <summary>פירוט מסלולי ההשקעה בפוליסה</summary>
      <div class="tablewrap"><table>
        <thead><tr>${TRACK_COLS.map(([, l]) => `<th>${l}</th>`).join("")}${edit ? "<th></th>" : ""}</tr></thead>
        <tbody>${tracks.map((tr, ti) => `<tr>${TRACK_COLS.map(([k]) => {
          const v = tr[k] ?? "";
          if (edit) return `<td>${field(`${path}.tracks.${ti}.${k}`, v, { type: k === "total" ? "number" : "text" })}</td>`;
          const cls = k === "ytd" && String(v).trim().startsWith("-") ? "neg" : "";
          return `<td class="${k === "name" ? "" : "num"} ${cls}">${k === "total" ? money(v) : esc(v)}</td>`;
        }).join("")}${edit ? `<td><button type="button" class="danger xs" data-act="delTrack" data-path="${path}" data-i="${ti}">✕</button></td>` : ""}</tr>`).join("")}</tbody>
      </table></div>
      ${edit ? `<button type="button" class="ghost sm" data-act="addTrack" data-path="${path}">+ מסלול</button>` : ""}
    </details>` : "";

  return `
    <div class="inv-policy">
      <div class="inv-policy-head">
        <span>מספר פוליסה <b class="ltr">${edit ? field(`${path}.number`, p.number) : esc(p.number)}</b></span>
        <span class="muted">| ${edit ? field(`${path}.product`, p.product, { cls: "wide" }) : esc(p.product)}</span>
        ${edit ? `<button type="button" class="danger sm" data-act="delPolicy" data-gi="${gi}" data-pi="${pi}">מחיקת פוליסה</button>` : ""}
      </div>
      <p class="inv-dates">הנתונים מעודכנים ל-${edit ? field(`${path}.dataDate`, p.dataDate, { type: "date" }) : showDate(p.dataDate)}
        | התשואה מעודכנת ל-${edit ? field(`${path}.returnDate`, p.returnDate, { type: "date" }) : showDate(p.returnDate)}</p>
      <div class="inv-grid">
        ${kv("סכום חיסכון", edit ? field(`${path}.total`, p.total, { type: "number" }) : money(p.total))}
        ${kv("חיסכון נזיל", edit ? field(`${path}.liquid`, p.liquid, { type: "number" }) : money(p.liquid))}
        ${extras}
        ${edit ? `<button type="button" class="ghost sm" data-act="addExtra" data-path="${path}">+ שדה</button>` : ""}
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
  if (act === "addGroup") draft.groups.push({ name: "סוג מוצר חדש", updated: "", pension: 0, policies: [] });
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
  draft = structuredClone(data || { source: "הפניקס", asOf: "", groups: [] });
  render();
};
$("invCancelBtn").onclick = () => { draft = null; render(); };
$("invSaveBtn").onclick = async () => {
  try {
    const { updatedAt, updatedBy, ...clean } = draft;
    await setDoc(ref, { ...clean, updatedAt: serverTimestamp(), updatedBy: user.email });
    draft = null;
    render();
  } catch (e) {
    alert("השמירה נכשלה: " + e.message);
  }
};

// One-off load of a JSON file with the same shape (kept outside the repo).
$("invImportBtn").onclick = () => $("invImportFile").click();
$("invImportFile").onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.groups)) throw new Error("חסר groups");
    draft = parsed;
    render();
  } catch (e) {
    alert("הקובץ לא תקין: " + e.message);
  }
};
