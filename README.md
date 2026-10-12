# OpenTable search and discovery prototype (Algolia)

A restaurant search and discovery demo built for the Algolia Solutions Engineering assignment. It replaces a ~10-year-old Elasticsearch experience with one designed around OpenTable's two kinds of users:

- **Known-item searchers** who know the restaurant and want to book fast. They need forgiving, precise search: typos, partial names, concatenated words, and the right location of a multi-location restaurant.
- **Explorers** who don't know what they want yet. They need browsing, refinement, sorting, a map, and a landing view that inspires.

The business goals this supports: higher search quality, a more modern experience, more platform usage, and more conversion from search to booking.

Live demo: _<add link if deployed>_  ·  Test log: [`TESTING.md`](./TESTING.md)

## Run it

1. Put `restaurants_list.json` and `restaurants_info.csv` in `data/`
2. `cp .env.example .env` and fill in: App ID, Admin key (scripts only), Search-only key (browser)
3. `npm install` and `pip3 install pandas`
4. `npm run prepare-data` (writes `records.json` and `data_report.json`)
5. `npm run index` (settings, synonyms, replicas, records; can take a few minutes)
6. `npm run dev`

The Admin key is only used by `scripts/index.js`. The browser app uses the search-only key, and `.env` is gitignored.

## Data preparation (`scripts/prepare.py`)

**How the files were joined.** `restaurants_list.json` (5,000 records) and `restaurants_info.csv` (5,000 rows) are joined 1:1 on `objectID`, with pandas' `validate="1:1"` so duplicate IDs would raise an error. No orphans on either side. The CSV is **semicolon-delimited** and is read as text first, with explicit casts afterward.

**Cleanup**
- Cast `stars_count` to a number and `reviews_count` to an integer
- Normalized and de-duplicated `payment_options`; trimmed whitespace in text fields
- Kept the formatted phone number (the two files use different formats)
- Dropped any record with missing geo or rating (none were dropped; counts are in `data_report.json`)

**Enrichment**
| Field | What it is | Why |
|---|---|---|
| `cuisine` | Browsable group built from the many raw `food_type` values (e.g. "Steak" and "Brazilian Steakhouse" become "Steakhouse") | A usable cuisine facet. The raw `food_type` stays searchable, so "sushi" still matches. |
| `quality_score` | Bayesian average of rating and review count (prior weight m = 100) | A 5.0 from 3 reviews should not beat a 4.7 from 3,000. Stored as an integer for custom ranking. |
| `rating_floor` | Integer rating bucket | Powers the "4 & up" rating filter |
| `price_tier` / `price_label` | 1 to 3 and "$" to "$$$" from `price_range` | Sorting and display |
| `name_normalized` | Lowercase name without spaces or punctuation | Helps concatenated queries ("shakeshack") |
| `same_name_count` | How many records share a normalized name | Flags multi-location restaurants so the UI can warn users |

**Assumptions and data findings**
- `price` (JSON) and `price_range` (CSV) disagree on roughly 220 records. I treated `price_range` as the source of truth.
- Identical normalized names are treated as the same brand. A few will be unrelated restaurants in different cities, so the UI always shows neighborhood and city.
- The dataset contains **no Chicago restaurants**, so location fallbacks need an explicit "pick a city" path.
- A small number of names (23) appear in more than one location.

## Index configuration (`scripts/index.js`)

| Setting | Value | Why |
|---|---|---|
| `searchableAttributes` | name + name_normalized, cuisine + food_type, neighborhood, city + state, area, address | Name first: known-item users have the highest booking intent and must never be outranked by a cuisine match (Experiment A) |
| `attributesForFaceting` | searchable cuisine, searchable neighborhood, price_range, dining_style, payment_options, rating_floor, city, state | Filters and in-facet search for long lists |
| `customRanking` | desc quality_score, desc reviews_count | Trustworthy rating first, then proven popularity (Experiment B) |
| Typo tolerance | 1 typo from 4 letters, 2 typos from 8 letters (defaults) | Forgiving for short names like "sushi"; stricter values returned nothing for "susi" (Experiment D) |
| `ignorePlurals`, `removeStopWords` | true | Handles "the", "and", plurals |
| `removeWordsIfNoResults` | firstWords | "cheap italian" has no exact match, so drop "cheap" and show Italian instead of an empty page (Experiment E) |
| Virtual replicas | `restaurants_rating`, `restaurants_price_asc` | Sort options without duplicating records |
| `relevancyStrictness` (replicas) | 80 | 100 returned too few results, 50 let weak matches climb the sort (Experiment F) |
| Synonyms | bbq / barbecue, steak / steakhouse / chophouse, sushi / japanese, pizza / pizzeria, and others | Bridges how users write words and how the data does |
| Ranking formula | Default (typo, geo, words, filters, proximity, attribute, exact, custom) | Text relevance first, then distance, then quality. A known-item search is never overridden by proximity. |

**Location and ranking at query time (`main.js`)**
- `aroundRadius: "all"` ranks by distance without excluding far results.
- `aroundPrecision` buckets distance (1-mile steps nearby, 8 km beyond about 5 miles), so quality can break ties between "about as close" restaurants. Without it, exact distance decides and quality never gets a say (Experiment C).
- Location fallback chain: browser GPS, then IP-based location, then a manual city picker.

## The search experience

**For known-item search**
- Autocomplete with typo-tolerant, location-aware name suggestions
- Prefix matching, concatenated-name handling, and highlighted matches
- Distance on every card, and a note when several locations share a name
- Reserve button on every card, wired to conversion events

**For discovery**
- Cuisine chips with live counts, plus price, rating, dining style, neighborhood (searchable) and payment filters
- Sort by best match, highest rated, or price
- Map synced to the results, with "Search this area"
- Results that update as you type, a helpful empty state, and a graceful no-results path
- Click and conversion events sent through Algolia Insights, ready for analytics, personalization and A/B testing

## Testing and findings

Full log with baseline tests, before and after for each experiment, and decisions: [`TESTING.md`](./TESTING.md). Highlights:

- **Geo bucketing (C):** with exact distance, results were strictly nearest-first and quality was ignored. Bucketing lets better-rated restaurants surface among nearby ones.
- **Custom ranking (B):** ranking on stars alone promoted restaurants with very few reviews. The Bayesian score fixed that.
- **No-results behavior (E):** `cheap italian` returned nothing until words could be dropped. The better long-term fix is intent enrichment, not just query relaxation.
- **Name vs. cuisine (A):** cuisine-first improved discovery queries like "steak" but hurt known-item search, so I kept name first and used the cuisine chips for precise discovery. Typed "steak" returns 538 results versus 484 for the Steakhouse chip, since typing also matches names and synonyms in other cuisines.
- **Map search (G):** the first version silently returned unfiltered results. I found it by testing, and fixed it by sending the bounding box alone.
- **Other bugs found and fixed during testing:** distances didn't display, and results didn't update while typing because the query never reached InstantSearch.

## What I'd do next with OpenTable

1. **Intent enrichment and query rules.** Map words like "cheap", "romantic" and "brunch" to real attributes (price tier, occasion, meal period), so natural-language queries work instead of falling back to word removal.
2. **Cuisine-aware ranking.** Detect when a query is a cuisine word and boost cuisine matches, while keeping names first for known-item queries.
3. **Personalization and re-ranking** from the click and conversion events already collected.
4. **A/B testing** relevance changes (for example `relevancyStrictness`, `aroundPrecision`) against booking conversion.
5. **A merchandised landing page** ("top rated near you", trending, by cuisine) for empty-query visits.
6. **Re-rank map-area results by distance from the map center.**

## Tooling

Built with InstantSearch.js, Autocomplete, Leaflet and Vite, with Python for data preparation. I used AI assistance for scaffolding and debugging, and I tested and tuned the configuration myself against the dataset; every setting above is explained in `scripts/index.js` and `TESTING.md`.
