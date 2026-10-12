# Relevance Testing Log

Personas: **K** = knows what they want (known-item). **D** = discovering.

---

## 1. Baseline (before any tuning)

| # | Persona | Query / state | Expected | Observed | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | K | Exact name of a restaurant in NYC (River Cafe) | Top result, correct restaurant, highlighted name | River Cafe appeared, excluding other locations by end of word. | Pass |
| 2 | K | Partial name, first 4 to 5 letters of a name | Prefix match returns it in the top results | Peacock appears as 3rd result with PEA spelled, once C is added, it becomes 1st option. | Pass |
| 3 | K | `pappass` (misspelled), location NYC | Pappas results via typo tolerance; text match beats distance, so Texas locations can appear first with a large distance shown | NYC location selected but only Texas locations shown. No distance displayed. | Pass |
| 4 | K | `pappas` with location NYC, then Houston | Same restaurants, but the nearer location ranks first when one exists | Same restaurants, but the nearer location ranks first when one exists | Pass |
| Bug: | Results didn’t update while typing, so I traced it to the query never reaching InstantSearch and fixed it with a virtual search box.”  |  |  |  |  |
| 8 | D | `italian` | Italian restaurants nearest first, quality breaking ties within a distance bucket |   • All results shown are Italian restaurants.
  • Distance is increasing in order
 |  |
| 9 | D | `itallian` (2 typos) | Same results as `italian` | Used ‘itallian’ & ‘itajian.’
Same results as ‘italian’ |  |
| 10 | D | `steak` | Steakhouses (synonym group steak / steakhouse / chophouse) |   • steak shows 538 results with both steak in the name and steakhouse as cuisine
  • steakhouse chip yields 484 results |  |
| 11 | D | `bbq` | Barbecue places via synonym | typing in ‘bbq’ gives me results for barbecue |  |
| 12 | D | `grill` | Mix of names containing “grill” and grills by cuisine; check whether names outrank cuisines | names with grill in them do outrank cuisinse |  |

---

## 2. Experiments (one change at a time)

### Experiment A: searchable attribute order

- **Hypothesis:** with `name` first, searches like `american` favor restaurants with that word in the *name* over true American-cuisine restaurants. That helps known-item search and hurts discovery.
- **Change:** in `searchableAttributes`, move `"cuisine,food_type"` above `"name,name_normalized"`.
- **Retest:** queries 1, 3, 12, 13.
- **Before:**
    - Top 10 NYC Steak Query
        - Bobby Vans, Liberty Prime, Knickerbocker, Frankie&Johnnie, Staghorn, Uncle Jack, BLT Prime, Statler, WestSide Steakhouse, City Lobster
- **After:**
    - Top 10 NYC Steak Query
        - Bobby Vans, Knickerbocker, Liberty Prime, Frankie&Johnnie, BLT Prime, Staghorn, Uncle Jack, Statler, Quality Italian, Palm Restaurant
- **Decision and why:**
    - **Decision:** Keep `name` first in `searchableAttributes` (`"name,name_normalized"` ahead of `"cuisine,food_type"`).
    - **Why:** Cuisine-first improved discovery queries like `steak`, but it made known-item searches worse. The known-item diner is the highest-intent user, since they already know where they want to book. If they type a name and a cuisine match outranks the restaurant they meant, they may not find it, and that’s a lost booking. A discovery query that ranks slightly imperfectly costs much less, because those users are browsing and have other ways to narrow down.

### Experiment B: custom ranking

- **Hypothesis:** the `quality_score` protects against 5.0 ratings with few reviews. Ranking only by `reviews_count` favors big, famous restaurants; ranking only by `stars_count` favors tiny samples.
- **Change:** try (1) `["desc(stars_count)"]` only, (2) `["desc(reviews_count)"]` only, then restore `["desc(quality_score)", "desc(reviews_count)"]`.
- **Retest:** `italian`, `steak`, empty query.
- **Before:** River Cafe, Marc Forgione, Raoul’s, Peasant, Tamarind - Tribeca
- **After:** The Mark Dine & Tap, Cafe Navarre, LaSalle Grill, Ruth’s Chris Steak House, Sorin’s
- **Decision and why:**
    - **Decision:** Keep the`quality_score` as the primary custom ranking, with `reviews_count` as the second tiebreaker (`["desc(quality_score)", "desc(reviews_count)"]`). Reject ranking on `stars_count` alone.
    - **Why:** A star rating is only trustworthy when enough reviews stand behind it. Ranking on stars alone let restaurants with very few reviews but a high rating rise to the top, because a 5.0 from a handful of reviews outranks a 4.7 from thousands. For OpenTable, that means the first results a diner sees are the ones least likely to disappoint, which supports booking conversion.

### Experiment C: geo precision

- **Hypothesis:** exact distance sorting makes quality irrelevant, because two restaurants are never the same distance away. Bucketing distance (`aroundPrecision`) lets quality decide among “about as close” results.
- **Changed:** in `main.js`, commented out the `aroundPrecision` array from `geoParams()`,
- **Retest:** `italian` alone showed no visible difference in dense Manhattan, since the empty query exposed the effect better.
- **Before:**
    - Top 4 in NYC, No Query
        - River Cafe, Marc Forgione, Raoul’s, Peasant
        - **Without bucketing:** distance is compared exactly, so two restaurants are never equally close. The ranking never reaches `quality_score`, and the list is strictly nearest-first, whatever the quality.
- **After:**
    - Top 4 in NYC, No Query
        - Woolsworth Tower Kitchen, Dark Horse, Benares - Tribeca, Ecco
        - **With bucketing:** everything within the same mile counts as equally close, so quality decides inside each bucket. That’s why distances jump around slightly (0.8, 0.3, 0.9...) while the best-rated places move up.
- **Decision and why:**
    - **Decision:** restore the `aroundPrecision` block. For OpenTable, the next-nearest 4.6-star restaurant beats a 3.2-star one that’s 300 meters closer, and a diner picking where to eat would agree. Uncommented it in `main.js`.
    - **Why:** Bucketing makes the distance numbers look slightly out of order, which can seem like a bug to a user. Two mitigations: label the default sort “Best match nearby,” and offer a “Nearest first” option for people who want strict distance.

### Experiment D: typo tolerance (queries 3, 7, 9)

- **Hypothesis:** short names tolerate fewer typos before false matches appear.
- **Change:** `minWordSizefor1Typo` 4 → 5; `minWordSizefor2Typos` 8 → 9.
- **Retest:** `susi` instead of *sushi*
- **Before:**
    - Susi - Fujiyama
- **After:**
    - Susi - No Result
- **Decision and why:**
    - **Decision**: Keep the defaults (`minWordSizefor1Typo: 4`, `minWordSizefor2Typos: 8`). Reject the stricter 5 and 9.
    - **Why:** The stricter thresholds made `susi` return nothing, so a diner who mistyped a short name or cuisine hit a dead end. Missing a real restaurant costs more than showing a loosely matched one. A known-item user who has already decided where to eat can lose the booking entirely, and a false match on a short word costs only a glance at the result list

### Experiment E: no-result and long queries (queries 20, 21, 22)

- **Hypothesis:** requiring all words returns nothing for natural-language queries like `cheap italian`.
- **Change:** add `removeWordsIfNoResults: "lastWords"` (or `"allOptional"`) to settings.
- **Retest:** `cheap italian`
- **Before:**
    - cheap+italian gave me no results
- **After:**
    - cheap+italian gave me results
- **Decision and why:**
    - Decision: Enable `removeWordsIfNoResults: "firstWords"`
    - Why: `cheap italian` returned nothing because “cheap” isn’t in any record, so a user with a clear intent got an empty page. With `firstWords`, Algolia retries without the leading word and returns Italian restaurants, which is the closest match to what the user wanted

### Experiment F: sort strictness (queries 25, 26)

- **Hypothesis:** lower `relevancyStrictness` on the sort replicas lets less relevant items climb when sorting.
- **Change:** set `relevancyStrictness` to 100, then 50, on `restaurants_rating`.
- **Retest:** `italian` sorted by Highest rated.
- **Before:**
    - Results were reasonable and appeared to be a middle ground.
- **After:**
    - at 100, only 1 result appeared
    - at 50, too many results appeared.
- **Decision and why:**
    - **Decision:** Keep `relevancyStrictness: 80` on the sort replicas (`restaurants_rating` and `restaurants_price_asc`).
    - **Why:** The setting decides how many weaker matches survive when results are re-sorted. It does more than reorder them, and your results show that:
        - **At 100**, a sorted search for `steak` returned a single result. Sorting by rating then shows only the very best text matches, which is too narrow, because a diner who picks “Highest rated” still expects a list to choose from.
        - **At 50**, the list was too long. Loosely related matches, including name-only and typo matches, stay in and can climb the list on their rating alone, so relevance stops guiding the sort.
        - **At 80**, results stay genuinely relevant and there are still enough of them to make a sorted list useful. A diner who changes the sort wants a different order of relevant restaurants, not a different set of them.

### Experiment G: map area and geo ranking (query 27)

- **Hypothesis:** applying a bounding box changes which results appear, but I need to verify whether distance ranking still applies inside the box.
- **Observe:** pan the map, click “Search this area,” search `italian`.
- **Result:**
    - **Before:** the first version combined the bounding box with distance-from-city settings. Clicking “Search this area” didn’t filter anything. The count stayed the same, results came from other cities (Orlando, Houston), and the map had no markers.
    - **After:** sending the bounding box on its own filtered correctly. In the Brooklyn view, `italian` dropped from about 800 matches to 8, and markers appeared inside the map.
- **Decision and why:**
    - **Decision:** Keep “Search this area” as a separate bounding-box search that replaces distance ranking. Inside the box, results rank by relevance and quality instead of distance. Choosing a city or clicking “Clear map area” restores distance ranking.
    - **Why:** A user who pans the map is saying “show me what’s here,” so the visible area should define the result set, and any restaurant outside the box showing up would feel wrong. Combining the box with distance-from-city ranking in one request was unreliable, so I separated them. That also gave the clearest behavior: the map controls the scope, and quality decides the order within it.

---

## 3. Behavior by query type (summary table for the debrief)

| Query type | How the experience behaves | Settings responsible |
| --- | --- | --- |
| Specific (known-item) | Exact and partial names find the restaurant quickly (e.g. “peac” puts Peacock first; at “pea” several candidates compete). Text match beats distance: `pappas` from New York returns the Texas locations, and selecting Houston puts the nearest one first. | `searchableAttributes` (name first), ranking order (typo > geo > words …) |
| Misspelled | Typos recover: `pappass` finds Pappas and `itallian` returns Italian restaurants. With the default thresholds `susi` still returns results. Stricter thresholds (5 and 9) returned nothing, so I kept the defaults. | typo tolerance, `minWordSizefor1Typo` / `2Typos` |
| Broad | Cuisine words return many results, ordered by distance band and then quality. `steak` returns 538 results versus 484 for the Steakhouse chip, because typing also matches names and synonyms. | custom ranking, `aroundPrecision` |
| Ambiguous | Name matches outrank cuisine matches. All 343 “grill” results are name matches (no “Grill” cuisine exists), and `steak` surfaces name-only matches like Japanese steakhouses. Chips and filters give a precise way to narrow. | attribute order, facets for refinement |
| Location-sensitive | Nearer restaurants rank higher when the text match is equal. Changing the city re-sorts the same results. Location falls back from GPS to IP to a city picker, and the data has no Chicago restaurants. | `aroundLatLng` / IP fallback, `aroundRadius: "all"`, `aroundPrecision` |
| Empty | Shows nearby, well-rated restaurants. With distance bucketing, quality can reorder results within each distance band. Without it, results were strictly nearest-first. Recommendation: a merchandised “top rated near you” landing. | geo + custom ranking; recommendation: merchandised “top rated near you” |
| No results | `cheap italian` returned nothing until `removeWordsIfNoResults: "firstWords"` was set, then it returned Italian restaurants. The UI has a clear “no tables match” state with a one-click reset. | empty-state UI, `removeWordsIfNoResults` (if adopted) |

---

### 4. Final summary

**Three changes that measurably improved results**

1. **Distance bucketing (`aroundPrecision`, Experiment C).** With the empty query in New York, removing it made results strictly nearest-first with quality ignored. With it, better-rated restaurants surfaced among nearby ones, so I kept it.
2. **`quality_score` as primary custom ranking (Experiment B).** Ranking on stars alone moved restaurants with very few reviews to the top. The Bayesian score, with review count as a tiebreaker, favors ratings backed by real volume.
3. **`removeWordsIfNoResults: "firstWords"` (Experiment E).** `cheap italian` went from an empty page to Italian results, which keeps the user in the booking flow.

**Two things I tested and chose not to change, and why**

1. **Searchable attribute order (Experiment A).** Cuisine-first improved discovery queries like `steak` but made name searches worse. I kept name first, because a known-item miss costs the booking and the cuisine chips cover precise discovery.
2. **Typo tolerance thresholds (Experiment D).** Stricter limits made `susi` return nothing. I kept the more forgiving defaults, since missing a real restaurant costs more than showing a loose match.

(Also kept as is: `relevancyStrictness` of 80 on the sort replicas. At 100 a sorted `steak` search returned one result, and at 50 there were too many weak matches.)

**Bugs found through testing and fixed**

- Distances didn’t display on the cards, so I now compute them in the browser from the selected location.
- Results didn’t update while typing, because the autocomplete query never reached InstantSearch. A hidden search box widget fixed it.
- The two map buttons overlapped, because a CSS rule overrode the `hidden` attribute.
- “Search this area” returned unfiltered results (Experiment G). Sending the bounding box on its own fixed it, and an Italian search dropped from about 800 results to 8 inside the Brooklyn view.

**Data observations worth telling the customer**

- `price` (JSON) and `price_range` (CSV) disagree on roughly 220 of 5,000 records; I used `price_range` as the source of truth.
- 114 raw cuisine values with overlaps; I added a browsable `cuisine` group and kept the raw value searchable.
- The dataset has no Chicago restaurants, so location fallbacks need an explicit “pick a city” path.
- 23 names appear in more than one location.

**Recommendations for OpenTable**

1. **Query rules and enrichment for intent words.** “cheap”, “romantic” and “brunch” have no matching attribute today, so add price tier, occasion and meal-period fields, and map those words to them.
2. **Cuisine-aware ranking.** Detect cuisine words and boost cuisine matches while keeping names first for known-item queries.
3. **Personalization and re-ranking** using the click and conversion events the demo already sends (confirm they appear in the Events tab before claiming this).
4. **A/B test relevance changes** (for example `aroundPrecision` and `relevancyStrictness`) against booking conversion.