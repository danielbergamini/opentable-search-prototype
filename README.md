# OpenTable search and discovery prototype (Algolia)

## Run it
1. Put `restaurants_list.json` and `restaurants_info.csv` in `data/`
2. `cp .env.example .env` and fill in your Algolia App ID, Admin key (scripts) and Search-only key (browser)
3. `npm install`
4. `pip3 install pandas && npm run prepare-data`   (writes records.json and data_report.json)
5. `npm run index`                                 (applies settings, synonyms, replicas, records)
6. `npm run dev`

## Layout
- `scripts/prepare.py`: join, clean, enrich, validate
- `scripts/index.js`: every index setting, with the reasoning in comments
- `main.js`, `index.html`, `style.css`: InstantSearch.js + Autocomplete + Leaflet UI
