// The apartment's sub-tabs ("סקירה" + one per topic) and the documents filed under each topic.
// Documents are kept in Firestore (Storage isn't on the free plan): metadata in files/{id}, the
// content as base64 pieces in fileChunks/{id}_{i}. A document marked private ("רק לי") is readable
// only by the owner; the rules enforce it, so other users ask only for non-private ones.
import { collection, doc, onSnapshot, query, where, getDoc, setDoc, deleteDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { OWNER_EMAIL } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => (n < 0 ? "-" : "") + "₪" + Math.abs(Number(n) || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });
const dmy = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const CHUNK = 700000; // base64 characters per Firestore document (limit is ~1MB)
const MAX_FILE = 15 * 1024 * 1024;

// Topics, matching the folders on the drive. "match" picks the ledger rows that belong to each.
export const TOPICS = [
  { id: "rent", name: "השכרה", icon: "📝", match: (e) => /שכ["״]?ד/.test(e.cat + e.desc) },
  { id: "vaad", name: "ועד בית", icon: "🏢", match: (e) => e.cat === "ועד" || /ועד בית/.test(e.desc) },
  { id: "arnona", name: "ארנונה", icon: "🏛️", match: (e) => e.cat === "ארנונה" || /ארנונה/.test(e.desc) },
  { id: "power", name: "חשמל", icon: "💡", match: (e) => e.cat === "חשמל" || /חשמל/.test(e.desc) },
  { id: "water", name: "מים וביוב", icon: "💧", match: (e) => e.cat === "מים" || /\bמים\b/.test(e.desc) },
  { id: "repairs", name: "תיקונים", icon: "🔧", match: (e) => ["תיקונים", "ניקיון"].includes(e.cat) },
  { id: "buy", name: "רכישות ואחריות", icon: "🛒", match: (e) => e.cat === "ריהוט וציוד" },
  { id: "credit", name: "אשראי", icon: "💳", match: () => false },
  { id: "other", name: "אחר", icon: "📁", match: () => false },
];

let db, user, isOwner = false, unsub = null, files = [], entries = [], sub = "overview";

export function startApartment(firestore, currentUser) {
  db = firestore;
  user = currentUser;
  isOwner = user?.email === OWNER_EMAIL;
  stopApartment();
  // Other users may only ask for documents that aren't private (the rules check this too).
  const q = isOwner ? collection(db, "files") : query(collection(db, "files"), where("private", "==", false));
  unsub = onSnapshot(q, (snap) => {
    files = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    window.dispatchEvent(new CustomEvent("ziv:data", { detail: { kind: "files", data: files, topics: TOPICS } }));
    render();
  }, () => { files = []; render(); });
  showSub("overview");
}
export function stopApartment() {
  if (unsub) unsub();
  unsub = null;
  files = [];
}
window.addEventListener("ziv:data", (e) => {
  if (e.detail.kind === "entries") { entries = e.detail.data || []; render(); }
});
window.addEventListener("ziv:apt-sub", (e) => showSub(e.detail));

function showSub(id) {
  sub = TOPICS.some((t) => t.id === id) ? id : "overview";
  document.querySelectorAll("#aptTabs button").forEach((b) => b.classList.toggle("on", b.dataset.sub === sub));
  $("aptOverview").hidden = sub !== "overview";
  $("aptTopic").hidden = sub === "overview";
  render();
}

function renderTabs() {
  const counts = Object.fromEntries(TOPICS.map((t) => [t.id, files.filter((f) => f.cat === t.id).length]));
  $("aptTabs").innerHTML = `<button data-sub="overview" class="${sub === "overview" ? "on" : ""}">📊 סקירה</button>` +
    TOPICS.map((t) => `<button data-sub="${t.id}" class="${sub === t.id ? "on" : ""}">${t.icon} ${t.name}${counts[t.id] ? ` <small>${counts[t.id]}</small>` : ""}</button>`).join("");
}

function render() {
  if (!$("aptTabs")) return;
  renderTabs();
  if (sub === "overview") return;
  const topic = TOPICS.find((t) => t.id === sub);
  const rows = entries.filter(topic.match).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const paid = rows.filter((r) => r.kind === "tenant").reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const ledger = rows.filter((r) => r.kind === "ledger").reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const docs = files.filter((f) => f.cat === sub).sort((a, b) => (b.name || "").localeCompare(a.name || "", "he"));
  $("aptTopic").innerHTML = `
    <h3 class="apt-h">${topic.icon} ${topic.name}</h3>
    ${rows.length ? `<p class="apt-sum">${rows.length} רשומות${paid ? ` · שולם עבור השוכרים ${money(paid)}` : ""}${ledger ? ` · בהכנסות והוצאות ${money(ledger)}` : ""}</p>
    <div class="tablewrap"><table><thead><tr><th>תאריך</th><th>סוג</th><th>תיאור</th><th class="num">סכום</th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-edit="${r.id}"><td class="date">${dmy(r.date) || "—"}</td><td>${r.kind === "tenant" ? "דיירים" : "הכנסה/הוצאה"}</td>
        <td class="desc">${esc(r.desc)}</td><td class="num">${money(r.amount)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="soon">אין רשומות בנושא הזה בטבלה.</p>`}
    <div class="apt-docs-head">
      <h3 class="apt-h">📄 מסמכים <small>${docs.length || ""}</small></h3>
      <label class="ghost upload-btn">⬆️ העלאת מסמכים<input type="file" id="aptUpload" multiple hidden></label>
      ${isOwner ? `<label class="chk"><input type="checkbox" id="aptPrivate"${sub === "credit" ? " checked" : ""}> 🔒 רק לי</label>` : ""}
      <span class="apt-progress" id="aptProgress"></span>
    </div>
    ${docs.length ? `<div class="doc-grid">${docs.map(docCard).join("")}</div>` : `<p class="soon">עדיין אין מסמכים. אפשר להעלות PDF, תמונות ומסמכי Word.</p>`}`;
}

function docCard(f) {
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  const icon = /pdf/.test(ext) ? "📕" : /jpe?g|png|gif|webp|heic/.test(ext) ? "🖼️" : /docx?/.test(ext) ? "📘" : /xlsx?|csv/.test(ext) ? "📗" : "📄";
  const when = f.uploadedAt?.toDate ? f.uploadedAt.toDate().toLocaleDateString("he-IL") : "";
  return `<div class="doc-card" data-file="${f.id}" role="button" tabindex="0">
    <span class="doc-icon">${icon}</span>
    <span class="doc-name">${esc(f.name)}</span>
    <small>${(f.size / 1024 / 1024).toFixed(f.size > 1048576 ? 1 : 2)}MB${when ? " · " + when : ""}${f.private ? " · 🔒 רק לי" : ""}</small>
    ${isOwner ? `<button type="button" class="icon-del" data-del="${f.id}" title="מחיקת המסמך" aria-label="מחיקת המסמך">✕</button>` : ""}
  </div>`;
}

// ---------- upload ----------
const readB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});

async function upload(list) {
  const priv = !!$("aptPrivate")?.checked;
  const cat = sub;
  const prog = $("aptProgress");
  for (const [n, file] of [...list].entries()) {
    if (file.size > MAX_FILE) { alert(`${file.name} גדול מ-15MB ולא הועלה.`); continue; }
    prog.textContent = `מעלה ${n + 1}/${list.length}: ${file.name}…`;
    // An Excel in the ledger layout also updates the table: only its changes come in (see app.js).
    if (/\.xlsx?$/i.test(file.name)) {
      prog.textContent = `בודק שינויים ב-${file.name}…`;
      const buffer = await file.arrayBuffer();
      await new Promise((done) => window.dispatchEvent(new CustomEvent("ziv:xlsx", { detail: { buffer, name: file.name, done } })));
      prog.textContent = `שומר את ${file.name}…`;
    }
    const older = files.filter((f) => f.cat === cat && f.name === file.name);
    const b64 = await readB64(file);
    const id = doc(collection(db, "files")).id;
    const chunks = Math.max(1, Math.ceil(b64.length / CHUNK));
    for (let i = 0; i < chunks; i++) {
      await setDoc(doc(db, "fileChunks", `${id}_${i}`), { fileId: id, i, private: priv, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
    // The metadata goes last, so a document only shows once all its pieces are saved.
    await setDoc(doc(db, "files", id), { name: file.name, type: file.type || "", size: file.size, cat, chunks, private: priv,
      uploadedAt: serverTimestamp(), uploadedBy: user.email });
    // A newer copy of the same document replaces the older one (only the owner may delete).
    if (isOwner) for (const f of older) await dropFile(f);
  }
  prog.textContent = "";
}

// ---------- view / download / delete ----------
async function fileBlob(f) {
  let b64 = "";
  for (let i = 0; i < f.chunks; i++) b64 += (await getDoc(doc(db, "fileChunks", `${f.id}_${i}`))).data()?.data || "";
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: f.type || guessType(f.name) });
}
const guessType = (name) => ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

let viewUrl = null;
async function openFile(f) {
  const dlg = $("docDlg");
  $("docTitle").textContent = f.name;
  $("docBody").innerHTML = `<p class="soon">טוען…</p>`;
  dlg.showModal();
  try {
    const blob = await fileBlob(f);
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    viewUrl = URL.createObjectURL(blob);
    const a = $("docDownload");
    a.href = viewUrl;
    a.download = f.name;
    $("docOpen").href = viewUrl;
    $("docBody").innerHTML = /pdf/.test(blob.type) ? `<iframe src="${viewUrl}" title="${esc(f.name)}"></iframe>`
      : /^image\//.test(blob.type) ? `<img src="${viewUrl}" alt="${esc(f.name)}">`
      : `<p class="soon">אי אפשר להציג את הקובץ הזה בדפדפן. לחצו "הורדה" כדי לפתוח אותו.</p>`;
  } catch (e) {
    $("docBody").innerHTML = `<p class="err">לא הצלחתי לפתוח את המסמך: ${esc(e.message)}</p>`;
  }
}

async function removeFile(f) {
  if (!confirm(`למחוק את "${f.name}"?`)) return;
  await dropFile(f);
}
async function dropFile(f) {
  await deleteDoc(doc(db, "files", f.id));
  for (let i = 0; i < f.chunks; i++) await deleteDoc(doc(db, "fileChunks", `${f.id}_${i}`)).catch(() => {});
}

// ---------- events ----------
document.addEventListener("click", (ev) => {
  const tab = ev.target.closest("#aptTabs button[data-sub]");
  if (tab) return showSub(tab.dataset.sub);
  if (!ev.target.closest("#aptTopic")) return;
  const del = ev.target.closest("[data-del]");
  if (del) { ev.stopPropagation(); return removeFile(files.find((f) => f.id === del.dataset.del)); }
  const card = ev.target.closest("[data-file]");
  if (card) return openFile(files.find((f) => f.id === card.dataset.file));
  const row = ev.target.closest("tr[data-edit]");
  if (row) window.dispatchEvent(new CustomEvent("ziv:edit-entry", { detail: row.dataset.edit }));
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "aptUpload" && ev.target.files.length) {
    upload(ev.target.files).catch((e) => { alert("ההעלאה נכשלה: " + e.message); $("aptProgress").textContent = ""; });
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.matches?.("[data-file]")) ev.target.click();
});
$("docClose").onclick = () => $("docDlg").close();
