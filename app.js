import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, deleteDoc, getDoc, getDocs,
  writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL } from "./firebase-config.js";
import { startInvestments, stopInvestments } from "./investments.js?v=6";
import { startInsurance, stopInsurance } from "./insurance.js?v=5";
import { resetInsights } from "./insights.js?v=4";
import { loadOwnerTabs, clearOwnerTabs } from "./extras.js?v=1";
import { startApartment, stopApartment } from "./apartment.js?v=2";

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

// ---------- profiles & auth ----------
// One Google sign-in; on every visit the opening page asks whose information to view,
// and the side menu switches between them. Each person has their own insurance and
// investments documents; the apartment belongs to Ziv.
const PROFILES = {
  ziv: { name: "זיו", icon: "🧑", doc: "data", views: ["insights", "fichman", "insurance", "investments"] },
  mom: { name: "אמא", icon: "👩", doc: "mom", views: ["insights", "insurance", "investments"] },
};
let profile = null;

function showSplash(err = "") {
  profile = null;
  stopAll();
  $("loginErr").textContent = err;
  syncLoginBox();
  $("appView").hidden = true;
  $("loginView").hidden = false;
}

function stopAll() {
  clearOwnerTabs();
  stopApartment();
  stopInvestments();
  stopInsurance();
  if (unsubEntries) { unsubEntries(); unsubEntries = null; }
}

function enterProfile(key) {
  const p = PROFILES[key];
  stopAll();
  profile = key;
  document.querySelectorAll(".who-switch button").forEach((b) => b.classList.toggle("on", b.dataset.who === key));
  momPhotoBtn.hidden = !(key === "mom" && user?.email === OWNER_EMAIL);
  document.querySelectorAll("#sideNav > button[data-view]").forEach((b) => (b.hidden = !p.views.includes(b.dataset.view)));
  // Every portfolio opens on its insights.
  resetInsights(key);
  showView("insights");
  startInvestments(db, user, p.doc);
  startInsurance(db, user, p.doc);
  loadOwnerTabs(db, user, key);
  if (p.views.includes("fichman")) {
    startApartment(db, user);
    unsubEntries = onSnapshot(entriesCol, (snap) => {
      entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      window.dispatchEvent(new CustomEvent("ziv:data", { detail: { kind: "entries", data: entries } }));
    }, (err) => showSplash(err.code === "permission-denied"
      ? `לחשבון ${user.email} אין הרשאה. בקשו מהבעלים לשתף אתכם.`
      : "שגיאה בטעינת הנתונים: " + err.message));
  }
  $("loginView").hidden = true;
  $("appView").hidden = false;
}

// Google refuses to sign in inside apps' built-in browsers (WhatsApp, Facebook, Instagram...),
// so there we ask to open the link in Chrome / Safari instead.
const IN_APP = /FBAN|FBAV|Instagram|Line\/|WhatsApp|; wv\)|WebView/i.test(navigator.userAgent);
if (IN_APP) {
  $("inAppNote").hidden = false;
  $("inAppChrome").hidden = !/Android/i.test(navigator.userAgent);
  $("inAppChrome").href = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
  $("inAppCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(location.origin + location.pathname); toast("הקישור הועתק. הדביקו אותו בכרום או בספארי"); }
    catch { prompt("העתיקו את הקישור:", location.origin + location.pathname); }
  };
}
const AUTH_ERRORS = {
  "auth/popup-closed-by-user": "חלון הכניסה נסגר לפני שהכניסה הסתיימה. נסו שוב.",
  "auth/cancelled-popup-request": "חלון הכניסה נסגר לפני שהכניסה הסתיימה. נסו שוב.",
  "auth/network-request-failed": "אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.",
  "auth/unauthorized-domain": "האתר לא מורשה לכניסה עם Google. פנו למנהל האתר.",
  "auth/web-storage-unsupported": "הדפדפן חוסם את הכניסה. פתחו את הקישור בכרום או בספארי.",
  "auth/operation-not-supported-in-this-environment": "הדפדפן הזה לא תומך בכניסה עם Google. פתחו את הקישור בכרום או בספארי.",
};
const authError = (e) => AUTH_ERRORS[e.code] || `הכניסה נכשלה (${e.code || e.message}). נסו לפתוח את הקישור בכרום או בספארי.`;
Object.assign(AUTH_ERRORS, {
  "auth/invalid-credential": "המייל או הסיסמה לא נכונים.",
  "auth/wrong-password": "המייל או הסיסמה לא נכונים.",
  "auth/user-not-found": "אין משתמש עם המייל הזה. בקשו ממנהל האתר ליצור לכם משתמש.",
  "auth/invalid-email": "כתובת המייל לא תקינה.",
  "auth/too-many-requests": "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.",
});

// Email + password, for people the owner created a user for in the Firebase console.
// The form is always shown while signed out; picking a person signs in with it when it is filled,
// and with Google when it is empty.
// While signed out the card shows the form; once signed in (password or Google) a green check.
function syncLoginBox() {
  const u = auth.currentUser;
  $("pwForm").hidden = !!u;
  $("pwOk").hidden = !u;
  $("pwOkEmail").textContent = u?.email || "";
}
$("pwForm").onsubmit = async (ev) => {
  ev.preventDefault();
  $("loginErr").textContent = "";
  // The owner's rights come only with a Google sign-in, so the owner's email goes to Google.
  if ($("pwEmail").value.trim().toLowerCase() === OWNER_EMAIL) {
    $("pwPass").value = "";
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: OWNER_EMAIL });
      await signInWithPopup(auth, provider);
      syncLoginBox();
      $("profiles").classList.add("pick-now");
    } catch (e) {
      $("loginErr").textContent = authError(e);
    }
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, $("pwEmail").value.trim(), $("pwPass").value);
    $("pwPass").value = "";
    syncLoginBox();
    $("profiles").classList.add("pick-now");
  } catch (e) {
    $("loginErr").textContent = authError(e);
  }
};
$("pwOut").onclick = () => signOut(auth);
// The eye shows or hides the password while typing.
$("pwEye").onclick = () => {
  const show = $("pwPass").type === "password";
  $("pwPass").type = show ? "text" : "password";
  $("pwEye").textContent = show ? "🙈" : "👁";
  $("pwEye").setAttribute("aria-pressed", String(show));
  $("pwEye").setAttribute("aria-label", show ? "הסתרת הסיסמה" : "הצגת הסיסמה");
  $("pwEye").title = $("pwEye").getAttribute("aria-label");
  $("pwPass").focus();
};
$("pwReset").onclick = async () => {
  const email = $("pwEmail").value.trim();
  if (!email) { $("loginErr").textContent = "כתבו את המייל ואז לחצו שוב על \"שכחתי סיסמה\"."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast("נשלח מייל לאיפוס הסיסמה");
  } catch (e) {
    $("loginErr").textContent = authError(e);
  }
};

// Returning from a redirect sign-in (used when the popup was blocked).
getRedirectResult(auth).catch((e) => { $("loginErr").textContent = authError(e); });

document.querySelectorAll(".profile").forEach((b) => (b.onclick = async () => {
  $("loginErr").textContent = "";
  // Picking a person always signs in with Google (a browser may have filled the password form by
  // itself); password accounts sign in with the form's own button first.
  if (!user && !auth.currentUser) {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e.code === "auth/popup-blocked") {
        // Phones often block the popup: go to Google's page and come back instead.
        await signInWithRedirect(auth, new GoogleAuthProvider());
        return;
      }
      $("loginErr").textContent = authError(e);
      return;
    }
  }
  user = auth.currentUser;
  // Only the owner and the emails on the share list may enter.
  if (user.email !== OWNER_EMAIL) {
    let ok = false;
    try { ok = (await getDoc(doc(db, "access", user.email.toLowerCase()))).exists(); } catch {}
    if (!ok) {
      const email = user.email;
      await signOut(auth);
      $("loginErr").textContent = `החשבון ${email} לא מורשה. בקשו ממנהל האתר להוסיף אותו בשיתוף.`;
      return;
    }
  }
  enterProfile(b.dataset.profile);
  if (b.dataset.profile === "ziv") playZivIntro();
  if (b.dataset.profile === "mom") playMomIntro();
}));
$("switchBtn").onclick = () => showSplash();

// Sharing and the opening photo are the owner's alone: for anyone else the buttons are taken out
// of the page altogether (the rules also refuse their writes).
const shareBtn = $("shareBtn"), momPhotoBtn = $("momPhotoBtn"), momPhotoFile = $("momPhotoFile");
const navFoot = document.querySelector(".side-nav-foot");
function placeOwnerButtons(isOwner) {
  for (const el of [shareBtn, momPhotoBtn, momPhotoFile]) {
    if (!isOwner) el.remove();
    else if (!el.isConnected) navFoot.appendChild(el);
  }
  shareBtn.hidden = !isOwner;
}
document.querySelectorAll(".who-switch button").forEach((b) => (b.onclick = () => {
  if (b.dataset.who === profile) return;
  enterProfile(b.dataset.who);
  if (b.dataset.who === "ziv") playZivIntro();
  if (b.dataset.who === "mom") playMomIntro();
}));
$("logoutBtn").onclick = () => signOut(auth);

// Each person's opening plays over the app for a moment; a click skips it.
// Both use the same layered 3D lettering as GAVISH: Ziv gets Z1V CHANNEL, Mom her photo and "אמא"
// (her photo is kept in Firestore, not in this public repo; her face is the fallback).
let introTimer;
function playIntro(intro, ms) {
  clearTimeout(introTimer);
  intro.classList.remove("leaving");
  intro.hidden = false;
  const close = () => {
    clearTimeout(introTimer);
    intro.classList.add("leaving");
    setTimeout(() => (intro.hidden = true), 500);
  };
  intro.onclick = close;
  introTimer = setTimeout(close, ms);
}
const playZivIntro = () => playIntro($("zivIntro"), 2800);

const momPhotoRef = () => doc(db, "media", "mom");
let momPhotoLoaded = null;
function showMomPhoto(dataUrl) {
  if (dataUrl) $("momImg").src = dataUrl;
}
function playMomIntro() {
  momPhotoLoaded ||= getDoc(momPhotoRef()).then((snap) => showMomPhoto(snap.data()?.dataUrl)).catch(() => {});
  playIntro($("momIntro"), 3200);
}

// Owner: choose the photo for Mom's opening. It is shrunk so it fits in one Firestore document.
async function shrinkPhoto(file, maxH, type, quality) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxH / img.height);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}
function photoPicker(btn, input, id, maxH, type, after) {
  btn.onclick = () => input.click();
  input.onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await shrinkPhoto(file, maxH, type, 0.85);
      await setDoc(doc(db, "media", id), { dataUrl, updatedAt: serverTimestamp(), updatedBy: user.email });
      after(dataUrl);
    } catch (e) {
      alert("שמירת התמונה נכשלה: " + e.message);
    }
  };
}
photoPicker(momPhotoBtn, momPhotoFile, "mom", 700, "image/webp", (url) => {
  showMomPhoto(url);
  momPhotoLoaded = Promise.resolve();
  playMomIntro();
});
// GAVISH and the slogan: each letter is a stack of layers (real 3D depth) riding a wave.
function layered(el, depth = 10) {
  el.innerHTML = [...el.textContent].map((ch, i) => ch === " "
    ? '<span class="sp"> </span>'
    : `<span class="L" style="--i:${i}">${Array.from({ length: depth }, (_, k) =>
        `<b style="--k:${k}"${k ? ' aria-hidden="true"' : ""}>${ch}</b>`).join("")}</span>`).join("");
}
layered($("gavishText"), 14);
layered($("sloganText"));
layered($("zivText"), 14);
layered($("zivText2"));
layered($("momText"), 14);

onAuthStateChanged(auth, (u) => {
  user = u;
  $("userEmail").textContent = u?.email || "";
  placeOwnerButtons(u?.email === OWNER_EMAIL);
  syncLoginBox();
  if (!u || !profile) showSplash();
});

// ---------- side menu ----------
function showView(name) {
  if (!document.querySelector(`.view-panel[data-view="${name}"]`)) name = "insights";
  document.querySelectorAll("#sideNav > button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.toggle("view-active", p.dataset.view === name));
  try { if (profile) localStorage.setItem(`ziv-view-${profile}`, name); } catch {}
}
document.querySelectorAll("#sideNav > button[data-view]").forEach((b) => (b.onclick = () => showView(b.dataset.view)));
window.addEventListener("ziv:show", (e) => showView(e.detail));
// A row in one of the apartment's topic tabs opens the usual edit dialog.
window.addEventListener("ziv:edit-entry", (e) => {
  const entry = entries.find((x) => x.id === e.detail);
  if (entry) openEntry(entry);
});

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

// An uploaded Excel in the old layout is merged, not replaced: only what changed comes in.
// Each Excel row is matched to a row already here (each row matches once):
//   1. same kind, date, amount and text          -> nothing to do
//   2. same kind, date and amount (text changed) -> update the text
//   3. same kind and text (date/amount changed)  -> update date and amount
// Anything left is new. Rows that exist only on the site are kept.
const normText = (t) => String(t || "").replace(/\s+/g, " ").trim();
function planMerge(items) {
  const pool = entries.map((e) => ({ ...e, used: false }));
  const plan = { add: [], update: [], same: 0 };
  const take = (pred) => { const m = pool.find((e) => !e.used && pred(e)); if (m) m.used = true; return m; };
  for (const x of items) {
    const sameKind = (e) => e.kind === x.kind;
    if (take((e) => sameKind(e) && e.date === x.date && round2(e.amount) === x.amount && normText(e.desc) === normText(x.desc))) { plan.same++; continue; }
    const m = (x.date && x.amount ? take((e) => sameKind(e) && e.date === x.date && round2(e.amount) === x.amount) : null)
      || take((e) => sameKind(e) && normText(e.desc) === normText(x.desc));
    if (!m) { plan.add.push(x); continue; }
    const ch = {};
    if (normText(m.desc) !== normText(x.desc)) ch.desc = x.desc;
    if (m.date !== x.date && x.date) ch.date = x.date;
    if (round2(m.amount) !== x.amount) ch.amount = x.amount;
    if (Object.keys(ch).length) plan.update.push({ id: m.id, before: m, ch }); else plan.same++;
  }
  return plan;
}

// apartment.js hands us an uploaded Excel; we answer whether anything was merged.
window.addEventListener("ziv:xlsx", async (ev) => {
  const { buffer, name, done } = ev.detail;
  try {
    const items = parseWorkbook(XLSX.read(buffer, { cellDates: true }));
    if (!items.length) return done(false);
    const plan = planMerge(items);
    if (!plan.add.length && !plan.update.length) { toast(`${name}: אין שינויים מהקובץ`); return done(false); }
    const line = (e) => `• ${showDate(e.date) || "ללא תאריך"} · ${fmt(Number(e.amount) || 0)} · ${String(e.desc).slice(0, 50)}`;
    const msg = [`מהקובץ ${name}:`, ``,
      plan.add.length ? `${plan.add.length} רשומות חדשות:` : "", ...plan.add.slice(0, 8).map(line), plan.add.length > 8 ? `…ועוד ${plan.add.length - 8}` : "",
      plan.update.length ? `${plan.update.length} רשומות שהשתנו:` : "",
      ...plan.update.slice(0, 8).map((u) => line({ ...u.before, ...u.ch }) + "  (" + Object.keys(u.ch).map((k) => ({ desc: "תיאור", date: "תאריך", amount: "סכום" })[k]).join(", ") + ")"),
      plan.update.length > 8 ? `…ועוד ${plan.update.length - 8}` : "",
      ``, `${plan.same} רשומות זהות לא ישתנו, ורשומות שנוספו באתר יישארו. לעדכן?`].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0)).join("\n");
    if (!confirm(msg)) return done(false);
    let order = Math.max(0, ...entries.map((e) => e.order || 0));
    for (const x of plan.add) {
      await setDoc(doc(entriesCol), { ...x, order: ++order, open: false, updatedAt: serverTimestamp(), updatedBy: user.email });
    }
    for (const u of plan.update) {
      await setDoc(doc(entriesCol, u.id), { ...u.ch, updatedAt: serverTimestamp(), updatedBy: user.email }, { merge: true });
    }
    toast(`נקלטו ${plan.add.length} חדשות ו-${plan.update.length} עדכונים`);
    done(true);
  } catch (e) {
    alert("קריאת האקסל נכשלה: " + e.message);
    done(false);
  }
});

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
// The link is just the site's address: access is decided by the signed-in email.
const SHARE_URL = location.origin + location.pathname;
const SHARE_TEXT = `הוזמנת לצפות בתיק של משפחת גביש. נכנסים עם חשבון ה-Google שלך: ${SHARE_URL}`;
$("shareUrl").value = SHARE_URL;
$("shareWa").href = "https://wa.me/?text=" + encodeURIComponent(SHARE_TEXT);
$("shareCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(SHARE_URL); } catch { $("shareUrl").select(); document.execCommand("copy"); }
  toast("הקישור הועתק");
};
shareBtn.onclick = async () => {
  $("shareDlg").showModal();
  try { await renderShares(); } catch (e) { $("shareList").innerHTML = `<li>${esc(e.message)}</li>`; }
};
$("shareAdd").onclick = async () => {
  const email = $("shareEmail").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("כתובת מייל לא תקינה");
  await setDoc(doc(accessCol, email), { addedAt: serverTimestamp(), addedBy: user.email });
  $("shareEmail").value = "";
  await renderShares();
  toast(`${email} נוסף. שלחו לו את הקישור`);
};
$("shareList").onclick = async (ev) => {
  const email = ev.target.dataset?.email;
  if (!email || !confirm(`להסיר את ${email}?`)) return;
  await deleteDoc(doc(accessCol, email));
  await renderShares();
};
