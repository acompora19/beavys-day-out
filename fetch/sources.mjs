// fetch/sources.mjs: every calendar the app pulls from, and how to read each one.
// Each source is { key, name, area, ...one of: ics | rss | fetch(get, h) | recurring(h) }.
// Rows a source returns: { title, start: Date, end: Date|null, allDay, venue, address, town, lat, lon, desc, url, cost, kids, indoor, uid }
// `cost` may be a string to parse ("Free", "$5") or left out to read it from the text.
// Checked 2026-10-30; a source that breaks just reports an error in data/events.json and the rest carry on.

const MEETING_RE = /\b(meeting|commission|council|hearing|board|work session|committee|agenda|closed|office hours?|trash|recycling|deadline)\b/i;
const notMeeting = r => !MEETING_RE.test(r.title);

// ---------- The Events Calendar (WordPress) JSON: Metro Parks, Rec & Parks, Columbus Commons, Scioto Mile, Downtown Columbus ----------
function tec(base, extra = {}) {
  return async (get, h) => {
    const from = h.ymd(h.now), to = h.ymd(h.horizon);
    let url = `${base}/wp-json/tribe/events/v1/events?per_page=50&start_date=${from}&end_date=${to}`;
    const rows = [];
    for (let page = 0; url && page < 8; page++) {
      const data = await get(url, { json: true, accept: "application/json" });
      for (const e of data.events || []) {
        const v = e.venue && !Array.isArray(e.venue) ? e.venue : {};
        rows.push({
          uid: String(e.id), title: h.unent(e.title), start: h.parseWhen(e.start_date), end: h.parseWhen(e.end_date), allDay: !!e.all_day,
          venue: h.unent(v.venue || ""), address: [v.address, v.city, v.state || "OH", v.zip].filter(Boolean).join(", "), town: v.city || extra.town,
          lat: v.geo_lat != null ? +v.geo_lat : undefined, lon: v.geo_lng != null ? +v.geo_lng : undefined,
          desc: h.strip(e.description || ""), url: e.url || e.website, cost: [e.cost, e.cost_details?.values?.join(" ")].filter(Boolean).join(" "),
          kids: (e.categories || []).some(c => /family|kid|child|youth/i.test(c.name)) || undefined,
        });
      }
      url = data.next_rest_url || null;
    }
    return rows;
  };
}

// ---------- Communico (library calendars): Fairfield County District Library, Pickerington ----------
const LIB_BRANCHES = {
  // Fairfield County District Library
  "Lancaster Main Library": { address: "219 N Broad St, Lancaster, OH 43130", lat: 39.7177, lon: -82.5995, town: "Lancaster" },
  "Main Library": { address: "219 N Broad St, Lancaster, OH 43130", lat: 39.7177, lon: -82.5995, town: "Lancaster" },
  "Northwest Branch Library": { address: "2855 Columbus-Lancaster Rd NW, Lancaster, OH 43130", lat: 39.7715, lon: -82.6440, town: "Lancaster" },
  "Baltimore Branch Library": { address: "205 E Market St, Baltimore, OH 43105", lat: 39.8449, lon: -82.6016, town: "Baltimore" },
  "Bremen Branch Library": { address: "220 Marietta St, Bremen, OH 43107", lat: 39.7066, lon: -82.4258, town: "Bremen" },
  "Amanda Branch Library": { address: "106 E Main St, Amanda, OH 43102", lat: 39.6498, lon: -82.7448, town: "Amanda" },
  "Johns Branch Library": { address: "209 E Main St, Pleasantville, OH 43148", lat: 39.8074, lon: -82.5208, town: "Pleasantville" },
  "Millersport Branch Library": { address: "2555 Chautauqua Blvd, Millersport, OH 43046", lat: 39.8963, lon: -82.5346, town: "Millersport" },
  "Canal Winchester Branch": { address: "115 Franklin St, Canal Winchester, OH 43110", lat: 39.8441, lon: -82.8078, town: "Canal Winchester" },
  // Pickerington Public Library
  "Pickerington Main": { address: "201 Opportunity Way, Pickerington, OH 43147", lat: 39.8958, lon: -82.7563, town: "Pickerington" },
  "Pickerington Main Library": { address: "201 Opportunity Way, Pickerington, OH 43147", lat: 39.8958, lon: -82.7563, town: "Pickerington" },
  "Sycamore Plaza": { address: "7861 Refugee Rd, Pickerington, OH 43147", lat: 39.9173, lon: -82.7918, town: "Pickerington" },
  "Sycamore Plaza Library": { address: "7861 Refugee Rd, Pickerington, OH 43147", lat: 39.9173, lon: -82.7918, town: "Pickerington" },
};
function communico(host, fallbackTown) {
  return async (get, h) => {
    const req = JSON.stringify({ private: false, date: h.ymd(h.now), days: 45, locations: "", ages: "", types: "" });
    const data = await get(`https://${host}/eeventcaldata?event_type=0&req=${encodeURIComponent(req)}`, { json: true, accept: "application/json" });
    const list = Array.isArray(data) ? data : data.events || data.data || [];
    return list.map(e => {
      const branch = e.location || e.library || "", known = Object.entries(LIB_BRANCHES).find(([k]) => branch.toLowerCase().startsWith(k.toLowerCase()))?.[1] || {};
      const ages = String(e.ages || "") + " " + String(e.tags || "");
      const start = h.parseWhen(e.event_start), end = h.parseWhen(e.event_end);
      const allDay = !!e.all_day || (!!e.raw_start_time && /all day/i.test(e.raw_start_time)) || (start && end && end - start >= 23 * 3600000);
      return {
        uid: String(e.id), title: h.unent(e.title), start, end, allDay,
        venue: branch + (e.venues ? ` · ${e.venues}` : ""), address: known.address, lat: known.lat, lon: known.lon, town: known.town || fallbackTown,
        desc: h.strip(e.long_description || e.description || ""), url: e.url || e.reg_url,
        cost: Number(e.registration_cost || 0) > 0 ? `$${e.registration_cost}` : "Free", indoor: true,
        kids: /family|kid|child|preschool|toddler|baby|school age|all ages|teen|tween/i.test(ages) || undefined,
      };
    });
  };
}

// ---------- Visit Fairfield County (WordPress REST, custom "event" type) ----------
const VFC_FREE_CAT = 523;   // "Cheap or Free"
async function visitFairfield(get, h) {
  const rows = [];
  for (let page = 1; page <= 4; page++) {
    let data;
    try { data = await get(`https://visitfairfieldcounty.org/wp-json/wp/v2/event?per_page=100&page=${page}&_fields=id,title,link,acf,location,event_category,content`, { json: true, accept: "application/json" }); }
    catch (e) { if (page > 1) break; throw e; }
    if (!Array.isArray(data) || !data.length) break;
    for (const e of data) {
      const a = e.acf || {}, L = e.location || {};
      const start = h.parseWhen(a.start_date), end = h.parseWhen(a.end_date);
      if (!start) continue;
      const content = h.strip(e.content?.rendered || "");
      const cheapOrFree = (e.event_category || []).includes(VFC_FREE_CAT);
      rows.push({
        uid: String(e.id), title: h.unent(e.title?.rendered || ""), start, end, allDay: !!a.all_day_event,
        venue: h.unent(L.name || a.host || ""), address: L.address || "", town: L.city || "", lat: L.lat != null ? +L.lat : undefined, lon: L.lng != null ? +L.lng : undefined,
        desc: content, url: e.link, cost: cheapOrFree && !/\$\s?\d/.test(content) ? "Free" : undefined, cheapHint: cheapOrFree,
      });
    }
  }
  return rows;
}

// ---------- Experience Columbus (Simpleview): the big metro-wide list, with admission prices ----------
async function experienceColumbus(get, h) {
  const token = String(await get("https://www.experiencecolumbus.com/plugins/core/get_simple_token/", { accept: "text/plain" })).trim().replace(/^"|"$/g, "");
  const q = JSON.stringify({
    filter: { active: true, date_range: { start: { $date: h.now.toISOString() }, end: { $date: h.horizon.toISOString() } } },
    options: { limit: 400, skip: 0, count: true, fields: { title: 1, date: 1, startDate: 1, endDate: 1, startTime: 1, endTime: 1, admission: 1, location: 1, address1: 1, city: 1, zip: 1, url: 1, latitude: 1, longitude: 1, teaser: 1, categories: 1, recid: 1 } },
  });
  const data = await get(`https://www.experiencecolumbus.com/includes/rest_v2/plugins_events_events_by_date/find/?json=${encodeURIComponent(q)}&token=${token}`, { json: true, accept: "application/json" });
  const docs = data.docs?.docs || data.docs || [];
  const rows = [];
  for (const d of docs) {
    // `date` is this occurrence's day (midnight UTC-ish); the clock times are local strings like "16:00:00".
    const dayIso = String(d.date || d.startDate || "").slice(0, 10);
    const [y, m, dd] = dayIso.split("-").map(Number);
    if (!y) continue;
    const [sh, sm] = String(d.startTime || "").split(":").map(Number), [eh, em] = String(d.endTime || "").split(":").map(Number);
    const allDay = !d.startTime;
    const start = h.local(y, m, dd, sh || 0, sm || 0), end = d.endTime ? h.local(y, m, dd, eh || 0, em || 0) : null;
    rows.push({
      uid: `${d.recid || d._id}-${dayIso}`, title: h.unent(d.title), start, end: end && end > start ? end : null, allDay,
      venue: h.unent(d.location || ""), address: [d.address1, d.city, "OH", d.zip].filter(Boolean).join(", "), town: d.city,
      lat: d.latitude ? +d.latitude : undefined, lon: d.longitude ? +d.longitude : undefined,
      desc: h.strip(d.teaser || ""), url: d.url ? (d.url.startsWith("http") ? d.url : "https://www.experiencecolumbus.com" + d.url) : undefined,
      cost: d.admission || "", kids: (d.categories || []).some(c => /family|kid|child/i.test(typeof c === "string" ? c : c.catName || "")) || undefined,
    });
  }
  return rows;
}

// ---------- Destination Downtown Lancaster (Squarespace) ----------
async function downtownLancaster(get, h) {
  const data = await get("https://destinationdowntownlancaster.com/events?format=json", { json: true, accept: "application/json" });
  const items = [...(data.upcoming || []), ...(data.items || [])];
  return items.map(e => ({
    uid: e.id, title: h.unent(e.title), start: new Date(e.startDate), end: e.endDate ? new Date(e.endDate) : null, allDay: false,
    venue: h.unent(e.location?.addressTitle || ""), address: [e.location?.addressLine1, e.location?.addressLine2].filter(Boolean).join(", "),
    town: "Lancaster", lat: e.location?.markerLat, lon: e.location?.markerLng, desc: h.strip(e.excerpt || ""), url: e.fullUrl ? "https://www.destinationdowntownlancaster.com" + e.fullUrl : undefined,
  }));
}

// ---------- CivicPlus city calendars (iCal) ----------
const civic = (host, catID) => `https://${host}/common/modules/iCalendar/iCalendar.aspx?catID=${catID}&feed=calendar`;
// LOCATION comes as "<p>Venue</p> - 123 Street City OH 43110"; split it into venue + address.
function civicRow(r) {
  const loc = String(r.venue || "").replace(/<[^>]+>/g, "").trim();
  const [venue, ...rest] = loc.split(/\s+-\s+/);
  return { ...r, venue: rest.length ? venue.trim() : "", address: (rest.length ? rest.join(" - ") : venue).replace(/\s{2,}/g, " ").trim() };
}

// ---------- Things with no feed that happen on a schedule ----------
// Each returns the instances inside the window. `h.each(dayRule, fn)` walks the days from now to the horizon.
const firstSunday = d => d.getDay() === 0 && d.getDate() <= 7;
const firstSaturday = d => d.getDay() === 6 && d.getDate() <= 7;
const recurringFree = [
  { rule: d => d.getDay() === 0, title: "Free Sunday at Columbus Museum of Art", h0: 10, h1: 17, venue: "Columbus Museum of Art", address: "480 E Broad St, Columbus, OH 43215", lat: 39.9640, lon: -82.9878, town: "Columbus",
    desc: "General admission is free every Sunday at the Broad Street museum. (Visitors 25 and under get in free every day.) Sunday hours 10–5.", url: "https://www.columbusmuseum.org/free-discounted-tickets", kids: true, indoor: true, tags: ["art", "museum"] },
  { rule: firstSunday, title: "Community Day at Franklin Park Conservatory", h0: 10, h1: 17, venue: "Franklin Park Conservatory", address: "1777 E Broad St, Columbus, OH 43203", lat: 39.9634, lon: -82.9558, town: "Columbus",
    desc: "First Sunday of the month: free general admission for Columbus and Franklin County residents. Bring a photo ID plus proof of address (a utility bill or mail works). 10–5, or 10–4 in Nov–Jan.", url: "https://www.fpconservatory.org/community-days/", kids: true, indoor: true, tags: ["garden", "free-day"] },
  { rule: firstSaturday, title: "Short North Gallery Hop", h0: 16, h1: 20, venue: "Short North Arts District", address: "High St between Goodale St and 5th Ave, Columbus, OH 43215", lat: 39.9777, lon: -83.0040, town: "Columbus",
    desc: "First Saturday of every month, 4–8 PM: galleries and shops along High Street open their doors, with street performers and food. Free to wander.", url: "https://shortnorth.org/events/", kids: true, indoor: false, tags: ["art", "walk"] },
];
function recurring(get, h) {
  const rows = [];
  for (const r of recurringFree) h.eachDay(d => { if (r.rule(d)) rows.push({ ...r, uid: `${r.title}-${h.ymd(d)}`, start: h.local(d.getFullYear(), d.getMonth() + 1, d.getDate(), r.h0), end: h.local(d.getFullYear(), d.getMonth() + 1, d.getDate(), r.h1), allDay: false, cost: "Free" }); });
  return rows;
}

export const SOURCES = [
  // Fairfield County
  { key: "vfc", name: "Visit Fairfield County", area: "Fairfield County", fetch: visitFairfield, url: "https://visitfairfieldcounty.org/events/" },
  { key: "fcdl", name: "Fairfield County District Library", area: "Fairfield County", fetch: communico("fcdlibrary.libnet.info", "Lancaster"), url: "https://www.fcdlibrary.org/events", alwaysFree: true },
  { key: "ppl", name: "Pickerington Public Library", area: "Fairfield County", fetch: communico("pickeringtonlibrary.libnet.info", "Pickerington"), url: "https://pickeringtonlibrary.libnet.info/events", alwaysFree: true },
  { key: "cw", name: "City of Canal Winchester", area: "Fairfield County", ics: civic("www.canalwinchesterohio.gov", 25), town: "Canal Winchester", lat: 39.8428, lon: -82.8046, filter: notMeeting, row: civicRow, url: "https://www.canalwinchesterohio.gov/calendar.aspx" },
  { key: "lanc", name: "City of Lancaster", area: "Fairfield County", ics: civic("www.lancasterohio.gov", 14), town: "Lancaster", lat: 39.7137, lon: -82.5993, filter: notMeeting, row: civicRow, url: "https://www.lancasterohio.gov/calendar.aspx" },
  { key: "lancpr", name: "Lancaster Parks & Recreation", area: "Fairfield County", ics: civic("www.lancasterohio.gov", 23), town: "Lancaster", lat: 39.7137, lon: -82.5993, filter: notMeeting, row: civicRow, url: "https://www.lancasterohio.gov/calendar.aspx" },
  { key: "pick", name: "City of Pickerington", area: "Fairfield County", ics: civic("www.pickerington.net", 14), town: "Pickerington", lat: 39.8842, lon: -82.7535, filter: notMeeting, row: civicRow, url: "https://www.pickerington.net/" },
  { key: "ddl", name: "Destination Downtown Lancaster", area: "Fairfield County", fetch: downtownLancaster, url: "https://destinationdowntownlancaster.com/events/" },
  // Columbus
  { key: "excol", name: "Experience Columbus", fetch: experienceColumbus, url: "https://www.experiencecolumbus.com/events/" },
  { key: "dtc", name: "Downtown Columbus", fetch: tec("https://downtowncolumbus.com", { town: "Columbus" }), url: "https://downtowncolumbus.com/events/" },
  { key: "crp", name: "Columbus Recreation & Parks", fetch: tec("https://columbusrecparks.com", { town: "Columbus" }), url: "https://columbusrecparks.com/calendar/" },
  { key: "mp", name: "Metro Parks", fetch: tec("https://www.metroparks.net"), url: "https://www.metroparks.net/events/", kids: true },
  { key: "commons", name: "Columbus Commons", fetch: tec("https://columbuscommons.org", { town: "Columbus" }), lat: 39.9587, lon: -82.9999, address: "160 S High St, Columbus, OH 43215", url: "https://columbuscommons.org/events/list/" },
  { key: "scioto", name: "Scioto Mile", fetch: tec("https://www.sciotomile.com", { town: "Columbus" }), url: "https://www.sciotomile.com/calendar-events/list/" },
  { key: "gahanna", name: "City of Gahanna", ics: civic("www.gahanna.gov", 27), town: "Gahanna", lat: 40.0195, lon: -82.8793, filter: notMeeting, row: civicRow, url: "https://www.gahanna.gov/calendar.aspx" },
  { key: "gahannapr", name: "Gahanna Parks & Recreation", ics: civic("www.gahanna.gov", 25), town: "Gahanna", lat: 40.0195, lon: -82.8793, filter: notMeeting, row: civicRow, url: "https://www.gahanna.gov/calendar.aspx" },
  { key: "grovecity", name: "City of Grove City", ics: civic("www.grovecityohio.gov", 35), town: "Grove City", lat: 39.8814, lon: -83.0929, filter: notMeeting, row: civicRow, url: "https://www.grovecityohio.gov/calendar.aspx" },
  { key: "worthington", name: "City of Worthington", ics: civic("worthington.org", 28), town: "Worthington", lat: 40.0931, lon: -83.0180, filter: notMeeting, row: civicRow, url: "https://worthington.org/calendar.aspx" },
  { key: "reynoldsburg", name: "City of Reynoldsburg", ics: civic("www.reynoldsburg.gov", 14), town: "Reynoldsburg", lat: 39.9548, lon: -82.8121, filter: notMeeting, row: civicRow, url: "https://www.reynoldsburg.gov/calendar.aspx" },
  // On a schedule, no feed
  { key: "recurring", name: "Standing freebies", fetch: recurring, alwaysFree: true },
];
