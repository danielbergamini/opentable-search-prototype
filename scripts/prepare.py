"""
Join restaurants_list.json + restaurants_info.csv, clean, enrich, and write records.json.

Run from the project root:   python3 scripts/prepare.py
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "records.json"
REPORT = ROOT / "data_report.json"

# ---------------------------------------------------------------- load
list_path = DATA / "restaurants_list.json"
info_path = DATA / "restaurants_info.csv"
for p in (list_path, info_path):
    if not p.exists():
        sys.exit(f"Missing {p}. Copy the dataset files into ./data/")

with open(list_path, encoding="utf-8") as f:
    j = pd.DataFrame(json.load(f))

# NOTE: the CSV is semicolon-delimited. Read everything as text first, cast explicitly later.
c = pd.read_csv(info_path, sep=";", dtype=str, keep_default_na=False)

j["objectID"] = j["objectID"].astype(str).str.strip()
c["objectID"] = c["objectID"].astype(str).str.strip()

# ---------------------------------------------------------------- join
# validate="1:1" raises if either side has duplicate IDs, so a bad join cannot slip through.
df = j.merge(c, on="objectID", how="outer", indicator=True, validate="1:1")
orphans = df[df["_merge"] != "both"]
if len(orphans):
    print(f"WARNING: dropping {len(orphans)} records that exist in only one file")
df = df[df["_merge"] == "both"].drop(columns="_merge").copy()

# ---------------------------------------------------------------- clean
for col in ["name", "address", "city", "state", "area", "neighborhood", "food_type",
            "price_range", "dining_style", "postal_code"]:
    df[col] = df[col].astype(str).str.strip()

df["stars_count"] = pd.to_numeric(df["stars_count"], errors="coerce")
df["reviews_count"] = pd.to_numeric(df["reviews_count"], errors="coerce").fillna(0).astype(int)

# Two phone formats exist (digits in JSON, "(216) 378-8988" in CSV). Keep the CSV's formatted one.
df["phone"] = df["phone_number"].str.strip()
df = df.drop(columns=["phone_number"])

# Must have usable geo + rating to rank well; report anything that does not.
df["lat"] = df["_geoloc"].apply(lambda g: g.get("lat") if isinstance(g, dict) else None)
df["lng"] = df["_geoloc"].apply(lambda g: g.get("lng") if isinstance(g, dict) else None)
bad_geo = df[df["lat"].isna() | df["lng"].isna()]
bad_rating = df[df["stars_count"].isna()]
df = df.drop(columns=["lat", "lng"])
df = df[~df["objectID"].isin(bad_geo["objectID"])]
df = df[~df["objectID"].isin(bad_rating["objectID"])].copy()

df["payment_options"] = df["payment_options"].apply(
    lambda l: sorted({p.strip() for p in l if p and p.strip()}) if isinstance(l, list) else []
)

# ---------------------------------------------------------------- enrich
# 1) Cuisine: 114 raw food_type values with overlaps. Keep the raw value (searchable, so "sushi"
#    still matches) and add a browsable `cuisine` group used for the facet / chips.
CUISINE_GROUP = {
    "Contemporary American": "American",
    "Steak": "Steakhouse",
    "Brazilian Steakhouse": "Steakhouse",
    "Mexican / Southwestern": "Mexican",
    "Global, International": "International",
    "Tapas / Small Plates": "Spanish / Tapas",
    "Spanish": "Spanish / Tapas",
    "Sushi": "Japanese",
}
df["cuisine"] = df["food_type"].replace(CUISINE_GROUP)

# 2) Quality score: Bayesian average so a 5.0 with 3 reviews does not beat a 4.6 with 3,000.
#    m = how many reviews it takes before we trust a restaurant's own rating over the global mean.
M = 100
global_mean = df["stars_count"].mean()
v, r = df["reviews_count"], df["stars_count"]
bayes = (v / (v + M)) * r + (M / (v + M)) * global_mean
df["quality_score"] = (bayes * 100).round().astype(int)  # custom ranking needs integers

# 3) Rating bucket for the "4 & up" rating filter (ratingMenu wants integers 0-5).
df["rating_floor"] = df["stars_count"].apply(lambda s: int(s)).clip(0, 5)

# 4) Price tier from the CSV buckets (display "$", "$$", "$$$").
PRICE_TIER = {"$30 and under": 1, "$31 to $50": 2, "$50 and over": 3}
df["price_tier"] = df["price_range"].map(PRICE_TIER).fillna(0).astype(int)
df["price_label"] = df["price_tier"].map({1: "$", 2: "$$", 3: "$$$"}).fillna("")

# 5) Same-name locations (chain / multi-location signal).
#    ASSUMPTION: identical normalized names are treated as the same brand. A few will be unrelated
#    restaurants that share a name in different cities; the UI shows city + neighborhood either way.
df["name_normalized"] = df["name"].str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
df["same_name_count"] = df.groupby("name_normalized")["objectID"].transform("count").astype(int)

# 6) Display helper
df["location_label"] = df["neighborhood"] + ", " + df["city"] + ", " + df["state"]

# ---------------------------------------------------------------- validate + write
assert df["objectID"].is_unique, "objectIDs must be unique"
assert df["quality_score"].notna().all()

records = df.to_dict(orient="records")
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False)

report = {
    "records_written": len(records),
    "orphans_dropped": int(len(orphans)),
    "bad_geo_dropped": int(len(bad_geo)),
    "bad_rating_dropped": int(len(bad_rating)),
    "raw_food_types": int(df["food_type"].nunique()),
    "cuisine_groups": int(df["cuisine"].nunique()),
    "names_with_multiple_locations": int((df.groupby("name_normalized").size() > 1).sum()),
    "global_mean_rating": round(float(global_mean), 3),
    "top_cuisines": df["cuisine"].value_counts().head(15).to_dict(),
    "price_range_vs_price_crosstab": pd.crosstab(df["price"], df["price_range"]).to_dict(),
}
with open(REPORT, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

print(json.dumps(report, indent=2))
print(f"\nWrote {len(records)} records to {OUT}")
