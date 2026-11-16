# Label & Ladder

HAIC 2026 · AI-Developed Planning and Improvement Challenge · DHS: “Enhancing ESF-6 Planning Through AI-Supported
Insights”. Team: Space Cat (Malisa Lo).

**Standardize the label, not the system.** Every data source about access and functional needs, hazards and
shelters gets the same one-page label, and each sector climbs a ladder from a phone call to a service that answers
with counts, at its own pace. From public data alone, the plan maps all 432 census tracts with residents against
four hazards, estimates needs across the CMIST areas, and prints a brief for each county and hazard in which every
number names its source and every gap says who to ask.

> Planning aid. Supports, does not replace, county emergency plans. Not an official shelter list.

## For judges

Start at the home page and press **Next**. Six short steps walk through it in order:

1. **The challenge:** what Hawaiʻi's Department of Human Services asked for, in plain words.
2. **The question:** what to build first, and why the facts aren't connected today.
3. **The options:** three ways to answer it, what each gets right, and the catch.
4. **Our choice:** the label and the ladder, with a real example and the evidence.
5. **See it work:** the brief for any county and hazard. Click a line to see its source label, or who to ask.
   “Print this brief” gives a paper copy.
6. **What's next:** what it will never do, how it grows, and our ask.

More detail: every source label (`sources/`), the check against past events (`checked/`), other choices
(`decisions/`) and the full plan (`plan/`). Every source label as data: `catalog.json`.

No login, no keys, no outside services.

## How the data was built

Everything comes from public, aggregate sources: counts for an area, never records about a person. The build is a
Python pipeline (standard library only) that turns the source files into a static Astro site in `docs/`. The
pipeline and the source data are kept outside this repository; only the built site is published.

**1. Collect, once.** Every dataset was fetched one time and saved with its publisher, release, URL and fetch date.
The main sources are:

- **Census ACS 2020–2024 (5-year)** for people with access and functional needs in each of the 432 census tracts
  with residents, each with its 90% margin of error. Four tables the tract-level extract lacked (hearing, vision,
  cognitive difficulty, children under 5) were taken from the Census Bureau's public Summary File, keeping only
  Hawaiʻi rows.
- **2020 Census blocks** for where people live inside each hazard zone.
- **Hazard maps:** State tsunami evacuation zones; FEMA Special Flood Hazard Areas (1%-annual-chance); US Forest
  Service Wildfire Hazard Potential (high or very high); and for hurricanes, the whole island.
- **FEMA National Risk Index** (v1.20) per tract, as context only.
- **HHS emPOWER** (electricity-dependent Medicare beneficiaries) at ZIP and county level, never split into tracts.
- **Point-in-Time homeless counts** (HUD for Oʻahu, Bridging the Gap for the other counties) and **DBEDT** average
  daily visitors, kept as separate county lines.
- **Shelter sites** from each county's own lists and event announcements since 2018, plus FEMA ESF#6 Shelter System
  records where the name and location both match.

**2. Check.** Every extract is checked against published totals: tract sums of each indicator equal the county
values exactly, and hazard-zone populations match the published county and state totals. Tracts with no residents
(ocean tracts, Kahoʻolawe, the Northwestern Hawaiian Islands) are left out.

**3. Label.** Each of the 58 data sources gets the same one-page label: who owns it, how current it is, its privacy
level and where it sits on the ladder. The labels are published as `catalog.json` and on the `sources/` page.

**4. Map.** For each tract and hazard: people in the zone = the tract's ACS population × the share of its 2020
residents living inside the zone. Residents with access and functional needs are estimated with the same share.
Wildfire zone = within 500 m of land rated high or very high hazard. County figures are sums of tracts; margins
combine as the root-sum-of-squares.

**5. Model.** People likely to need a public shelter = people in the zone × a shelter-seeking rate (low, likely and
high). Hurricane and wildfire rates are published; tsunami and flood rates are team assumptions because no published
rate exists. Supplies and space follow from 51 per-person factors (40 published with page and quote, 11 team
assumptions). The same formula was run on past Hawaiʻi events and compared with the published shelter counts
(`checked/` page); the rates were not changed after seeing the results.

**6. Match.** Each need is paired with a proposed lead and support partners from the State ESF-6 Annex and
Emergency Operations Plan, or marked "team proposal". Capacity nobody has confirmed is shown as unknown, with who to
ask.

**Rules the build enforces:** people and households are never added together; CMIST groups overlap and are never
added; small emPOWER counts (1–10) are shown as ranges, never exact figures; every number names its source.
Translations of resident messages are AI drafts that need native-speaker review.
