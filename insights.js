// Insights tab: a short, up-to-date picture of one person's portfolio, computed from the same
// data the other tabs show (insurance, investments and, for Ziv, the apartment ledger).
// The other modules announce their data with a "ziv:data" event; this one only reads it.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "₪" + Math.round(Number(n) || 0).toLocaleString("he-IL");
const pct = (s) => parseFloat(String(s).replace(/[^\d.\-]/g, ""));
const DAY = 864e5;

let state = { profile: null, insurance: undefined, investments: undefined, entries: undefined };

export function resetInsights(profile) {
  state = { profile, insurance: undefined, investments: undefined, entries: profile === "ziv" ? undefined : null };
  render();
}
window.addEventListener("ziv:data", (e) => {
  state[e.detail.kind] = e.detail.data;
  render();
});

// "01/07/2013-01/07/2041" -> end date; "מתחדש" / "לכל החיים" -> null
const toDate = (m) => new Date(+m[3], +m[2] - 1, +m[1]);
function periodEnd(period) {
  const m = String(period || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  return m ? toDate(m) : null;
}
// A policy that runs about a year (car, home) renews rather than ends.
function isYearly(period) {
  const all = [...String(period || "").matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)];
  return all.length === 2 && toDate(all[1]) - toDate(all[0]) < 400 * DAY;
}
const monthlyOf = (r) => r.freq === "חד פעמית" ? 0 : (Number(r.premium) || 0) / (r.freq === "שנתית" ? 12 : 1);
// "השתלות (אישי)" and "השתלות" are the same coverage
const coverKey = (t) => String(t || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();

function insuranceInsights(ins) {
  const out = { cards: [], notes: [] };
  const rows = (ins.categories || []).flatMap((c) => c.sections.flatMap((s) => s.rows.map((r) => ({ ...r, section: s.name }))));
  if (!rows.length) return out;
  const monthly = rows.reduce((s, r) => s + monthlyOf(r), 0);
  out.cards.push({ icon: "🛡️", label: "ביטוחים בחודש", value: money(monthly), sub: `${rows.length} פוליסות · ${money(monthly * 12)} בשנה` });

  const top = [...rows].sort((a, b) => monthlyOf(b) - monthlyOf(a))[0];
  if (top && monthly && monthlyOf(top) / monthly > 0.3) {
    out.notes.push({ level: "warn", text: `<b>${esc(coverKey(top.type))}</b> (${esc(top.company)}) הוא ${Math.round(monthlyOf(top) / monthly * 100)}% מכל הביטוחים: ${money(monthlyOf(top))} בחודש` });
  }

  // The same coverage bought more than once usually pays out only once.
  const groups = {};
  for (const r of rows) {
    if (/סיעוד/.test(r.section) || /כתב שירות|חבילת כיסויים|^אחר/.test(r.type)) continue;
    const k = coverKey(r.type);
    (groups[k] ||= []).push(r);
  }
  const dups = Object.entries(groups).filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
  if (dups.length) {
    out.notes.push({ level: "warn", text: `כיסויים כפולים: ${dups.slice(0, 4).map(([k, g]) => `<b>${esc(k)}</b> ×${g.length}`).join(", ")}. לבדוק עם הסוכנת אם צריך את כולם` });
  }
  const nursing = rows.filter((r) => /סיעוד/.test(r.section));
  if (nursing.length > 2) {
    out.notes.push({ level: "info", text: `${nursing.length} פוליסות סיעוד, ${money(nursing.reduce((s, r) => s + monthlyOf(r), 0))} בחודש` });
  }

  // Coming up: renewals within 4 months, and coverage that ends within 8 years.
  const now = Date.now();
  const soon = rows.map((r) => ({ r, end: periodEnd(r.period) })).filter((x) => x.end && x.end - now > 0 && x.end - now < 120 * DAY);
  // Yearly policies: when the next renewal is
  const yearly = rows.filter((r) => isYearly(r.period)).map((r) => ({ r, end: periodEnd(r.period) }))
    .filter((x) => x.end - now >= 120 * DAY).sort((a, b) => a.end - b.end);
  if (yearly.length) {
    out.notes.push({ level: "info", text: `חידושים שנתיים: ${yearly.slice(0, 3).map(({ r, end }) => `<b>${esc(coverKey(r.type))}</b> ${end.toLocaleDateString("he-IL")}`).join(" · ")}. כדאי להשוות מחירים לפני` });
  }
  for (const { r, end } of soon.slice(0, 3)) {
    out.notes.push({ level: "warn", text: `מתחדש בקרוב: <b>${esc(coverKey(r.type))}</b> (${esc(r.company)}) ב-${end.toLocaleDateString("he-IL")}` });
  }
  const ending = rows.map((r) => ({ r, end: periodEnd(r.period) }))
    .filter((x) => x.end && x.end - now >= 120 * DAY && x.end - now < 8 * 365 * DAY && monthlyOf(x.r) > 0 && !isYearly(x.r.period))
    .sort((a, b) => a.end - b.end);
  if (ending.length) {
    const { r, end } = ending[0];
    out.notes.push({ level: "info", text: `<b>${esc(coverKey(r.type))}</b> (${esc(r.company)}) מסתיים ב-${end.getFullYear()}` });
  }
  return out;
}

function investmentInsights(inv) {
  const out = { cards: [], notes: [] };
  const pols = (inv.groups || []).flatMap((g) => g.policies);
  if (!pols.length) return out;
  const total = pols.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const liquid = pols.reduce((s, p) => s + (Number(p.liquid) || 0), 0);
  // Year-to-date return: from a "תשואה מתחילת השנה" field, else the tracks' returns weighted by size.
  // gain: the money made (or lost) this year on the parts that report a return.
  let ytd = null, w = 0, acc = 0, gain = 0;
  const add = (r, v) => { acc += r * v; w += v; gain += v * r / (100 + r); };
  for (const p of pols) {
    const f = (p.extra || []).find((x) => /תשואה/.test(x.label));
    if (f && !isNaN(pct(f.value))) { add(pct(f.value), Number(p.total) || 0); continue; }
    for (const t of p.tracks || []) if (t.ytd !== "" && !isNaN(pct(t.ytd))) add(pct(t.ytd), Number(t.total) || 0);
  }
  if (w) ytd = acc / w;
  out.cards.push({ icon: "📈", label: "חיסכון והשקעות", value: money(total),
    sub: ytd == null ? `${money(liquid)} נזיל` : `<span class="${ytd < 0 ? "neg" : "pos"}">${ytd >= 0 ? "+" : ""}${ytd.toFixed(2)}%</span> מתחילת השנה` });
  if (ytd != null) {
    out.notes.push({ level: ytd < 0 ? "warn" : "good", text: `התשואה מתחילת השנה <b>${ytd >= 0 ? "+" : ""}${ytd.toFixed(2)}%</b>, בערך ${ytd >= 0 ? "רווח" : "הפסד"} של ${money(Math.abs(gain))}` });
  }
  if (total && liquid / total > 0.9) out.notes.push({ level: "info", text: `${Math.round(liquid / total * 100)}% מהכסף נזיל (אפשר למשוך)` });
  // Management fees from the accumulation
  for (const p of pols) {
    const fee = (p.extra || []).find((x) => /ד\.נ/.test(x.label) && /(צבירה|חיסכון)/.test(x.label) && !/משתנים|קבועים/.test(x.label));
    if (fee && pct(fee.value) >= 0.7) out.notes.push({ level: "info", text: `דמי ניהול ${esc(fee.value)} מהצבירה ב-${esc(p.product || p.number)}: כ-${money((Number(p.total) || 0) * pct(fee.value) / 100)} בשנה` });
  }
  const stocks = pols.flatMap((p) => p.extra || []).filter((x) => /^מניות/.test(x.label)).reduce((s, x) => s + (pct(x.value) || 0), 0);
  if (stocks >= 50) out.notes.push({ level: "info", text: `${Math.round(stocks)}% מההשקעה במניות: הערך עולה ויורד יותר` });
  const newest = pols.map((p) => p.dataDate || "").sort().pop();
  if (newest && Date.now() - new Date(newest) > 60 * DAY) out.notes.push({ level: "warn", text: `נתוני ההשקעות מ-${newest.split("-").reverse().join(".")}. כדאי לעדכן` });
  return out;
}

function apartmentInsights(entries) {
  const out = { cards: [], notes: [] };
  if (!entries.length) return out;
  const ledger = entries.filter((e) => e.kind === "ledger");
  const income = ledger.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const expense = ledger.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
  const tenant = entries.filter((e) => e.kind === "tenant").reduce((s, e) => s + (Number(e.amount) || 0), 0);
  out.cards.push({ icon: "🏢", label: "דירה פיכמן 5", value: money(income + expense), sub: `הכנסות ${money(income)} · הוצאות ${money(-expense)}` });
  const rents = ledger.filter((e) => e.amount > 0 && /שכ/.test(e.desc + e.cat));
  if (rents.length) out.notes.push({ level: "good", text: `שכ״ד: ${rents.length} תשלומים, ${money(rents.reduce((s, e) => s + e.amount, 0))}` });
  const lastRent = rents.map((e) => e.date).filter(Boolean).sort().pop();
  if (lastRent && Date.now() - new Date(lastRent) > 40 * DAY) {
    out.notes.push({ level: "warn", text: `התשלום האחרון של שכ״ד שנרשם: ${lastRent.split("-").reverse().join(".")}. לבדוק אם הגיע תשלום חדש` });
  }
  out.notes.push({ level: "info", text: `השוכרים שילמו דרכנו ועד, מים וחשמל: ${money(tenant)}` });
  const open = entries.filter((e) => e.open);
  if (open.length) out.notes.push({ level: "warn", text: `${open.length === 1 ? "דבר אחד פתוח" : `${open.length} דברים פתוחים`} בדירה: ${open.slice(0, 2).map((e) => esc(String(e.desc).slice(0, 40))).join(" · ")}` });
  return out;
}

function render() {
  const body = $("insightBody");
  if (!body || !state.profile) return;
  const parts = [];
  if (state.entries) parts.push(apartmentInsights(state.entries));
  if (state.investments) parts.push(investmentInsights(state.investments));
  if (state.insurance) parts.push(insuranceInsights(state.insurance));
  const loading = state.insurance === undefined || state.investments === undefined || state.entries === undefined;
  const cards = parts.flatMap((p) => p.cards);
  const notes = parts.flatMap((p) => p.notes);
  const order = { warn: 0, info: 1, good: 2 };
  notes.sort((a, b) => order[a.level] - order[b.level]);
  $("insightDate").textContent = "נכון ל-" + new Date().toLocaleDateString("he-IL");
  if (!cards.length) {
    body.innerHTML = `<p class="soon">${loading ? "טוען…" : "עדיין אין נתונים. מוסיפים אותם בלשוניות הביטוחים וההשקעות."}</p>`;
    return;
  }
  body.innerHTML = `
    <div class="ins-snap">${cards.map((c) => `
      <div class="snap-card"><span class="snap-icon">${c.icon}</span><span class="snap-label">${c.label}</span>
        <b class="snap-value">${c.value}</b><small>${c.sub}</small></div>`).join("")}
    </div>
    <h3 class="snap-h">מה חשוב לדעת</h3>
    <ul class="snap-notes">${notes.map((n) => `<li class="${n.level}">${n.text}</li>`).join("")}</ul>
    <p class="snap-foot">מחושב מהנתונים בלשוניות. אלה עובדות לבדיקה עם הסוכנות, לא המלצה.</p>`;
}
