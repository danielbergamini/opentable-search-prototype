# Relevance testing log

Prospect: OpenTable (replacing a ~10-year-old Elasticsearch stack).
Goal of this log: show how I tested search quality, what I changed, and why.

**How to use this file**
- "Expected" is my hypothesis *before* running the query (filled in for you).
- Fill in "Observed" yourself after running it. Do not copy expectations into it.
- Screenshot each baseline into `docs/screenshots/` (`01-baseline-pappass.png`, etc.).
- Change one setting at a time in `scripts/index.js` (or `aroundPrecision` in `main.js`), run `npm run index`, refresh, retest, then fill in the "After" columns.
- Default location for baseline runs: **New York** (picker in the header).

Personas: **K** = knows what they want (known-item). **D** = discovering.

---

## 1. Baseline (before any tuning)

| # | Persona | Query / state | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| 1 | K | Exact name of a restaurant in NYC (pick one from the results list) | Top result, correct restaurant, highlighted name | | |
| 2 | K | Partial name, first 4 to 5 letters of a name | Prefix match returns it in the top results | | |
| 3 | K | `pappass` (misspelled), location NYC | Pappas results via typo tolerance; text match beats distance, so Texas locations can appear first with a large distance shown | | |
| 4 | K | `pappas` with location NYC, then Houston | Same restaurants, but the nearer location ranks first when one exists | | |
| 5 | K | A concatenated name (a two-word name typed without the space) | Matches via `name_normalized` and/or Algolia word concatenation | | |
| 6 | K | A name from the repeated-names list (see `data_report.json`: 23 names appear more than once) | All locations shown, nearest first, with the "locations share this name" note | | |
| 7 | K | `resturant` | Typo handled, or noisy results if "restaurant" is rare in the data; note which | | |
| 8 | D | `italian` | Italian restaurants nearest first, quality breaking ties within a distance bucket | | |
| 9 | D | `itallian` (2 typos) | Same results as `italian` | | |
| 10 | D | `steak` | Steakhouses (synonym group steak / steakhouse / chophouse) | | |
| 11 | D | `bbq` | Barbecue places via synonym | | |
| 12 | D | `grill` | Mix of names containing "grill" and grills by cuisine; check whether names outrank cuisines | | |
| 13 | D | `american` | Ambiguity check: name matches vs cuisine matches. Which ranks first? | | |
| 14 | D | `union` | Ambiguous: restaurant names, neighborhoods ("Union Square"), maybe addresses | | |
| 15 | D | `pizza` in NYC, Denver, Honolulu | Results change with location; distances sensible | | |
| 16 | D | Empty query, location NYC | Nearest and best-rated first; judge whether this feels like a useful landing page | | |
| 17 | D | Empty query, then click one cuisine chip | Counts update, results narrow, chip highlighted | | |
| 18 | D | Italian + $$ (`$31 to $50`) + rating 4 & up | Narrowed results; facet counts update; no dead-end values | | |
| 19 | D | Neighborhood search-in-facet (type part of a neighborhood name) | Matching neighborhoods listed with counts | | |
| 20 | D | `cheap italian` | Likely zero or odd results: "cheap" is not in the data | | |
| 21 | D | `romantic dinner` | Likely zero results: no such attribute in the data | | |
| 22 | D | `brunch` | Probably weak: no brunch field. Note what shows up | | |
| 23 | - | `xyzzy` | Empty state with a clear message and "Clear search and filters" button | | |
| 24 | - | Block location in the browser, reload | IP-based fallback label and results; picker still works | | |
| 25 | D | Sort: Highest rated, query `italian` | Still relevant (relevancyStrictness 80); ordered by rating | | |
| 26 | D | Sort: Price low to high, query `italian` | Cheaper first, relevance preserved | | |
| 27 | D | Map: pan, click "Search this area" | Results limited to the box; check how distance ranking behaves with the box applied | | |

---

## 2. Experiments (one change at a time)

Fill in one block per experiment. Keep the ones that improved results; revert and explain the ones that did not.

### Experiment A: searchable attribute order (queries 12, 13, 14)
- **Hypothesis:** with `name` first, searches like `american` favor restaurants with that word in the *name* over true American-cuisine restaurants. That helps known-item search and hurts discovery.
- **Change:** in `searchableAttributes`, move `"cuisine,food_type"` above `"name,name_normalized"`.
- **Retest:** queries 1, 3, 12, 13.
- **Before:**
- **After:**
- **Decision and why:** (Expect a trade-off: cuisine queries improve, name queries get worse. Explain which persona you prioritized, or why you kept name first and handled cuisine intent another way.)

### Experiment B: custom ranking (query 8, 10)
- **Hypothesis:** the Bayesian `quality_score` protects against 5.0 ratings with few reviews. Ranking only by `reviews_count` favors big, famous restaurants; ranking only by `stars_count` favors tiny samples.
- **Change:** try (1) `["desc(stars_count)"]` only, (2) `["desc(reviews_count)"]` only, then restore `["desc(quality_score)", "desc(reviews_count)"]`.
- **Retest:** `italian`, `steak`, empty query.
- **Before:**
- **After:**
- **Decision and why:**

### Experiment C: geo precision (queries 8, 15, 16)
- **Hypothesis:** exact distance sorting makes quality irrelevant, because two restaurants are never the same distance away. Bucketing distance (`aroundPrecision`) lets quality decide among "about as close" results.
- **Change:** in `main.js`, remove the `aroundPrecision` array from `geoParams()`, then try a single value (e.g. `800`, `3200`).
- **Retest:** `italian`, empty query, `pizza`.
- **Before:**
- **After:**
- **Decision and why:**

### Experiment D: typo tolerance (queries 3, 7, 9)
- **Hypothesis:** short names tolerate fewer typos before false matches appear.
- **Change:** `minWordSizefor1Typo` 4 → 5 (then 3); `minWordSizefor2Typos` 8 → 9.
- **Retest:** `susi`, `sushii`, `pappass`, `itallian`, a short restaurant name with one typo.
- **Before:**
- **After:**
- **Decision and why:**

### Experiment E: no-result and long queries (queries 20, 21, 22)
- **Hypothesis:** requiring all words returns nothing for natural-language queries like `cheap italian`.
- **Change:** add `removeWordsIfNoResults: "lastWords"` (or `"allOptional"`) to settings.
- **Retest:** `cheap italian`, `romantic dinner`, `brunch`.
- **Before:**
- **After:**
- **Decision and why:** (Compare with the better long-term fix: query rules or enrichment tags such as `price_tier`, `occasion`, `meal_period` so "cheap" and "brunch" map to real attributes.)

### Experiment F: sort strictness (queries 25, 26)
- **Hypothesis:** lower `relevancyStrictness` on the sort replicas lets less relevant items climb when sorting.
- **Change:** set `relevancyStrictness` to 100, then 50, on `restaurants_rating`.
- **Retest:** `italian` sorted by Highest rated.
- **Before:**
- **After:**
- **Decision and why:**

### Experiment G: map area and geo ranking (query 27)
- **Hypothesis:** applying a bounding box changes which results appear, but I need to verify whether distance ranking still applies inside the box.
- **Observe:** pan the map, click "Search this area," search `italian`.
- **Result:**
- **Decision and why:** (Keep as is, or change the behavior and explain.)

---

## 3. Behavior by query type (summary table for the debrief)

| Query type | How the experience behaves | Settings responsible |
|---|---|---|
| Specific (known-item) | | `searchableAttributes` (name first), ranking order (typo > geo > words ...) |
| Misspelled | | typo tolerance, `minWordSizefor1Typo` / `2Typos` |
| Broad | | custom ranking, `aroundPrecision` |
| Ambiguous | | attribute order, facets for refinement |
| Location-sensitive | | `aroundLatLng` / IP fallback, `aroundRadius: "all"`, `aroundPrecision` |
| Empty | | geo + custom ranking; recommendation: merchandised "top rated near you" |
| No results | | empty-state UI, `removeWordsIfNoResults` (if adopted) |

---

## 4. Final summary (write this last)

**Three changes that measurably improved results**
1.
2.
3.

**Two things I tested and chose not to change, and why**
1.
2.

**Data observations worth telling the customer**
- `price` (JSON) and `price_range` (CSV) disagree on roughly 220 of 5,000 records; I used `price_range` as the source of truth.
- 114 raw cuisine values with overlaps; I added a browsable `cuisine` group and kept the raw value searchable.
- The dataset has no Chicago restaurants, so location fallbacks need an explicit "pick a city" path.
- 23 names appear in more than one location.

**Recommendations for OpenTable**
1. Query rules / enrichment for intent words (cheap, romantic, brunch).
2. Personalization and re-ranking using click and conversion events (Insights is already wired up).
3. A/B test relevance changes in Algolia against booking conversion.
