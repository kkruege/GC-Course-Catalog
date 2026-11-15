# GC Course Catalog

An unofficial, student-built list of **Spring 2027** courses across CUNY Graduate Center programs. Courses are grouped by
program in collapsible sections, with full descriptions, professors, days and times. You can search, filter by day,
time, professor, program and format, or see everything on a weekly calendar.

Made for the GC AI-Assisted Coding Class. It is not an official Graduate Center site; always confirm details on CUNYfirst.

## How it works

- `scraper/` collects the listings. A GitHub Action runs it **every Monday**. You can also run it any time from the
  repo's **Actions** tab ("Update courses and publish site" → "Run workflow").
  - The program list comes from the [GC catalog](https://gc.catalog.cuny.edu/departments): every department, certificate and concentration.
  - Each program's Spring 2027 courses come from its course page on gc.cuny.edu, or from a program spreadsheet (Psychology).
  - If a page has no description, title or credits for a course, the scraper fills them in from the GC catalog. The
    website labels those fields **Verify**.
  - If a program hasn't posted Spring 2027 yet, the site shows **Not Yet Posted**. If a page can't be reached in a given
    week, the site keeps the previous week's courses for that program.
- `docs/` is the website, served by GitHub Pages. `docs/data/courses.json` is the scraped data.
- `debug/` stores the raw text read from each source, for fixing a parser when a page changes.

## Changing sources

Edit `scraper/sources.mjs`:

- `OVERRIDES`: the course page (or Google Sheet) for a program, keyed by its catalog code (e.g. `ENGL-GRD`).
- `CONCENTRATIONS`: programs that aren't in the catalog's department list.
- `TERM`: the semester to collect. Change it to move on to Fall 2027.

Google Sheets must be shared as "Anyone with the link can view".

## Running locally

```bash
npm install
npx playwright install chromium
npm run scrape            # all programs (takes ~10 minutes)
node scraper/scrape.mjs ENGL-GRD PSYC-GRD   # just a few
npm run serve             # open http://localhost:8080
```

To use the Chrome or Edge already on your computer instead of downloading Playwright's Chromium (~300 MB), skip
`npx playwright install chromium` and run with `BROWSER_CHANNEL=chrome` (or `msedge`).

## Updating from saved pages

gc.cuny.edu currently blocks automated visits ("403 blocked by site security"), so the weekly run can't read the
department pages and keeps the last listing it has. To refresh the courses by hand:

1. Open [`saved-pages/CHECKLIST.md`](saved-pages/CHECKLIST.md). For each program, open its course page in your browser,
   press Ctrl+S, choose **Webpage, HTML Only**, and save it into `saved-pages/` with the file name shown (e.g. `ENGL-GRD.html`).
2. Run the scraper on the saved files (the GC catalog and Google Sheets are still read online):

   ```bash
   BROWSER_CHANNEL=chrome node scraper/scrape.mjs --saved
   ```

3. Commit and push `docs/data/courses.json`; GitHub Pages republishes the site.

The saved `.html` files stay on your computer (they're in `.gitignore`). Programs without a saved file keep their last
listing, or show **Not checked yet**. The site's "Checked" date for a program is the date its page was saved.
