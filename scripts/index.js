// Pushes records.json to Algolia and applies every index setting in one place.
// Run from the project root:  node scripts/index.js
import "dotenv/config";
import fs from "node:fs";
import algoliasearch from "algoliasearch";

const { APP_ID, ADMIN_KEY } = process.env;
if (!APP_ID || !ADMIN_KEY) {
  console.error("Set APP_ID and ADMIN_KEY in .env (see .env.example)");
  process.exit(1);
}

const INDEX = "restaurants";
const REPLICA_RATING = "restaurants_rating";
const REPLICA_PRICE = "restaurants_price_asc";

const client = algoliasearch(APP_ID, ADMIN_KEY);
const index = client.initIndex(INDEX);

const records = JSON.parse(fs.readFileSync(new URL("../records.json", import.meta.url), "utf8"));
console.log(`Loaded ${records.length} records`);

// ------------------------------------------------------------------ primary index settings
const settings = {
  // WHAT is searched, in priority order. Earlier attributes win ties on the "attribute" criterion.
  // "name,name_normalized" share one priority slot: the normalized copy lets "pappasbros" match
  // "Pappas Bros." (concatenated names are a stated pain point).
  searchableAttributes: [
    "name,name_normalized",
    "cuisine,food_type",
    "neighborhood",
    "city,state",
    "area",
    "address",
  ],

  // WHAT can be filtered / faceted. searchable() adds in-facet search for long lists.
  attributesForFaceting: [
    "searchable(cuisine)",
    "searchable(neighborhood)",
    "price_range",
    "dining_style",
    "payment_options",
    "rating_floor",
    "city",
    "state",
  ],

  // HOW ties are broken after text relevance and geo. Bayesian quality first, then volume.
  customRanking: ["desc(quality_score)", "desc(reviews_count)"],

  // Typo tolerance (explicit so it can be explained in the debrief).
  typoTolerance: true,
  minWordSizefor1Typo: 4, // "itallian" (8) gets 1 typos; "sushi" (5) gets 1
  minWordSizefor2Typos: 8,
  disableTypoToleranceOnAttributes: ["address"], // street numbers/names: typos cause false matches

  // Query-time language handling
  queryLanguages: ["en"],
  ignorePlurals: true,
  removeStopWords: true, // "the" / "and" in "the capital grille" or "bar and grill"
  removeWordsIfNoResults: "firstWords", // "cheap italian" has no match, so drop "cheap" and retry

  // Performance / payload
  attributesToRetrieve: [
    "name", "cuisine", "food_type", "neighborhood", "city", "state", "address", "price_label",
    "price_range", "dining_style", "stars_count", "reviews_count", "image_url", "reserve_url",
    "_geoloc", "same_name_count", "phone",
  ],
  attributesToHighlight: ["name", "cuisine", "neighborhood"],
  attributesToSnippet: [],

  // Sort options are virtual replicas: they re-sort the same data with no extra record storage.
  replicas: [`virtual(${REPLICA_RATING})`, `virtual(${REPLICA_PRICE})`],
};

// The default ranking formula is kept on purpose:
//   typo > geo > words > filters > proximity > attribute > exact > custom
// Text relevance first, then distance, then quality. Geo "buckets" are widened at query time
// (aroundPrecision in main.js) so quality can actually break ties between nearby restaurants.

console.log("Applying settings...");
await index.setSettings(settings).wait();

console.log("Configuring sort replicas...");
await client
  .initIndex(REPLICA_RATING)
  .setSettings({
    customRanking: ["desc(stars_count)", "desc(reviews_count)"],
    // 100 = strictly relevant results only, lower = more of the sort order leaks in.
    relevancyStrictness: 80,
  })
  .wait();
await client
  .initIndex(REPLICA_PRICE)
  .setSettings({
    customRanking: ["asc(price_tier)", "desc(quality_score)"],
    relevancyStrictness: 80,
  })
  .wait();

console.log("Saving synonyms...");
await index
  .saveSynonyms(
    [
      { objectID: "bbq", type: "synonym", synonyms: ["bbq", "barbecue", "barbeque"] },
      { objectID: "steak", type: "synonym", synonyms: ["steak", "steakhouse", "chophouse", "steak house"] },
      { objectID: "sushi", type: "synonym", synonyms: ["sushi", "japanese", "sashimi"] },
      { objectID: "pizza", type: "synonym", synonyms: ["pizza", "pizzeria"] },
      { objectID: "cafe", type: "synonym", synonyms: ["cafe", "café", "coffee shop"] },
      { objectID: "gastropub", type: "synonym", synonyms: ["gastropub", "gastro pub", "pub"] },
      { objectID: "dimsum", type: "synonym", synonyms: ["dim sum", "dimsum", "yum cha"] },
    ],
    { replaceExistingSynonyms: true }
  )
  .wait();

if (!process.argv.includes("--settings-only")) {
  console.log("Replacing records...");
  await index.clearObjects().wait();
  const res = await index.saveObjects(records, { autoGenerateObjectIDIfNotExist: false }).wait();
  console.log(`Indexed ${records.length} records (${res.objectIDs.length} objectIDs)`);
}
console.log("Done.");
