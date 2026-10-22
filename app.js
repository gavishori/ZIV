import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, deleteDoc, getDocs,
  writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const entriesCol = collection(db, "entries");

const $ = (id) => document.getElementById(id);
const TENANT_CATS = ["ועד", "מים", "חשמל", "ארנונה", "גז", "אחר"];
const LEDGER_CATS = ["שכ״ד", "תיקונים", "ריהוט וציוד", "ועד", "ארנונה", "ניקיון", "אחר"];
const PAY_LABELS = { card0616: "💳 כרטיס 0616", cash: "💵 מזומן", other: "אחר" };

let user = null;
let entries = [];
let unsubEntries = null;
let tab = "ledger";
let sortDir = 1;
let editing = null;

// ---------- helpers ----------
const fmt = (n) => (n < 0 ? "-" : "") + "₪" + Math.abs(n).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const showDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const round2 = (n) => Math.round(n * 100) / 100;

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
}

// "02.03.2026", a JS Date or an Excel serial -> "2026-03-02" ("" when not a date).
function parseDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "number") return parseDate(new Date(Math.round((v - 25569) * 864e5)));
  const m = String(v).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// ---------- auth ----------
$("loginBtn").onclick = async () => {
  $("loginErr").textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    $("loginErr").textContent = "הכניסה נכשלה: " + e.message;
  }
};
$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (unsubEntries) { unsubEntries(); unsubEntries = null; }
  if (!u) {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    return;
  }
  $("userEmail").textContent = u.email;
  $("shareBtn").hidden = u.email !== OWNER_EMAIL;
  unsubEntries = onSnapshot(entriesCol, (snap) => {
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("loginView").hidden = true;
    $("appView").hidden = false;
    render();
  }, (err) => {
    $("appView").hidden = true;
    $("loginView").hidden = false;
    $("loginErr").textContent = err.code === "permission-denied"
      ? `לחשבון ${u.email} אין הרשאה. בקשו מהבעלים לשתף אתכם.`
      : "שגיאה בטעינת הנתונים: " + err.message;
  });
});

// ---------- side menu ----------
function showView(name) {
  if (!document.querySelector(`.view-panel[data-view="${name}"]`)) name = "fichman";
  document.querySelectorAll("#sideNav > button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.toggle("view-active", p.dataset.view === name));
  try { localStorage.setItem("ziv-view", name); } catch {}
}
document.querySelectorAll("#sideNav > button").forEach((b) => (b.onclick = () => showView(b.dataset.view)));
try { showView(localStorage.getItem("ziv-view") || "fichman"); } catch { showView("fichman"); }

const payCell = (e) => !e.pay ? "" :
  esc(PAY_LABELS[e.pay] || e.pay) + (e.payNote ? `<small>${esc(e.payNote)}</small>` : "");

// ---------- render ----------
function render() {
  const tenant = entries.filter((e) => e.kind === "tenant");
  const ledger = entries.filter((e) => e.kind === "ledger");
  const sum = (a) => round2(a.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const sumTenant = sum(tenant);
  const income = sum(ledger.filter((e) => e.amount > 0));
  const expense = sum(ledger.filter((e) => e.amount < 0));
  const balance = round2(income + expense - sumTenant);
  $("sumTenant").textContent = fmt(sumTenant);
  $("sumIncome").textContent = fmt(income);
  $("sumExpense").textContent = fmt(expense);
  $("sumBalance").textContent = fmt(balance);
  $("sumBalance").className = balance < 0 ? "neg" : "pos";

  const list = tab === "tenant" ? tenant : ledger;

  // Category filter options for the current tab.
  const cats = [...new Set(list.map((e) => e.cat).filter(Boolean))].sort();
  const sel = $("catFilter");
  const cur = sel.value;
  sel.innerHTML = '<option value="">כל הקטגוריות</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  sel.value = cats.includes(cur) ? cur : "";

  const q = $("search").value.trim().toLowerCase();
  const shown = list
    .filter((e) => !sel.value || e.cat === sel.value)
    .filter((e) => !$("openOnly").checked || e.open)
    .filter((e) => !q || [e.desc, e.cat, showDate(e.date), String(e.amount), PAY_LABELS[e.pay], e.payNote].join(" ").toLowerCase().includes(q))
    .sort((a, b) => {
      // Undated rows always go last, in their original order.
      if (!a.date !== !b.date) return a.date ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? -sortDir : sortDir;
      return (a.order ?? 0) - (b.order ?? 0);
    });

  $("rows").innerHTML = shown.map((e) => `
    <tr data-id="${e.id}" class="${e.open ? "open" : ""}">
      <td class="date">${showDate(e.date) || "—"}</td>
      <td>${e.cat ? `<span class="tag">${esc(e.cat)}</span>` : ""}</td>
      <td class="desc">${esc(e.desc)}</td>
      <td class="paycell">${payCell(e)}</td>
      <td class="num ${tab === "ledger" ? (e.amount < 0 ? "neg" : e.amount > 0 ? "pos" : "") : ""}">${fmt(Number(e.amount) || 0)}</td>
      <td>${e.open ? "⚠️" : ""}</td>
    </tr>`).join("");
  $("shownSum").textContent = fmt(sum(shown));
  $("emptyMsg").hidden = shown.length > 0;
  $("sortArrow").textContent = sortDir === 1 ? "▲" : "▼";
}

document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $("catFilter").value = "";
  render();
}));
$("search").oninput = render;
$("catFilter").onchange = render;
$("openOnly").onchange = render;
document.querySelector("th.sort").onclick = () => { sortDir = -sortDir; render(); };
$("rows").onclick = (ev) => {
  const tr = ev.target.closest("tr[data-id]");
  if (tr) openEntry(entries.find((e) => e.id === tr.dataset.id));
};

// ---------- add / edit ----------
const form = $("entryForm");

function fillCats(kind) {
  const used = entries.filter((e) => e.kind === kind).map((e) => e.cat);
  const all = [...new Set([...(kind === "tenant" ? TENANT_CATS : LEDGER_CATS), ...used])].filter(Boolean);
  $("catList").innerHTML = all.map((c) => `<option value="${esc(c)}">`).join("");
  $("amountHint").hidden = kind !== "ledger";
}
form.kind.onchange = () => fillCats(form.kind.value);

// The notes field shows only for "אחר", or when an older entry already has a note.
const syncPayNote = () => { $("payNoteRow").hidden = form.pay.value !== "other" && !form.payNote.value; };
form.querySelectorAll('input[name="pay"]').forEach((r) => (r.onchange = syncPayNote));

function openEntry(e) {
  editing = e || null;
  $("dlgTitle").textContent = e ? "עריכת רשומה" : "רשומה חדשה";
  form.kind.value = e?.kind || tab;
  form.date.value = e ? e.date : new Date().toISOString().slice(0, 10);
  form.cat.value = e?.cat || "";
  form.desc.value = e?.desc || "";
  form.amount.value = e ? e.amount : "";
  form.open.checked = !!e?.open;
  form.querySelectorAll('input[name="pay"]').forEach((r) => (r.checked = r.value === (e?.pay || "")));
  form.payNote.value = e?.payNote || "";
  syncPayNote();
  $("delBtn").hidden = !e;
  fillCats(form.kind.value);
  $("entryDlg").showModal();
}
$("addBtn").onclick = () => openEntry(null);
$("cancelBtn").onclick = () => $("entryDlg").close();

form.onsubmit = async (ev) => {
  ev.preventDefault();
  const data = {
    kind: form.kind.value,
    date: form.date.value || "",
    cat: form.cat.value.trim(),
    desc: form.desc.value.trim(),
    amount: round2(Number(form.amount.value) || 0),
    open: form.open.checked,
    pay: form.pay.value || "",
    payNote: form.pay.value === "other" || form.payNote.value.trim() ? form.payNote.value.trim() : "",
    order: editing?.order ?? Date.now(),
    updatedAt: serverTimestamp(),
    updatedBy: user.email,
  };
  try {
    if (editing) await setDoc(doc(entriesCol, editing.id), data);
    else await addDoc(entriesCol, data);
    $("entryDlg").close();
    toast("נשמר");
  } catch (e) {
    alert("השמירה נכשלה: " + e.message);
  }
};

$("delBtn").onclick = async () => {
  if (!editing || !confirm("למחוק את הרשומה?")) return;
  try {
    await deleteDoc(doc(entriesCol, editing.id));
    $("entryDlg").close();
    toast("נמחק");
  } catch (e) {
    alert("המחיקה נכשלה: " + e.message);
  }
};

// ---------- import from the original spreadsheet ----------
const guessPay = (d) => /0616/.test(d) ? "card0616" : /מזומן/.test(d) ? "cash" : "";

// Layout: data starts on row 5. A-D = tenant payments (date, category, description, amount);
// F-H = income/expenses (date, description, amount).
function parseWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const out = [];
  let order = 0;
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || [];
    const tDesc = String(r[2] ?? "").trim();
    const tAmt = Number(r[3]) || 0;
    if (tDesc || tAmt) {
      out.push({ kind: "tenant", date: parseDate(r[0]), cat: String(r[1] ?? "").trim(), desc: tDesc, amount: round2(tAmt), pay: guessPay(tDesc), payNote: "", order: ++order });
    }
    const lDesc = String(r[6] ?? "").trim();
    const lAmt = Number(r[7]) || 0;
    if (lDesc || lAmt) {
      const cat = /שכ["״]?ד/.test(lDesc) ? "שכ״ד" : /ועד בית/.test(lDesc) ? "ועד" : /ארנונה/.test(lDesc) ? "ארנונה"
        : /מנקה|ניקוי/.test(lDesc) ? "ניקיון" : lAmt < 0 ? "ריהוט וציוד" : "";
      out.push({ kind: "ledger", date: parseDate(r[5]), cat, desc: lDesc, amount: round2(lAmt), pay: guessPay(lDesc), payNote: "", order: ++order });
    }
  }
  return out;
}

$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const items = parseWorkbook(wb);
    if (!items.length) return alert("לא נמצאו רשומות בקובץ.");
    const nT = items.filter((x) => x.kind === "tenant").length;
    const msg = `נמצאו ${items.length} רשומות (${nT} תשלומי דיירים, ${items.length - nT} הכנסות והוצאות).` +
      (entries.length ? `\n\nהייבוא יחליף את ${entries.length} הרשומות הקיימות.` : "") + "\n\nלהמשיך?";
    if (!confirm(msg)) return;
    // Firestore batches are limited to 500 writes.
    const ops = [...entries.map((e) => ["del", e.id]), ...items.map((x) => ["add", x])];
    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(db);
      for (const [op, v] of ops.slice(i, i + 450)) {
        if (op === "del") batch.delete(doc(entriesCol, v));
        else batch.set(doc(entriesCol), { ...v, open: false, updatedAt: serverTimestamp(), updatedBy: user.email });
      }
      await batch.commit();
    }
    toast(`יובאו ${items.length} רשומות`);
  } catch (e) {
    alert("הייבוא נכשל: " + e.message);
  }
};

// ---------- export ----------
$("exportBtn").onclick = () => {
  const byDate = (a, b) => (!a.date !== !b.date ? (a.date ? -1 : 1) : a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order ?? 0) - (b.order ?? 0));
  const sheet = (kind) => {
    const list = entries.filter((e) => e.kind === kind).sort(byDate);
    const payText = (e) => [PAY_LABELS[e.pay]?.replace(/^\S+ /, "") || "", e.payNote || ""].filter(Boolean).join(" - ");
    const aoa = [["תאריך", "קטגוריה", "תיאור", "סכום", "אופן תשלום", "פתוח"],
      ...list.map((e) => [showDate(e.date), e.cat, e.desc, Number(e.amount) || 0, payText(e), e.open ? "כן" : ""])];
    aoa.push([], ["", "", "סה״כ", round2(list.reduce((s, e) => s + (Number(e.amount) || 0), 0))]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 80 }, { wch: 12 }, { wch: 24 }, { wch: 6 }];
    ws["!views"] = [{ RTL: true }];
    return ws;
  };
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sheet("ledger"), "הכנסות והוצאות");
  XLSX.utils.book_append_sheet(wb, sheet("tenant"), "תשלומי דיירים");
  const today = new Date().toLocaleDateString("he-IL").replace(/\//g, ".");
  XLSX.writeFile(wb, `פיכמן 5 - הוצאות הכנסות - ${today}.xlsx`);
};

// ---------- sharing (owner only) ----------
const accessCol = collection(db, "access");

async function renderShares() {
  const snap = await getDocs(accessCol);
  $("shareList").innerHTML = snap.docs.map((d) =>
    `<li><span>${esc(d.id)}</span><button type="button" class="danger" data-email="${esc(d.id)}">הסרה</button></li>`).join("")
    || "<li>עדיין לא שותף עם אף אחד.</li>";
}
$("shareBtn").onclick = async () => {
  $("shareDlg").showModal();
  try { await renderShares(); } catch (e) { $("shareList").innerHTML = `<li>${esc(e.message)}</li>`; }
};
$("shareAdd").onclick = async () => {
  const email = $("shareEmail").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("כתובת מייל לא תקינה");
  await setDoc(doc(accessCol, email), { addedAt: serverTimestamp(), addedBy: user.email });
  $("shareEmail").value = "";
  await renderShares();
};
$("shareList").onclick = async (ev) => {
  const email = ev.target.dataset?.email;
  if (!email || !confirm(`להסיר את ${email}?`)) return;
  await deleteDoc(doc(accessCol, email));
  await renderShares();
};
