# Beavy's Day Out

Free and cheap things to do around Columbus and Fairfield County, picked for today's weather. One page, no accounts, no ads. A sibling to [Mia's Almanac](https://github.com/acompora19/mias-almanac) and [Mangia Mangia](https://github.com/acompora19/mangia-mangia).

## Files

- `index.html` is the whole app. `dayout-core.js` holds the date, weather and sorting logic it shares with the fetcher.
- `data/standbys.json` is the hand-kept list of places that are always a good idea (parks, free museum days, trails). Edit it to add or fix a spot; every entry has a `verified` date and a `url` to check against.
- `data/events.json` is written by the fetcher. Don't edit it by hand; it gets overwritten.
- `fetch/events.mjs` pulls the calendars listed in `fetch/sources.mjs` and writes `data/events.json`. `.github/workflows/events.yml` runs it every 6 hours.
- `sw.js` and `manifest.json` let the app install to a phone home screen and open without signal.
- Beavy's pictures (`gear-*.webp`, `holiday-*.webp`) are copies from Mia's Almanac.

## Where the events come from (all free, no keys)

Fairfield County: Visit Fairfield County, Fairfield County District Library, Pickerington Public Library, the cities of Canal Winchester, Lancaster and Pickerington, Destination Downtown Lancaster.
Columbus: Experience Columbus, Downtown Columbus, Columbus Recreation & Parks, Metro Parks, Columbus Commons, Scioto Mile, and the cities of Gahanna, Grove City, Worthington and Reynoldsburg.
Plus a few standing freebies with no calendar feed: CMA free Sundays, Franklin Park Conservatory Community Day (first Sunday), Short North Gallery Hop (first Saturday).

Cost is read from each calendar's own price field where it has one, otherwise from the words in the listing ("free", "$5"). Treat it as a hint and check the link.

## Adding a source

Add an entry to `SOURCES` in `fetch/sources.mjs` (an iCal link, or a small `fetch` function for a JSON calendar), push, and the workflow runs. The run's log on the Actions tab shows a table of how many events each source returned.

## Hosting

Repo → Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)` → Save.
Then Actions → "Fetch events" → "Run workflow" once to fill in the first events list.
