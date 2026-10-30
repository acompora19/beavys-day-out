// fetch/events.mjs: pulls public event calendars and writes data/events.json.
// Runs in GitHub Actions every few hours (see .github/workflows/events.yml). Node 20+, no packages.
//   node fetch/events.mjs            # writes data/events.json
//   node fetch/events.mjs --dry      # prints a summary, writes nothing
//   node fetch/events.mjs --only=cml # one source, for testing
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { costFrom, kidsFrom, areaFrom } from "../dayout-core.js";
import { SOURCES } from "./sources.mjs";

const DAY = 86400000, HOUR = 3600000;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v = true] = a.replace(/^--/, "").split("="); return [k, v]; }));
const NOW = new Date(), HORIZON = new Date(NOW.getTime() + 45 * DAY);
const UA = "BeavysDayOut/1.0 (+https://github.com/acompora19/beavys-day-out; free & cheap events list for friends)";

// ---------- fetching ----------
async function get(url, opts = {}) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: opts.accept || "*/*", ...(opts.headers || {}) }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return opts.json ? r.json() : r.text();
}

// ---------- dates: everything in Columbus time, written as ISO with offset ----------
const TZ = "America/New_York";
function offsetAt(d) {
  // minutes east of UTC for America/New_York at instant d
  const s = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(d).find(p => p.type === "timeZoneName").value;
  const m = s.match(/GMT([+-]\d+)/); return m ? +m[1] * 60 : 0;
}
// Build an instant from a wall-clock time in Columbus: y, mo (1-12), d, h, mi
function local(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetAt(new Date(guess)), t = guess - off * 60000;
  const off2 = offsetAt(new Date(t));            // on the day the clocks change, the first guess can be an hour out
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
function isoLocal(d) {
  const off = offsetAt(d), sign = off < 0 ? "-" : "+", a = Math.abs(off);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
// Parse the date formats the sources use. Returns a Date or null.
function parseWhen(s) {
  if (!s) return null;
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/))) return m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : local(+m[1], +m[2], +m[3], +m[4], +m[5]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return local(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/))) return local(+m[1], +m[2], +m[3], +m[4], +m[5]);   // no zone: Columbus
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return local(+m[1], +m[2], +m[3]);
  const d = new Date(s); return isNaN(d) ? null : d;
}

// ---------- text cleanup ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
function unent(s) { return String(s ?? "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&(\w+);/g, (m, k) => ENT[k] ?? m); }
function strip(html) { return unent(String(html ?? "").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
function cdata(s) { return String(s ?? "").replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1"); }

// ---------- format readers: each returns raw rows { title, start, end, allDay, venue, address, desc, url, cost } ----------
function readICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  const out = []; let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";"); const val = line.slice(i + 1);
    cur[name] = val; cur[name + ";params"] = params;
  }
  const un = v => unent(String(v ?? "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";"));
  return out.map(e => {
    const allDay = (e["DTSTART;params"] || []).some(p => /VALUE=DATE$/.test(p)) || /^\d{8}$/.test(e.DTSTART || "");
    return { title: un(e.SUMMARY), start: parseWhen(e.DTSTART), end: parseWhen(e.DTEND), allDay, venue: un(e.LOCATION), desc: strip(un(e.DESCRIPTION)), url: e.URL || (un(e.DESCRIPTION).match(/https?:\/\/\S+/) || [])[0], uid: e.UID, rrule: e.RRULE };
  });
}
function readRSS(text) {
  const items = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
  const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i")); return m ? cdata(m[1]).trim() : ""; };
  const attr = (x, t, a) => { const m = x.match(new RegExp(`<${t}\\b[^>]*\\b${a}="([^"]*)"`, "i")); return m ? m[1] : ""; };
  return items.map(x => {
    const title = unent(tag(x, "title")), desc = strip(tag(x, "description") || tag(x, "content:encoded") || tag(x, "content") || tag(x, "summary"));
    const link = tag(x, "link") || attr(x, "link", "href") || tag(x, "guid");
    // CivicPlus and most RSS calendars put the date in the description or a custom tag; try the usual spots.
    const start = parseWhen(tag(x, "ev:startdate") || tag(x, "startDate") || tag(x, "pubDate") || tag(x, "published") || tag(x, "dc:date"));
    const end = parseWhen(tag(x, "ev:enddate") || tag(x, "endDate"));
    return { title, start, end, allDay: false, venue: unent(tag(x, "ev:location") || tag(x, "location")), desc, url: link.trim(), raw: x };
  });
}

// ---------- normalizing ----------
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
function normalize(row, src) {
  if (!row.title || !row.start) return null;
  const start = row.start, end = row.end && row.end > start ? row.end : null;
  if ((end || start) < new Date(NOW.getTime() - 2 * HOUR) || start > HORIZON) return null;
  // Cost: a source's own price field wins; otherwise read it out of the title + description.
  let { cost, costNum, free } = row.cost ? costFrom(row.cost) : costFrom(`${row.title} ${row.desc || ""}`);
  if (row.cost && !cost) ({ cost, costNum, free } = costFrom(`${row.title} ${row.desc || ""}`));
  if ((src.alwaysFree || row.cheapHint) && !costNum && cost === "") { cost = "Free"; costNum = 0; free = true; }
  if (row.cheapHint && costNum == null) { cost = cost || "Cheap"; costNum = costNum ?? 5; }
  const venue = row.venue || src.venue || "", address = row.address || src.address || "";
  const town = row.town || src.town || (address.match(/,\s*([A-Za-z .]+?),?\s+OH\b/) || [])[1] || "";
  const lat = row.lat ?? src.lat ?? null, lon = row.lon ?? src.lon ?? null;
  const desc = (row.desc || "").slice(0, 1200);
  return {
    id: `${src.key}-${slug(row.uid || row.url || row.title + isoLocal(start))}`,
    title: row.title.trim(), start: isoLocal(start), end: end ? isoLocal(end) : null, allDay: !!row.allDay,
    venue, address, town, lat, lon, area: src.area || areaFrom(`${town} ${venue} ${address}`),
    cost, costNum, free, kids: row.kids ?? (src.kids ?? kidsFrom(`${row.title} ${desc}`)), indoor: row.indoor ?? src.indoor ?? null,
    url: row.url || src.url, source: src.name, desc, tags: row.tags,
  };
}

// ---------- run ----------
const ymd = d => isoLocal(d).slice(0, 10);
function eachDay(fn) { for (let d = new Date(NOW); d <= HORIZON; d.setDate(d.getDate() + 1)) fn(new Date(d)); }
const helpers = { parseWhen, strip, unent, local, ymd, eachDay, now: NOW, horizon: HORIZON };
const only = args.only ? String(args.only).split(",") : null;
const all = [], report = [];
for (const src of SOURCES) {
  if (only && !only.includes(src.key)) continue;
  const t0 = Date.now();
  try {
    let rows = [];
    if (src.ics) rows = readICS(await get(src.ics, { accept: "text/calendar, */*" }));
    else if (src.rss) rows = readRSS(await get(src.rss, { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }));
    else if (src.fetch) rows = await src.fetch(get, helpers);
    if (src.row) rows = rows.map(src.row);
    if (src.filter) rows = rows.filter(src.filter);
    const evs = rows.map(r => normalize(r, src)).filter(Boolean);
    all.push(...evs);
    report.push({ source: src.name, rows: rows.length, kept: evs.length, ms: Date.now() - t0 });
  } catch (e) {
    report.push({ source: src.name, error: e.message.slice(0, 160), ms: Date.now() - t0 });
  }
}
// drop duplicates (same title + same start, from overlapping calendars)
const seen = new Set();
const events = all.filter(e => { const k = slug(e.title) + "|" + e.start.slice(0, 16); if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.start.localeCompare(b.start));

console.table(report);
console.log(`${events.length} events through ${HORIZON.toDateString()}; ${events.filter(e => e.free).length} free, ${events.filter(e => e.kids).length} kids`);
if (args.dry) { for (const e of events.slice(0, 15)) console.log(`${e.start}  ${e.cost.padEnd(8)} ${e.title}  @ ${e.venue || e.town}`); process.exit(0); }

const out = { generated: new Date().toISOString(), sources: report, events };
mkdirSync("data", { recursive: true });
let previous = null; try { previous = JSON.parse(readFileSync("data/events.json", "utf8")); } catch {}
// If every source failed, keep the old file rather than publishing an empty list.
if (!events.length && previous?.events?.length) { console.log("Every source failed; keeping the previous events.json"); process.exit(0); }
writeFileSync("data/events.json", JSON.stringify(out, null, 1));
console.log("wrote data/events.json");
