/* Brief explorer (showcase/), ladder board (sources/), back-test (checked/). Plain JS, no libraries, no network.
   Each page embeds the data it needs in <script id="site-data"> (site/src/components/SiteData.astro). */
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("site-data").textContent);
  const $ = (s, el) => (el || document).querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  // DOM append turns null into the text "null"; drop empty slots first.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? "unknown" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const round = (n) => (n == null ? null : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n));

  const plain = (x) => String(x || "").replace(/\s*Assumption A-[A-Z0-9]+\.?/g, "").replace(/\s*\((?:block area|A-|ACS S)[^)]*\)/g, "");
  const COUNTIES = ["honolulu", "hawaii", "maui", "kauai"];
  const HAZARDS = ["hurricane", "wildfire", "tsunami", "flood"];
  const HAZ_COLOR = { hurricane: "#5b4b9a", wildfire: "#c8472b", tsunami: "#1f6fb2", flood: "#2b8a7e" };
  const LEVEL_COLOR = ["#8a8f98", "#c98a1b", "#2b7a78", "#1f4e8c"];
  const LEVEL_TEXT = ["#14232b", "#14232b", "#ffffff", "#ffffff"];
  const STATUS = {
    answered: { word: "Answered", cls: "st-answered" },
    partial: { word: "Answered, with a limit", cls: "st-partial" },
    unknown: { word: "Phone call", cls: "st-unknown" },
  };
  const LABELS = Object.fromEntries((D.labels || []).map((l) => [l.id, l]));
  const IND = D.indicators || [];
  const IND_COLS = (D.tracts_meta && D.tracts_meta.ind_columns) || IND.map((i) => i.id);
  const countyName = (c) => (D.counties[c] && D.counties[c].name) || c;
  const hazName = (k) => (D.hazards[k] && D.hazards[k].name) || k;

  const state = { county: "maui", hazard: "wildfire", layer: "people", view: "now", openGroups: null };

  /* ---------------- routing ---------------- */
  function readHash() {
    const m = (location.hash || "").match(/^#([a-z]+)-([a-z]+)$/);
    if (m && COUNTIES.includes(m[1]) && HAZARDS.includes(m[2])) { state.county = m[1]; state.hazard = m[2]; }
  }
  function writeHash() {
    const want = `#${state.county}-${state.hazard}`;
    if (location.hash !== want) history.replaceState(null, "", want);
  }

  /* ---------------- pickers ---------------- */
  function pickers() {
    const pc = $("#pick-county"), ph = $("#pick-hazard");
    fill(pc, ...COUNTIES.map((c) => h("button", {
      type: "button", class: "pick" + (state.county === c ? " is-on" : ""), "aria-pressed": String(state.county === c),
      onclick: () => { state.county = c; state.view = "now"; render(); },
    }, countyName(c))));
    fill(ph, ...HAZARDS.map((k) => h("button", {
      type: "button", class: "pick pick-haz" + (state.hazard === k ? " is-on" : ""), "aria-pressed": String(state.hazard === k),
      style: `--hz:${HAZ_COLOR[k]}`, onclick: () => { state.hazard = k; render(); },
    }, h("span", { class: "swatch", "aria-hidden": "true" }), hazName(k))));
    const sel = $("#layer");
    if (!sel.options.length) {
      sel.append(h("option", { value: "people" }, "People in the hazard zone"));
      sel.append(h("option", { value: "shelter" }, "People likely to need a public shelter"));
      const grp = { C: "Communication", I: "Independence", S: "Safety and support", T: "Transportation", context: "Context" };
      for (const g of ["C", "I", "S", "T", "context"]) {
        const og = h("optgroup", { label: grp[g] });
        IND.filter((i) => i.cmist === g).forEach((i) => og.append(h("option", { value: i.id }, `${i.name} (${i.unit}), in the zone`)));
        sel.append(og);
      }
      sel.addEventListener("change", () => { state.layer = sel.value; drawMap(); });
    }
    sel.value = state.layer;
  }

  /* ---------------- data access ---------------- */
  const detail = () => D.detail[state.county];
  function brief() {
    const b = detail().briefs[`${state.county}-${state.hazard}`];
    if (state.view === "next" && b.next && b.next.lines) return { ...b, lines: b.next.lines, practice: true };
    return b;
  }
  function tractValue(t) {
    const hz = t.hz[state.hazard];
    if (!hz) return { v: null };
    if (state.layer === "people") return { v: hz[1], share: hz[0] };
    if (state.layer === "shelter") return { v: hz[3], share: hz[0] };
    const i = IND_COLS.indexOf(state.layer);
    if (i < 0 || !t.ind[i]) return { v: null };
    const [est, moe] = t.ind[i];
    return { v: est == null ? null : est * hz[0], moe: moe == null ? null : moe * hz[0], share: hz[0] };
  }

  /* ---------------- map ---------------- */
  const NS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
  function project(geo, lat, lon) {
    const p = geo.projection;
    const k = p.units_per_degree_lat;
    const x = (lon - p.lon_min) * k * Math.cos((p.lat0 * Math.PI) / 180) + p.pad;
    const y = (p.lat_max - lat) * k + p.pad;
    return [x, y];
  }
  function drawMap() {
    const geo = D.geometry.counties[state.county];
    const det = detail();
    const paths = det.geometry.tracts;
    const svg = s("svg", { viewBox: geo.viewBox, role: "img", "aria-label": `Map of ${countyName(state.county)} census tracts, ${$("#layer").selectedOptions[0].textContent}` });
    const vals = det.tracts.map((t) => tractValue(t).v).filter((v) => v > 0).sort((a, b) => a - b);
    const q = [0.2, 0.4, 0.6, 0.8].map((p) => vals[Math.floor(p * (vals.length - 1))] || 0);
    const cls = (v) => (v == null ? -1 : v <= 0 ? 0 : 1 + q.filter((b) => v > b).length);
    const color = HAZ_COLOR[state.hazard];
    const op = [0, 0.16, 0.32, 0.5, 0.7, 0.92];
    const tip = $("#map-tip");
    const g = s("g", {});
    for (const t of det.tracts) {
      const d = paths[t.geoid];
      if (!d) continue;
      const { v, moe, share } = tractValue(t);
      const c = cls(v);
      const p = s("path", { d, class: "tract", fill: c <= 0 ? "#efebe2" : color, "fill-opacity": c <= 0 ? 1 : op[c], stroke: "#ffffff", "stroke-width": 0.6, tabindex: 0 });
      const tipText = () => {
        const name = t.community ? `${t.community} · ${t.name.replace(/,.*$/, "")}` : t.name;
        const label = $("#layer").selectedOptions[0].textContent;
        const val = v == null ? "unknown" : `${fmt(round(v))}${moe ? " ± " + fmt(round(moe)) : ""}`;
        return `<strong>${name}</strong><br>${label}: ${val}<br>Share of residents in the zone: ${share == null ? "unknown" : Math.round(share * 100) + "%"}`;
      };
      const show = (ev) => {
        tip.innerHTML = tipText(); tip.hidden = false;
        const r = $("#map").getBoundingClientRect();
        const pt = ev.touches ? ev.touches[0] : ev;
        const x = pt.clientX ? pt.clientX - r.left : r.width / 2, y = pt.clientY ? pt.clientY - r.top : 20;
        tip.style.left = Math.min(x + 14, r.width - 230) + "px"; tip.style.top = (y + 14) + "px";
      };
      p.addEventListener("mousemove", show); p.addEventListener("focus", show);
      p.addEventListener("mouseleave", () => (tip.hidden = true)); p.addEventListener("blur", () => (tip.hidden = true));
      g.append(p);
    }
    svg.append(g);
    // sites
    const b = detail().briefs[`${state.county}-${state.hazard}`];
    const flags = Object.fromEntries((b.sites || []).map((x) => [x.id, x.zone_flag]));
    const sg = s("g", {});
    for (const site of det.sites) {
      if (site.lat == null || site.lon == null) continue;
      const [x, y] = project(geo, site.lat, site.lon);
      const f = flags[site.id] || "unknown";
      const dotFill = f === "inside" || f === "whole-island" ? "#c8472b" : f === "check" ? "#c98a1b" : f === "outside" ? "#0e4f5c" : "#8a8f98";
      const c = s("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.2, fill: dotFill, stroke: "#fff", "stroke-width": 1.4, class: "site-dot" });
      const t = s("title", {}); t.textContent = `${site.name} (${site.town || ""}): ${D.hazards[state.hazard].site_status[f] || f}`;
      c.append(t); sg.append(c);
    }
    svg.append(sg);
    // town labels
    const lg = s("g", { class: "town-labels", "aria-hidden": "true" });
    for (const l of geo.labels || []) {
      const t = s("text", { x: l.x, y: l.y, "text-anchor": "middle" }); t.textContent = l.name; lg.append(t);
    }
    svg.append(lg);
    fill($("#map"), svg);
    // legend
    const sw = (fill, o) => `<span class="lg-sw" style="background:${fill};opacity:${o}"></span>`;
    const ranges = [0, ...q].map((lo, i) => `${sw(color, op[i + 1])}${i === 0 ? "up to " + fmt(round(q[0])) : i === 4 ? "over " + fmt(round(q[3])) : fmt(round(lo)) + "–" + fmt(round(q[i]))}`);
    $("#map-legend").innerHTML = `<span class="lg-row">${sw("#efebe2", 1)}none in zone ${ranges.join(" ")}</span>
      <span class="lg-row"><span class="lg-dot" style="background:#c8472b"></span>site in zone <span class="lg-dot" style="background:#c98a1b"></span>check on a map <span class="lg-dot" style="background:#0e4f5c"></span>outside zone</span>
      <details class="lg-row"><summary class="cursor-pointer">How tract values are worked out</summary>The tract count × the share of its residents in the zone (assumes AFN residents are spread like everyone else in the tract). Census ACS 2020–2024, 2020 Census blocks.</details>`;
  }

  /* ---------------- brief text ---------------- */
  function labelChips(ids) {
    return h("span", { class: "chips" }, (ids || []).map((id) => {
      const lb = LABELS[id];
      if (!lb) return h("span", { class: "chip" }, id);
      return h("button", { type: "button", class: "chip", onclick: () => openLabel(id), title: lb.owner || "" },
        h("span", { class: "chip-lvl", style: `background:${LEVEL_COLOR[lb.level]};color:${LEVEL_TEXT[lb.level]}` }, String(lb.level)), lb.title);
    }));
  }
  function askBlock(ask) {
    if (!ask) return null;
    if (typeof ask === "string") return h("p", { class: "ask" }, h("strong", {}, "Ask: "), ask);
    return h("div", { class: "ask" },
      ask.owner ? h("p", {}, h("strong", {}, "Who to ask: "), ask.owner) : null,
      ask.ask ? h("p", {}, h("strong", {}, "What to ask: "), ask.ask) : null,
      ask.why_not_shared ? h("p", { class: "text-ink-soft" }, h("strong", {}, "Why it isn't shared today: "), [].concat(ask.why_not_shared).map((w) => (typeof w === "string" ? w : w.text || "")).join(" ")) : null,
      ask.next_rung ? h("p", { class: "text-ink-soft" }, h("strong", {}, "Next rung: "), typeof ask.next_rung === "string" ? ask.next_rung : ask.next_rung.step || "") : null,
    );
  }
  function needItems(b, lineId) {
    const n = (b.needs || []).find((x) => x.need === lineId);
    if (!n || !n.items || !n.items.length) return null;
    return h("table", { class: "need-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Item"), h("th", { class: "num" }, "Low"), h("th", { class: "num" }, "Likely"), h("th", { class: "num" }, "High"), h("th", {}, "Basis"))),
      h("tbody", {}, n.items.map((it) => h("tr", {},
        h("td", {}, it.label, it.unit ? h("span", { class: "text-ink-soft" }, ` (${it.unit})`) : null),
        h("td", { class: "num" }, fmt(round(it.low))), h("td", { class: "num strong" }, fmt(round(it.likely))), h("td", { class: "num" }, fmt(round(it.high))),
        h("td", { class: "text-ink-soft" }, it.formula || "", (it.kinds || []).includes("team_assumption") ? h("span", { class: "tag-assume" }, "team assumption") : null),
      ))));
  }
  function renderLines(b) {
    const byId = Object.fromEntries(b.lines.map((l) => [l.id, l]));
    const now = detail().briefs[b.key];
    const nowById = Object.fromEntries(now.lines.map((l) => [l.id, l]));
    const wrap = $("#b-lines");
    const groups = D.line_groups || [];
    if (!state.openGroups) state.openGroups = new Set(); // all folded at first; the headers show the counts
    fill(wrap, ...groups.map((grp) => {
      const ls = grp.ids.map((id) => byId[id]).filter(Boolean);
      const c = { answered: 0, partial: 0, unknown: 0 };
      ls.forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
      const open = state.openGroups.has(grp.group);
      const sec = h("section", { class: "line-group" + (open ? " is-open" : "") });
      const head = h("button", { type: "button", class: "group-head", "aria-expanded": String(open), onclick: () => {
        const now = sec.classList.toggle("is-open");
        head.setAttribute("aria-expanded", String(now));
        if (now) state.openGroups.add(grp.group); else state.openGroups.delete(grp.group);
      } },
        h("span", { class: "caret", "aria-hidden": "true" }, "▶"),
        h("span", { class: "group-name" }, grp.group),
        h("span", { class: "group-count" }, `${c.answered} answered · ${c.partial} with a limit · ${c.unknown} phone call${c.unknown === 1 ? "" : "s"}`),
        h("span", { class: "mini-bar", "aria-hidden": "true" }, ...["answered", "partial", "unknown"].map((k) => h("span", { class: "seg " + STATUS[k].cls, style: `flex:${c[k]}` }))),
      );
      sec.append(head, h("ul", { class: "lines" }, ls.map((l) => {
        const id = l.id;
        const st = STATUS[l.status] || STATUS.unknown;
        const moved = b.practice && nowById[id] && nowById[id].status !== l.status;
        const body = h("div", { class: "line-more" },
          l.limit ? h("p", {}, h("strong", {}, "Limit: "), l.limit) : null,
          needItems(b, id),
          l.status !== "answered" ? askBlock(l.ask) : null,
          l.labels && l.labels.length ? h("p", { class: "mt-2" }, h("span", { class: "text-ink-soft" }, "Source labels: "), labelChips(l.labels)) : null,
        );
        const li = h("li", { class: "line " + st.cls + (moved ? " moved" : "") },
          h("button", { type: "button", class: "line-head", "aria-expanded": "false", onclick: (e) => {
            const o = li.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", String(o));
          } },
            h("span", { class: "st-chip" }, st.word),
            h("span", { class: "line-q" }, l.question),
            h("span", { class: "line-a" }, l.status === "unknown" ? (l.ask && l.ask.owner ? "Ask: " + l.ask.owner : "unknown") : l.answer),
            moved ? h("span", { class: "moved-tag" }, "moved up") : null,
          ), body);
        return li;
      })));
      return sec;
    }));
  }
  function renderStats(b) {
    const sd = b.shelter_demand || {};
    const hur = state.hazard === "hurricane";
    const cell = (big, label, note) => h("div", {}, h("p", { class: "font-serif text-4xl font-semibold text-brand tabular-nums leading-none" }, big), h("p", { class: "mt-2 text-sm leading-snug" }, label), note ? h("p", { class: "mt-1 text-xs text-ink-soft" }, note) : null);
    const afn = b.afn_in_zone || {};
    const pick = (id) => afn[id] ? `${fmt(round(afn[id].estimate))}` : "unknown";
    fill($("#b-stats"), 
      cell(fmt(round(b.people_in_zone && b.people_in_zone.estimate != null ? b.people_in_zone.estimate : b.people_in_zone)), hur ? "people on the island(s): a hurricane can reach everyone" : "people living in the hazard zone", b.second_line ? (b.second_line.text || b.second_line.label || "") : null),
      cell(fmt(round(sd.likely)), hur ? "would seek a public shelter in a direct hit (planning case)" : "likely to need a public shelter", `range ${fmt(round(sd.low))}–${fmt(round(sd.high))}`),
      cell(pick("ambulatory_difficulty"), "people in the zone with difficulty walking or climbing stairs", "Census ACS, ± margin in the lines below"),
      cell(pick("no_vehicle_households"), "households in the zone without a vehicle", null),
    );
    const n = { answered: 0, partial: 0, unknown: 0 };
    b.lines.forEach((l) => (n[l.status] = (n[l.status] || 0) + 1));
    const tot = b.lines.length;
    fill($("#b-bar"), ...["answered", "partial", "unknown"].map((k) => h("span", { class: "seg " + STATUS[k].cls, style: `flex:${n[k]}`, title: `${STATUS[k].word}: ${n[k]}` }, n[k] ? String(n[k]) : "")));
    const key = (k, txt) => `<span class="whitespace-nowrap"><span class="seg ${STATUS[k].cls} inline-block w-3 h-3 align-[-1px] mr-1 border border-line"></span>${txt}</span>`;
    $("#b-bar-text").innerHTML = [key("answered", `${n.answered} answered`), key("partial", `${n.partial} answered, with a limit`), key("unknown", `${n.unknown} need a phone call`)].join(" &nbsp; ") + ` <span class="whitespace-nowrap">(of ${tot})</span>`;
    // hurricane: say plainly what the planning case is and what past storms did
    const note = $("#b-hurricane-note");
    if (hur) {
      const rows = (D.backtest.rows || []).filter((r) => r.hazard === "hurricane" && r.county === state.county && r.usability === "main");
      const past = rows.map((r) => `${r.event} ${r.count_date.slice(0, 4)}: ${fmt(r.published)}`).join("; ");
      note.innerHTML = `<p><strong>Read hurricane numbers as a planning case, not a forecast.</strong> The shelter figure applies the Hawaiʻi Hurricane Behavioral Study's planning rate to everyone on the island, which describes a direct hit by a major hurricane. Storms since ʻIniki (1992) were near misses${past ? ` and far fewer people came (${past} in public shelters)` : ""}. Use the planning case to size what a direct hit would take; past turnouts show what a near miss looks like.</p>`;
      note.classList.remove("hidden");
    } else note.classList.add("hidden");
  }
  function renderDecisions(b) {
    const phase = { before: "Before", during: "During", after: "After" };
    const hint = { before: "Get ready", during: "Respond", after: "Recover" };
    const card = (dp) => {
      const basis = (dp.owner && dp.owner.basis) || "";
      const c = { answered: 0, partial: 0, unknown: 0 };
      (dp.lines || []).forEach((x) => (c[x.status] = (c[x.status] || 0) + 1));
      const n = (dp.lines || []).length;
      const seg = (k) => (c[k] ? h("span", { class: `seg st-${k}`, style: `flex:${c[k]}` }) : null);
      return h("li", { class: "dp" },
        h("p", { class: "dp-when" }, h("span", { class: "dp-when-k" }, "When"), dp.trigger),
        h("p", { class: "dp-q" }, dp.decision),
        h("div", { class: "dp-foot" },
          h("p", { class: "dp-owner" }, h("span", { class: "dp-owner-k" }, "Owner"), (dp.owner && dp.owner.who) || "to confirm"),
          basis ? h("span", { class: `dp-basis ${/team/i.test(basis) ? "is-proposal" : ""}` }, basis) : null,
          n ? h("div", { class: "dp-status" },
            h("div", { class: "dp-bar", role: "img", "aria-label": `${c.answered} of ${n} answered, ${c.partial} with a limit, ${c.unknown} need a call` }, seg("answered"), seg("partial"), seg("unknown")),
            h("p", { class: "dp-count" }, h("strong", {}, `${c.answered} of ${n}`), " answered",
              c.partial ? ` · ${c.partial} with a limit` : "", c.unknown ? ` · ${c.unknown} need a call` : ""),
          ) : null,
        ),
      );
    };
    const dps = b.decision_points || [];
    const keys = Object.keys(phase).concat([...new Set(dps.map((d) => d.phase))].filter((k) => !(k in phase)));
    fill($("#b-decisions"), ...keys.map((k, i) => {
      const items = dps.filter((d) => d.phase === k);
      return items.length ? h("li", { class: "dp-col" },
        h("div", { class: "dp-head" },
          h("span", { class: "dp-step" }, String(i + 1)),
          h("span", { class: "dp-phase" }, phase[k] || k),
          hint[k] ? h("span", { class: "dp-hint" }, hint[k]) : null,
          h("span", { class: "dp-n" }, `${items.length} ${items.length === 1 ? "decision" : "decisions"}`),
        ),
        h("ul", { class: "dp-list" }, ...items.map(card)),
      ) : null;
    }));
  }
  function renderOutreach(b) {
    const o = b.outreach || {};
    $("#b-outreach-rule").textContent = plain(o.rule);
    fill($("#b-outreach"), ...(o.top_tracts || []).slice(0, 8).map((t, i) => h("li", { class: "outreach-row" },
      h("span", { class: "badge badge-sm" }, String(i + 1)),
      h("span", {}, h("strong", {}, t.community || t.geoid), h("span", { class: "text-ink-soft" }, ` · ${fmt(round(t.people_in_zone))} in zone`)),
      h("span", { class: "num" }, `${fmt(round(t.any_disability))} ± ${fmt(round(t.any_disability_moe))}`, h("span", { class: "text-ink-soft text-xs" }, " with a disability")),
    )));
  }
  function renderSites(b) {
    const det = detail();
    const byId = Object.fromEntries(det.sites.map((x) => [x.id, x]));
    const status = D.hazards[state.hazard].site_status || {};
    const order = { inside: 0, "whole-island": 0, check: 1, unknown: 2, outside: 3 };
    const rows = (b.sites || []).map((x) => ({ ...x, site: byId[x.id] })).filter((x) => x.site)
      .sort((a, c) => (order[a.zone_flag] ?? 9) - (order[c.zone_flag] ?? 9) || (c.site.last_opened || "").localeCompare(a.site.last_opened || ""));
    const counts = {};
    rows.forEach((r) => (counts[r.zone_flag] = (counts[r.zone_flag] || 0) + 1));
    const ul = $("#b-sites");
    fill(ul, 
      h("li", { class: "text-ink-soft mb-2" }, `${rows.length} sites known. ` + Object.entries(counts).map(([k, v]) => `${v} ${k === "whole-island" ? "on the island" : k}`).join(", ") + "."),
      ...rows.slice(0, 12).map((r) => h("li", { class: "site-row" },
        h("span", { class: "flag flag-" + r.zone_flag }, r.zone_flag === "whole-island" ? "island" : r.zone_flag),
        h("span", {}, h("strong", {}, r.site.name), h("span", { class: "text-ink-soft" }, ` · ${r.site.town || ""}${r.site.last_opened ? " · last opened " + r.site.last_opened : ""}`),
          h("br", {}), h("span", { class: "text-xs text-ink-soft" }, status[r.zone_flag] || "")))),
      rows.length > 12 ? h("li", { class: "text-ink-soft mt-2" }, `+ ${rows.length - 12} more in the county's site file.`) : null,
    );
  }

  function render() {
    writeHash();
    pickers();
    const b = brief();
    const hz = D.hazards[state.hazard];
    $("#b-hazard-tag").innerHTML = `<span class="inline-block w-3 h-3 align-[-1px] mr-2" style="background:${HAZ_COLOR[state.hazard]}"></span>${hz.name} · notice: ${hz.notice}`;
    $("#b-title").textContent = `${countyName(state.county)}: ${hz.name.toLowerCase()} brief`;
    $("#b-rule").textContent = `Zone: ${plain(b.zone_rule || hz.zone_rule)}`;
    const tog = $("#practice-toggle");
    const full = detail().briefs[`${state.county}-${state.hazard}`];
    if (full.next && full.next.lines) {
      tog.classList.remove("hidden");
      tog.querySelectorAll(".view-btn").forEach((btn) => {
        btn.classList.toggle("is-on", btn.dataset.view === state.view);
        btn.onclick = () => { state.view = btn.dataset.view; render(); };
      });
      $("#practice-note").textContent = "Practice data: what this brief would say if Maui's emergency management agency kept one dated sheet of its shelter sites. Nothing is invented: a capacity appears only where a public record already lists one; every other box stays unknown.";
    } else { tog.classList.add("hidden"); state.view = "now"; }
    $("#brief").classList.toggle("is-practice", !!b.practice);
    drawMap();
    renderStats(b);
    renderLines(b);
    renderDecisions(b);
    renderOutreach(b);
    renderSites(b);
  }

  /* ---------------- label dialog ---------------- */
  function openLabel(id) {
    const lb = LABELS[id];
    if (!lb) return;
    const lvl = (D.ladder.levels || [])[lb.level] || {};
    const row = (k, v) => (v == null || v === "" || (Array.isArray(v) && !v.length) ? null : h("div", { class: "lbl-row" }, h("dt", {}, k), h("dd", {}, Array.isArray(v) ? h("ul", {}, v.map((x) => h("li", {}, typeof x === "string" ? x : x.text || x.fact || JSON.stringify(x)))) : v)));
    const acc = lb.access || {};
    const link = (u) => (u ? h("a", { href: u, rel: "noopener" }, u) : null);
    fill($("#label-body"), 
      lb.practice ? h("p", { class: "text-xs font-semibold uppercase tracking-wider text-signal" }, "Practice data") : null,
      h("p", { class: "text-sm text-ink-soft" }, "Source label"),
      h("h3", { class: "font-serif text-2xl font-semibold mt-1" }, lb.title),
      h("p", { class: "mt-3" }, h("span", { class: "chip-lvl big", style: `background:${LEVEL_COLOR[lb.level]};color:${LEVEL_TEXT[lb.level]}` }, String(lb.level)), ` Level ${lb.level} · ${lvl.name || ""}`),
      lb.level_reason ? h("p", { class: "mt-1 text-sm text-ink-soft" }, lb.level_reason) : null,
      h("dl", { class: "lbl mt-4" },
        row("What it says", lb.what), row("Owner", lb.owner), row("Sector", lb.sector), row("Area level", lb.area_level), row("Unit", lb.unit),
        row("As of", lb.as_of), row("Last confirmed", lb.confirmed_on), row("Refresh", lb.refresh), row("Privacy", lb.privacy),
        row("How to get it", h("span", {}, acc.how ? acc.how + " " : "", link(acc.url) || link(acc.page) || "", acc.contact_role ? h("span", { class: "block text-ink-soft" }, acc.contact_role) : null)),
        row("What to ask", lb.ask), row("Why it isn't shared today", lb.why_not_shared), row("Limits", lb.limits),
        row("Next rung", lb.next_rung ? (typeof lb.next_rung === "string" ? lb.next_rung : `Level ${lb.next_rung.level}: ${lb.next_rung.step}`) : null),
        row("Used for", (lb.used_for || []).join(", ")),
      ),
    );
    const dlg = $("#label-dialog");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  if ($("#label-dialog")) $("#label-dialog").addEventListener("click", (e) => { if (e.target.id === "label-dialog") e.target.close(); });

  /* ---------------- ladder board ---------------- */
  function ladderBoard() {
    const levels = D.ladder.levels || [];
    fill($("#ladder-board"), ...levels.map((lv, i) => {
      const items = (D.labels || []).filter((l) => l.level === i).sort((a, b) => (a.practice - b.practice) || a.title.localeCompare(b.title));
      return h("section", { class: "rung" },
        h("header", { class: "rung-head", style: `border-top-color:${LEVEL_COLOR[i]}` },
          h("p", { class: "flex items-baseline gap-3" }, h("span", { class: "chip-lvl big", style: `background:${LEVEL_COLOR[i]};color:${LEVEL_TEXT[i]}` }, String(i)), h("span", { class: "font-serif text-xl font-semibold text-brand" }, lv.name)),
          h("p", { class: "mt-2 text-sm leading-snug" }, lv.definition),
          h("p", { class: "mt-2 text-xs text-ink-soft leading-snug" }, h("strong", {}, "An AI agent can: "), lv.agent_can),
          h("p", { class: "mt-3 text-sm font-semibold" }, `${items.length} sources`)),
        h("ul", { class: "rung-list" }, items.map((l) => h("li", {}, h("button", { type: "button", onclick: () => openLabel(l.id) },
          h("span", { class: "block font-medium leading-snug" }, l.title, l.practice ? h("span", { class: "tag-practice" }, "Practice data") : null),
          h("span", { class: "block text-xs text-ink-soft" }, `${l.owner || ""}${l.as_of && l.as_of !== "unknown" ? " · " + l.as_of : ""}`))))));
    }));
  }

  /* ---------------- back-test ---------------- */
  function backtest() {
    const rows = (D.backtest.rows || []).filter((r) => r.usability === "main");
    const order = { hurricane: 0, wildfire: 1, tsunami: 2, flood: 3 };
    rows.sort((a, b) => order[a.hazard] - order[b.hazard] || a.count_date.localeCompare(b.count_date));
    fill($("#bt-table"), 
      h("thead", {}, h("tr", {}, ...["Event", "County", "Area modeled", "Published count", "Model range (likely)", "Result"].map((t, i) => h("th", { class: i >= 3 ? "num" : "" }, t)))),
      h("tbody", {}, rows.map((r) => {
        const m = r.model || {};
        const res = r.published == null ? "count not published" : r.within_band ? "inside the range" : r.published < (m.low || 0) ? `${(m.likely / r.published).toFixed(0)}× too high` : `${(r.published / m.likely).toFixed(1)}× too low`;
        return h("tr", {},
          h("td", {}, h("span", { class: "inline-block w-2.5 h-2.5 mr-2", style: `background:${HAZ_COLOR[r.hazard]}` }), h("a", { href: r.source_url, rel: "noopener" }, `${r.event}`), h("span", { class: "text-ink-soft" }, ` ${r.count_date}`)),
          h("td", {}, countyName(r.county)),
          h("td", { class: "text-ink-soft" }, r.area),
          h("td", { class: "num strong" }, fmt(r.published)),
          h("td", { class: "num" }, `${fmt(round(m.low))}–${fmt(round(m.high))} (${fmt(round(m.likely))})`),
          h("td", { class: "num " + (r.published == null ? "" : r.within_band ? "ok" : "off") }, res));
      })));
    const sum = (D.backtest.summary || []).map((x) => `${x.hazard}: ${x.within_band} of ${x.main_rows} inside the range`).join(" · ");
    $("#bt-reading").innerHTML = `<strong>${sum}.</strong> Hurricane rates are the published planning figure for a direct hit; every storm since ʻIniki (1992) was a near miss, so the model is far too high for those nights, while ʻIniki itself, a direct hit on Kauaʻi, lands inside the range. That is the right number to plan capacity for and the wrong number to staff for a near miss: the brief shows both. Wildfire and tsunami come out low by about 2½–4×, so the high end of the range is the safer planning figure. Few events have published counts at all, which is itself one of the gaps this project names.`;
  }

  /* ---------------- start ---------------- */
  /* ---------------- brief tabs ---------------- */
  function tabs() {
    const list = $('[role="tablist"]');
    if (!list) return;
    const all = [...list.querySelectorAll('[role="tab"]')];
    const show = (t) => {
      all.forEach((x) => {
        const on = x === t;
        x.setAttribute("aria-selected", String(on));
        x.tabIndex = on ? 0 : -1;
        document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
      });
    };
    all.forEach((t, i) => {
      t.addEventListener("click", () => show(t));
      t.addEventListener("keydown", (e) => {
        const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
        if (j == null) return;
        const n = all[(j + all.length) % all.length]; show(n); n.focus();
      });
    });
  }

  // Each page has only some of these parts; run the ones whose element is on the page.
  if ($("#brief")) {
    $("#print-brief").addEventListener("click", () => window.print());
    // Print every part of the brief, not just the open tab. CSS alone can't do this: Tailwind's base
    // layer hides [hidden] with !important, and a layered !important beats any unlayered rule.
    let hiddenPanels = [];
    window.addEventListener("beforeprint", () => {
      hiddenPanels = [...document.querySelectorAll(".tab-panel[hidden]")];
      hiddenPanels.forEach((p) => (p.hidden = false));
    });
    window.addEventListener("afterprint", () => {
      hiddenPanels.forEach((p) => (p.hidden = true));
      hiddenPanels = [];
    });
    window.addEventListener("hashchange", () => { readHash(); render(); });
    readHash();
    render();
    tabs();
  }
  if ($("#ladder-board")) ladderBoard();
  if ($("#bt-table")) backtest();
})();
