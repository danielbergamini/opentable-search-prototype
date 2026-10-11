import algoliasearch from "algoliasearch/lite";
import instantsearch from "instantsearch.js";
import {
  configure,
  infiniteHits,
  refinementList,
  ratingMenu,
  sortBy,
  stats,
  currentRefinements,
  clearRefinements,
} from "instantsearch.js/es/widgets";
import { connectInfiniteHits, connectSearchBox } from "instantsearch.js/es/connectors";
import { autocomplete, getAlgoliaResults } from "@algolia/autocomplete-js";
import aa from "search-insights";
import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "@algolia/autocomplete-theme-classic";
import "./style.css";

// ---------------------------------------------------------------------------
// Config (search-only key is safe in the browser; the admin key never leaves scripts/)
// ---------------------------------------------------------------------------
const APP_ID = import.meta.env.VITE_ALGOLIA_APP_ID;
const SEARCH_KEY = import.meta.env.VITE_ALGOLIA_SEARCH_KEY;
const INDEX = "restaurants";

if (!APP_ID || !SEARCH_KEY) {
  document.body.innerHTML =
    '<p style="padding:2rem;font-family:sans-serif">Missing VITE_ALGOLIA_APP_ID / VITE_ALGOLIA_SEARCH_KEY. Copy .env.example to .env and fill them in, then restart <code>npm run dev</code>.</p>';
  throw new Error("Missing Algolia credentials");
}

const searchClient = algoliasearch(APP_ID, SEARCH_KEY);

// ---------------------------------------------------------------------------
// Location: GPS -> IP -> manual city. The dataset has no Chicago, so the picker matters in demos.
// ---------------------------------------------------------------------------
const CITIES = [
  { label: "New York", lat: 40.7128, lng: -74.006 },
  { label: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { label: "San Diego", lat: 32.7157, lng: -117.1611 },
  { label: "Denver", lat: 39.7392, lng: -104.9903 },
  { label: "Houston", lat: 29.7604, lng: -95.3698 },
  { label: "Dallas", lat: 32.7767, lng: -96.797 },
  { label: "Portland", lat: 45.5152, lng: -122.6784 },
  { label: "Las Vegas", lat: 36.1699, lng: -115.1398 },
  { label: "Phoenix", lat: 33.4484, lng: -112.074 },
  { label: "Nashville", lat: 36.1627, lng: -86.7816 },
  { label: "Honolulu", lat: 21.3069, lng: -157.8583 },
];

let loc = null; // { lat, lng, label, source }  (null = let Algolia infer from IP)

const locLabelEl = document.getElementById("loc-label");
const citySelect = document.getElementById("loc-city");
citySelect.innerHTML =
  '<option value="">Pick a city</option>' +
  CITIES.map((c, i) => `<option value="${i}">${c.label}</option>`).join("");

function geoParams() {
  const base = {
    getRankingInfo: true,
    aroundRadius: "all", // never exclude far results; rank by distance instead
    // Geo is a ranking criterion that sorts by exact distance, which would make quality_score
    // irrelevant. Bucketing into 1-mile steps nearby (8 km beyond ~5 miles) lets popularity
    // break ties among restaurants that are "about as close".
    aroundPrecision: [
      { from: 0, value: 1600 },
      { from: 8000, value: 8000 },
    ],
  };
  return loc
    ? { ...base, aroundLatLng: `${loc.lat}, ${loc.lng}` }
    : { ...base, aroundLatLngViaIP: true };
}

// ---------------------------------------------------------------------------
// InstantSearch
// ---------------------------------------------------------------------------
const search = instantsearch({
  indexName: INDEX,
  searchClient,
  insights: { insightsClient: aa }, // enables click + conversion events (search -> booking funnel)
});

let geoConfig = configure({ hitsPerPage: 12, ...geoParams() });
let boundsConfig = null; // "Search this area" (insideBoundingBox)

function applyLocation(next) {
  loc = next;
  search.removeWidgets([geoConfig]);
  geoConfig = configure({ hitsPerPage: 12, ...geoParams() });
  search.addWidgets([geoConfig]);
  renderLocation();
}

function renderLocation() {
  if (!loc) {
    locLabelEl.textContent = "Showing results near your approximate location";
  } else if (loc.source === "gps") {
    locLabelEl.textContent = "Showing results near your location";
  } else {
    locLabelEl.textContent = `Showing results near ${loc.label}`;
  }
  if (!loc || loc.source !== "city") citySelect.value = "";
}

function useMyLocation() {
  if (!navigator.geolocation) {
    locLabelEl.textContent = "Location isn’t available in this browser. Pick a city instead.";
    return;
  }
  locLabelEl.textContent = "Locating you…";
  navigator.geolocation.getCurrentPosition(
    (pos) =>
      applyLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: "your location",
        source: "gps",
      }),
    () => {
      renderLocation();
      locLabelEl.textContent = "Location is blocked, so results use your approximate location. Pick a city to change it.";
    },
    { timeout: 8000, maximumAge: 600000 }
  );
}

document.getElementById("loc-gps").addEventListener("click", useMyLocation);
citySelect.addEventListener("change", () => {
  if (citySelect.value === "") return;
  const city = CITIES[Number(citySelect.value)];
  applyLocation({ ...city, source: "city" });
});

// ---------------------------------------------------------------------------
// Query handling shared by the autocomplete box and the reset button
// ---------------------------------------------------------------------------
function setSearchQuery(query) {
  search.setUiState((prev) => ({
    ...prev,
    [INDEX]: { ...prev[INDEX], query, page: undefined },
  }));
}

function resetAll() {
  ac.setQuery("");
  clearMapArea();
  search.setUiState({ [INDEX]: {} });
}

// ---------------------------------------------------------------------------
// Autocomplete: fast, typo-tolerant restaurant-name lookup (known-item persona).
// The results list updates live as the user types (discovery persona).
// ---------------------------------------------------------------------------
const ac = autocomplete({
  container: "#autocomplete",
  placeholder: "Search a restaurant, cuisine or neighborhood",
  detachedMediaQuery: "none",
  openOnFocus: false,
  getSources({ query }) {
    if (!query) return [];
    return [
      {
        sourceId: "restaurants",
        getItemInputValue: ({ item }) => item.name,
        getItems() {
          return getAlgoliaResults({
            searchClient,
            queries: [
              {
                indexName: INDEX,
                query,
                params: {
                  hitsPerPage: 6,
                  attributesToRetrieve: ["name", "cuisine", "neighborhood", "city", "state"],
                  attributesToHighlight: ["name"],
                  ...geoParams(),
                },
              },
            ],
          });
        },
        templates: {
          item({ item, components, html }) {
            return html`<div class="ac-item">
              <div class="ac-item__name">${components.Highlight({ hit: item, attribute: "name" })}</div>
              <div class="ac-item__meta">${item.cuisine}, ${item.neighborhood}, ${item.city}</div>
            </div>`;
          },
        },
      },
    ];
  },
  onStateChange({ state, prevState }) {
    if (state.query !== prevState.query) setSearchQuery(state.query);
  },
});

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------
// Straight-line distance (haversine) from the active search location to a hit, in meters.
// Used when we know the coordinates (GPS or city picker). Falls back to Algolia's ranking info
// when location comes from the IP, where the browser doesn't know the coordinates.
function distanceFor(hit) {
  if (loc && hit._geoloc) {
    const R = 6371000;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(hit._geoloc.lat - loc.lat);
    const dLng = rad(hit._geoloc.lng - loc.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(loc.lat)) * Math.cos(rad(hit._geoloc.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const info = hit._rankingInfo;
  return info?.matchedGeoLocation?.distance ?? info?.geoDistance;
}

const miles = (m) => (m / 1609.34 < 10 ? (m / 1609.34).toFixed(1) : Math.round(m / 1609.34)) + " mi";

// InstantSearch only applies `query` from setUiState if some widget owns that state.
// The visible search input is the Autocomplete box (not an InstantSearch widget), so we register
// a "virtual" search box with no UI. Without it, typing updates the dropdown but never the results.
const virtualSearchBox = connectSearchBox(() => {});

search.addWidgets([
  geoConfig,
  virtualSearchBox({}),

  // Cuisine chips: the main browse affordance for people who don't know what they want.
  refinementList({
    container: "#cuisine-chips",
    attribute: "cuisine",
    limit: 12,
    showMore: true,
    showMoreLimit: 40,
    sortBy: ["isRefined", "count:desc"],
    templates: { showMoreText: ({ isShowingMore }, { html }) => html`${isShowingMore ? "Fewer cuisines" : "More cuisines"}` },
  }),

  refinementList({
    container: "#price-filter",
    attribute: "price_range",
    sortBy: ["name:asc"], // "$30 and under", "$31 to $50", "$50 and over" sort correctly
  }),
  ratingMenu({
    container: "#rating-filter",
    attribute: "rating_floor",
    max: 5,
  }),
  refinementList({
    container: "#style-filter",
    attribute: "dining_style",
    sortBy: ["count:desc"],
  }),
  refinementList({
    container: "#neighborhood-filter",
    attribute: "neighborhood",
    searchable: true,
    searchablePlaceholder: "Find a neighborhood",
    limit: 6,
    showMore: true,
    showMoreLimit: 30,
  }),
  refinementList({
    container: "#payment-filter",
    attribute: "payment_options",
    limit: 5,
    showMore: true,
    sortBy: ["count:desc"],
  }),

  stats({
    container: "#stats",
    templates: {
      text(data, { html }) {
        const n = data.nbHits.toLocaleString();
        if (!data.query) {
          return html`<strong>${n}</strong> restaurants, nearest and best-rated first`;
        }
        return html`<strong>${n}</strong> ${data.nbHits === 1 ? "match" : "matches"} for “${data.query}”`;
      },
    },
  }),
  sortBy({
    container: "#sort",
    items: [
      { value: INDEX, label: "Best match" },
      { value: "restaurants_rating", label: "Highest rated" },
      { value: "restaurants_price_asc", label: "Price: low to high" },
    ],
  }),
  currentRefinements({ container: "#current-refinements" }),
  clearRefinements({
    container: "#clear-refinements",
    templates: { resetLabel: ({}, { html }) => html`Clear filters` },
  }),

  infiniteHits({
    container: "#hits",
    showPrevious: false,
    templates: {
      item(hit, { html, components, sendEvent }) {
        const dist = distanceFor(hit);
        return html`
          <article class="card" onClick=${() => sendEvent("click", hit, "Restaurant Clicked")}>
            <img
              class="card__img"
              src=${hit.image_url}
              alt=""
              loading="lazy"
              onError=${(e) => (e.target.style.visibility = "hidden")}
            />
            <div class="card__body">
              <h3 class="card__name">${components.Highlight({ hit, attribute: "name" })}</h3>
              <p class="card__rating">
                <span class="card__stars">${Number(hit.stars_count).toFixed(1)} ★</span>
                <span class="card__reviews">${Number(hit.reviews_count).toLocaleString()} reviews</span>
              </p>
              <p class="card__meta">
                ${components.Highlight({ hit, attribute: "cuisine" })}, ${hit.price_label}, ${hit.dining_style}
              </p>
              <p class="card__place">
                ${components.Highlight({ hit, attribute: "neighborhood" })}, ${hit.city}
                ${dist != null ? html`<span class="card__dist">${miles(dist)} away</span>` : null}
              </p>
              ${hit.same_name_count > 1
                ? html`<p class="card__note">${hit.same_name_count} locations share this name, check the neighborhood.</p>`
                : null}
            </div>
            <a
              class="btn card__reserve"
              href=${hit.reserve_url}
              target="_blank"
              rel="noopener"
              onClick=${(e) => {
                e.stopPropagation();
                sendEvent("conversion", hit, "Reserve Clicked");
              }}
              >Reserve</a
            >
          </article>
        `;
      },
      empty(results, { html }) {
        return html`<div class="empty">
          <h3>No tables match “${results.query}”</h3>
          <p>Try a shorter search, remove a filter, or browse a cuisine above.</p>
          <button type="button" class="btn" onClick=${resetAll}>Clear search and filters</button>
        </div>`;
      },
      showMoreText: ({}, { html }) => html`Show more restaurants`,
    },
  }),
]);

// ---------------------------------------------------------------------------
// Map (Leaflet + OpenStreetMap, no API key). Markers mirror the accumulated result list.
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let map;
let markerLayer;
let programmatic = false;
const areaBtn = document.getElementById("map-search-area");
const clearBtn = document.getElementById("map-clear");

function clearMapArea() {
  if (!boundsConfig) return;
  search.removeWidgets([boundsConfig]);
  boundsConfig = null;
  areaBtn.hidden = true;
  clearBtn.hidden = true;
}

areaBtn.addEventListener("click", () => {
  const b = map.getBounds();
  if (boundsConfig) search.removeWidgets([boundsConfig]);
  // insideBoundingBox format: lat1,lng1,lat2,lng2 (north-east, south-west)
  boundsConfig = configure({
    insideBoundingBox: `${b.getNorth()},${b.getEast()},${b.getSouth()},${b.getWest()}`,
  });
  search.addWidgets([boundsConfig]);
  areaBtn.hidden = true;
  clearBtn.hidden = false;
});
clearBtn.addEventListener("click", clearMapArea);

const mapWidget = connectInfiniteHits((renderOptions, isFirstRender) => {
  const { items, isFirstPage } = renderOptions;

  if (isFirstRender) {
    map = L.map("map").setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.on("moveend", () => {
      if (!programmatic) areaBtn.hidden = false;
    });
    setTimeout(() => map.invalidateSize(), 0);
  }

  markerLayer.clearLayers();
  const points = [];
  items.forEach((hit) => {
    if (!hit._geoloc) return;
    const p = [hit._geoloc.lat, hit._geoloc.lng];
    points.push(p);
    L.circleMarker(p, { radius: 7, color: "#fff", weight: 2, fillColor: "#C8312B", fillOpacity: 0.95 })
      .bindPopup(
        `<strong>${esc(hit.name)}</strong><br>${esc(hit.cuisine)}, ${esc(hit.price_label)}<br>` +
          `${esc(Number(hit.stars_count).toFixed(1))} ★ (${esc(hit.reviews_count)} reviews)<br>` +
          `<a href="${esc(hit.reserve_url)}" target="_blank" rel="noopener">Reserve</a>`
      )
      .addTo(markerLayer);
  });

  // Re-fit only when a fresh result set arrives and the user isn't pinned to a map area.
  if (isFirstPage && points.length && !boundsConfig) {
    programmatic = true;
    map.fitBounds(points, { padding: [30, 30], maxZoom: 14, animate: false });
    programmatic = false;
    areaBtn.hidden = true;
  }
});

search.addWidgets([mapWidget({})]);

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
search.start();
renderLocation();
useMyLocation(); // try GPS; falls back to IP-based location if the user declines
