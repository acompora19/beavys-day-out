// dayout-core.js: the date, weather and sorting logic shared by the page (index.html) and the
// event fetcher (fetch/events.mjs). Pure functions only: no page, no network.
const HOUR = 3600000, DAY = 86400000;
const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOME = { name: "Canal Winchester", lat: 39.843, lon: -82.805 };   // where Beavy lives: the default spot for weather and distance

// ---------- dates (all in the browser's local time; everything here is Columbus) ----------
function dayKey(d) { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function startOfDay(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
function addDays(d, n) { d = new Date(d); d.setDate(d.getDate() + n); return d; }
function fmtClock(d) { d = new Date(d); let h = d.getHours(); const m = d.getMinutes(); const ap = h < 12 ? "AM" : "PM"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`; }
function fmtDay(d, now = new Date()) {
  d = new Date(d);
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${DN[d.getDay()]} ${MN[d.getMonth()]} ${d.getDate()}`;
}
function fmtLongDay(d) { d = new Date(d); return `${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()]}, ${["January","February","March","April","May","June","July","August","September","October","November","December"][d.getMonth()]} ${d.getDate()}`; }
// The "when" windows the filter bar offers: [start, end) as Dates.
function windowFor(key, now = new Date()) {
  const t0 = startOfDay(now);
  const dow = t0.getDay();
  switch (key) {
    case "today": return [t0, addDays(t0, 1)];
    case "tomorrow": return [addDays(t0, 1), addDays(t0, 2)];
    case "weekend": {
      // Friday evening through Sunday. On a weekend day, "this weekend" is the one we're in.
      const toFri = dow === 0 ? -2 : dow === 6 ? -1 : (5 - dow);
      const fri = addDays(t0, toFri);
      const start = toFri < 0 ? t0 : new Date(fri.getTime() + 16 * HOUR);   // Friday from 4 PM
      return [start, addDays(fri, 3)];
    }
    case "week": return [t0, addDays(t0, 7)];
    case "month": return [t0, addDays(t0, 31)];
    default: return [t0, addDays(t0, 45)];
  }
}
// Does an event (start, end as ms, allDay) touch a window?
function inWindow(ev, [a, b]) {
  const s = ev.start, e = ev.end || ev.start + (ev.allDay ? DAY : HOUR);
  return s < b.getTime() && e > a.getTime();
}

// ---------- distance ----------
function miles(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lat2 == null) return null;
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
function fmtMiles(m) { return m == null ? "" : m < 1 ? "under a mile" : `${Math.round(m)} mi`; }

// ---------- reading cost, kids and places out of event text (used by the fetcher and as a fallback in the page) ----------
const KIDS_RE = /\b(kid|kids|child|children|family|families|toddler|preschool|storytime|story time|stories|baby|babies|teen|tween|youth|all ages|little|junior|homeschool|craft|puppet|lego)\b/i;
const NOT_FREE_RE = /\b(free parking|free admission for members|members free|free with (paid )?admission|free with registration fee|fee)\b/i;
const FREE_RE = /\b(free|no cost|no charge|complimentary|donation|pay what you)\b/i;
function costFrom(text) {
  // Returns { cost: "Free" | "$12" | "$5–$10" | "", costNum: number|null, free: bool }
  const t = String(text || "");
  const dollars = [...t.matchAll(/\$\s?(\d+(?:\.\d{2})?)/g)].map(m => parseFloat(m[1])).filter(n => n >= 0 && n < 500);
  const free = FREE_RE.test(t.replace(NOT_FREE_RE, "")) || dollars.some(n => n === 0);
  if (!dollars.some(n => n > 0)) return { cost: free ? "Free" : "", costNum: free ? 0 : null, free };
  const lo = Math.min(...dollars), hi = Math.max(...dollars);
  if (free) return { cost: `Free–$${hi}`, costNum: 0, free: true };
  return { cost: lo === hi ? `$${lo}` : `$${lo}–$${hi}`, costNum: lo, free: false };
}
function kidsFrom(text) { return KIDS_RE.test(String(text || "")); }

// Which side of the map an event or place is on. Fairfield County towns first; everything else near Columbus is "Columbus".
const FAIRFIELD = /\b(lancaster|pickerington|canal winchester|lithopolis|baltimore|carroll|millersport|bremen|amanda|pleasantville|rushville|sugar grove|thurston|stoutsville|fairfield county|buckeye lake)\b/i;
function areaFrom(text) { return FAIRFIELD.test(String(text || "")) ? "Fairfield County" : "Columbus"; }

// ---------- weather: a trimmed copy of Mia's Almanac so Beavy dresses the same way on both apps ----------
function parseOpenMeteo(om) {
  const H = om.hourly;
  return H.time.map((s, i) => ({
    t: new Date(s).getTime(), temp: H.temperature_2m[i], feels: H.apparent_temperature[i],
    pop: H.precipitation_probability[i] ?? 0, precip: H.precipitation[i] ?? 0, snow: H.snowfall[i] ?? 0,
    code: H.weather_code[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i], uv: H.uv_index[i] ?? 0,
  })).filter(h => h.temp != null);
}
function dayHours(hours, d) { const k = dayKey(d); return hours.filter(h => dayKey(h.t) === k); }
// The coldest "feels like" between 7 AM and 8 PM from now on: what you dress for.
function dressTemp(cur, hrs) {
  const out = hrs.filter(x => x.t >= cur.t - HOUR / 2 && new Date(x.t).getHours() >= 7 && new Date(x.t).getHours() <= 20);
  return Math.min(cur.feels ?? cur.temp, ...out.map(x => x.feels ?? x.temp));
}
const GEAR_NAME = {
  extreme: "Bitter cold: heavy coat & goggles", snowy: "Cold: warm coat, trapper hat & scarf",
  rainy: "Rainy: rain jacket, hood up", windy: "Windy: windbreaker & cap",
  hot: "Hot: tank top, sun hat & water", sunny: "Sunny & warm: sun hat & shades",
  fall: "Cool: flannel & beanie", spring: "Jacket weather: jacket & cap",
};
function gearFor(cur, ahead = []) {
  const hrs = [cur, ...ahead];
  const snowingNow = (cur.code >= 71 && cur.code <= 77) || cur.code === 85 || cur.code === 86;
  const rainingNow = !snowingNow && cur.code >= 51;
  const snowAhead = hrs.reduce((a, x) => a + (x.snow || 0), 0) >= 0.2;
  const rainAhead = hrs.some(x => x.pop >= 20);
  const gustAhead = Math.max(...hrs.map(x => x.gust || 0));
  const hiAhead = Math.max(...hrs.map(x => x.temp));
  const feel = dressTemp(cur, hrs);
  if (feel <= 15) return "extreme";
  if (snowingNow || snowAhead || feel <= 40) return "snowy";
  if (rainingNow || rainAhead) return "rainy";
  if (feel <= 52) return "spring";
  if (cur.gust >= 28 || cur.wind >= 18 || gustAhead >= 32) return "windy";
  if (hiAhead >= 86) return "hot";
  if (hiAhead >= 75 || (hiAhead >= 70 && feel >= 62 && cur.code <= 2)) return "sunny";
  return "fall";
}
// A day's outlook for picking what to do: { outdoor: 0-2 (0 = stay in), line }.
function outlookFor(hrs) {
  if (!hrs.length) return { outdoor: 1, line: "", wet: false, cold: false, hot: false, gear: "fall" };
  const day = hrs.filter(h => { const hr = new Date(h.t).getHours(); return hr >= 9 && hr <= 20; });
  const use = day.length ? day : hrs;
  const hi = Math.max(...use.map(h => h.temp)), pop = Math.max(...use.map(h => h.pop)), precip = use.reduce((s, h) => s + h.precip, 0);
  const snow = use.reduce((s, h) => s + h.snow, 0), feel = Math.min(...use.map(h => h.feels ?? h.temp));
  const storm = use.some(h => h.code >= 95);
  const wet = pop >= 50 || precip >= 0.15 || snow >= 0.5, cold = feel <= 25, hot = hi >= 95;
  let outdoor = 2, line;
  if (storm) { outdoor = 0; line = "Storms in the forecast, so Beavy's picking indoor spots first."; }
  else if (snow >= 0.5) { outdoor = 1; line = `Snow today (${snow.toFixed(1)}"). Sledding hills count as free fun!`; }
  else if (wet) { outdoor = 0; line = `Rain likely (${pop}% chance). Indoor picks first; bring the rain boots if you go out.`; }
  else if (cold) { outdoor = 1; line = `Bitter cold today (feels like ${Math.round(feel)}°). Short outdoor trips, then somewhere warm.`; }
  else if (hot) { outdoor = 1; line = `Hot one (${Math.round(hi)}°). Water, shade and splash pads are the move.`; }
  else if (pop >= 30) { outdoor = 1; line = `Could sprinkle (${pop}% chance), but a park is still a fine idea.`; }
  else if (hi >= 60) { line = `${Math.round(hi)}° and dry. Great day to be outside!`; }
  else { line = `${Math.round(hi)}° and dry. Bundle up a little and get outside.`; }
  return { outdoor, line, wet, cold, hot, hi, pop };
}

// ---------- holidays: Beavy's special outfits (same rules as Mia's Almanac) ----------
const HOLIDAY_ART = ["christmas", "thanksgiving", "july4", "halloween", "easter", "stpatrick", "valentine", "newyear"];
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31);
  return [mo - 1, ((h + l - 7 * m + 114) % 31) + 1];
}
function holidayFor(now = new Date()) {
  const y = now.getFullYear(), today = startOfDay(now).getTime();
  const dates = yr => {
    const [em, ed] = easter(yr), nov1 = new Date(yr, 10, 1).getDay(), tg = 1 + ((4 - nov1 + 7) % 7) + 21;
    return [[0, 1, "newyear", "New Year's Day"], [1, 14, "valentine", "Valentine's Day"], [2, 17, "stpatrick", "St. Patrick's Day"],
      [em, ed, "easter", "Easter"], [6, 4, "july4", "the Fourth of July"], [9, 31, "halloween", "Halloween"],
      [10, tg, "thanksgiving", "Thanksgiving"], [11, 25, "christmas", "Christmas"]]
      .map(([m, dd, key, name]) => ({ key, name, days: Math.round((new Date(yr, m, dd).getTime() - today) / DAY) }));
  };
  const next = [...dates(y), ...dates(y + 1)].filter(h => h.days >= 0 && h.days <= 13).sort((a, b) => a.days - b.days)[0];
  return next ? { ...next, today: next.days === 0, art: HOLIDAY_ART.includes(next.key) } : null;
}

// ---------- sorting the day's picks ----------
// Standbys get a score from the weather and the hour: indoor first when it's wet, water on hot days, trails on nice days.
function scoreStandby(p, outlook, hourNow) {
  let s = 0;
  const tags = p.tags || [];
  if (outlook.outdoor === 0) s += p.indoor ? 3 : -3;
  if (outlook.outdoor === 1) s += p.indoor ? 1 : 0;
  if (outlook.outdoor === 2 && !p.indoor) s += 2;
  if (outlook.hot && tags.includes("water")) s += 3;
  if (outlook.cold && !p.indoor) s -= 1;
  if (hourNow >= 17 && tags.includes("trail")) s -= 1;
  if (p.costNum === 0) s += 1;
  return s;
}

export { HOUR, DAY, DN, MN, HOME, dayKey, startOfDay, addDays, fmtClock, fmtDay, fmtLongDay, windowFor, inWindow, miles, fmtMiles,
  costFrom, kidsFrom, areaFrom, FAIRFIELD, parseOpenMeteo, dayHours, dressTemp, GEAR_NAME, gearFor, outlookFor, HOLIDAY_ART, holidayFor, scoreStandby };
