# D7 Route · D7 Marketing

A static route planner hosted at https://codydavidek0104-crypto.github.io/Route-planner/.
No build step or server application is required. Publish the root files and icons to the same Pages location to keep the existing shared URL.

## Files

- `index.html`: accessible page markup, branding links and Google Maps loader.
- `styles.css`: pure-black responsive interface, open address timeline and restrained crimson actions.
- `map-theme.js`: embedded dark roadmap styling and real-coordinate route markers.
- `app.js`: route planning, navigation, saved routes, trip progress and reports.
- `service-worker.js`: versioned, same-origin app shell cache.
- `manifest.webmanifest` and `icons/`: existing install metadata and D7 assets.

`map-theme.js` loads before `app.js`, which loads before the asynchronous Google script so `initMap` and the error handler are available when Google calls them. Do not add `async` or `defer` to the local scripts without revisiting this ordering.

## Interface and workflow

D7 Route implements the approved Seamless + Horizon hybrid with a pure-black canvas, the company D7 mark beside Route and D7 Marketing, open underlined address rows, small ring-and-dot stop markers and a red route connector. The route form begins with Start; the single fuel section sits below Finish. Plan, Saved routes and Trip reports select working views without clearing the current draft. The header's Vehicle & fuel shortcut reveals and focuses those same inline MPG and price settings. On tablet and phone, the map sits above the planner and the page scrolls naturally.

An active trip hides the editable address form, planning actions and planning navigation controls, while keeping trip controls and the map accessible. Fuel settings collapse and remain reachable through their summary or the header shortcut; editing them does not alter a trip's saved snapshot. Restored trips use the same state. Finishing a trip opens its report; Home, Skip and Plan return to the appropriate accessible planning or trip heading. JSON backups live in Saved routes, and CSV/copy/email/share remain in Trip reports. Job spreadsheets can be reviewed and imported directly; there is no arrival scheduling.

Roadmap styling changes geography and labels through Google's map options; native map/satellite, zoom, fullscreen and attribution remain intact. Custom Start, numbered Stop and Finish markers use actual validated Directions coordinates. If marker capabilities or coordinates are unavailable, Google's normal markers remain. Maps authorization/load failure shows a clear message while leaving plain-text route editing and saved routes usable.

## Route planning

The start and finish stay fixed. **Plan Route** accepts up to **500 intermediate stops in any order** and compares complete routes for the selected **Plan for** objective: fuel efficiency, fastest driving time, or less backtracking. **Keep My Order** preserves the entered/manual order. To return to a depot, enter the same Start and Finish. Delayed Places formatting preserves the selected action.

Each Directions request respects Google's 25 intermediate waypoint limit. Plan Route runs at most **two independent sections at a time** and assembles out-of-order replies into a complete route. Keep My Order remains sequential. An initial locating or main optimization failure publishes no route, even if a measured input-order reference exists. Authorization failures and exhausted quota retries are fatal in every phase. Only a failure in the additional comparison can retain a successfully optimized complete route, with an explicit incomplete-comparison notice. Every attempt has a 20-second timeout. Rate limits pause new requests before one retry per affected section, with at most two retry attempts across the entire plan. Edits, cancellation and late callbacks cannot publish stale work.

For unconstrained routes up to 25 stops, Google first optimizes the whole list. Larger/constrained jobs locate stops through the existing Directions service, freeze the priority tiers from those coordinates, and measure the established full-list nearest-neighbor/four-pass 2-opt seed with road optimization inside priority groups. The entered order remains a reference and safety comparison; **it does not count as a generated alternative**. A local candidate pool uses six starting choices and up to eight geographic improvement passes. Time screening uses directed road durations already measured, with geographic speed estimates for unknown edges; backtracking screening penalizes distance-weighted reversals. The pool is bounded and makes no pairwise matrix API calls. The second generated order is measured exactly, including changes across the original section boundaries, and reuses any identical sections already measured in this plan.

Additional requests must earn their cost: for small jobs, a distinct local candidate must predict at least a 0.5% objective improvement; for larger jobs it must be within 15% of the primary candidate's screening score. These are screening heuristics, not guaranteed road improvements. No forced reverse-order fallback is sent just to claim two candidates. Consecutive duplicate addresses and equivalent reversed depot loops are deduplicated during screening, while every visit, label and First flag stays intact. If no worthwhile distinct candidate exists, the readout explicitly says the extra request was skipped. A weak geographic screen can miss a better road route; real-job validation remains necessary.

Final ranking uses **measured road mileage** for fuel, **measured driving duration** for time, and **distance-weighted geographic reversals** for less backtracking. Consecutive colocated visits are skipped only in the reversal calculation, so they cannot hide a turn. A long reversal carries more weight than a short one. Backtracking candidates must be within the user's maximum extra mileage of the shortest measured compliant route (default **10%**, adjustable **0–50%**). It is a geographic proxy, not repeated-road detection. Missing coordinates fall back to mileage with a notice. Fuel is miles/fixed MPG; time does not predict arrival traffic. No vehicle/elevation model, weather prediction, invented deadlines or globally optimal solution is claimed.

The recommendation shows mileage, drive time, estimated gallons/cost and geographic reversals for each distinct measured order. **Use this route** can select an evaluated alternative without another mapping call and labels it as selected by the user. Repeated clicks on the same pending planning action share the existing work. Alternative selection is disabled during active trips. Changing the objective or extra-mileage limit locally re-ranks the already measured set without new requests; pressing Plan Route starts a fresh objective-specific search. Fuel edits refresh estimates without requests. Address/instruction/First edits discard the in-memory candidate cache, and active trips retain their captured snapshots. Saved routes and version-1 backups retain the objective and mileage limit; old saves default to fuel and 10%.

Request budget before priority boundaries/provider-requested splits: small unconstrained jobs use one initial request and **at most one screened comparison**; 100 stops use up to twelve requests and 500 up to sixty, plus at most two quota retries per plan. Exact-section reuse can reduce this. All calls use the existing Directions service; no new paid service, credential or Cloud change is introduced. Status shows elapsed planning time, request count, reused sections and generated-route count separately from the input reference.

**Validation limits:** 162 tests cover failure phases, quotas/backoff, cached re-ranking, guardrails, candidate generation, duplicate visits, section reuse and 500 stops alongside the existing safety suites. A one-second-response 100-stop fixture evaluates two generated routes plus the input reference in **6.0 seconds / twelve requests** with two sections in flight, versus 8.0 seconds / eight sequential requests in the old two-pass planner. This trades additional measurements for lower simulated wait; it is not live Google latency. In a separate 24-job synthetic comparison using the previous review's road mock, the revised planner beat main's fuel mileage in seven cases and was worse in none; all eight small unconstrained jobs skipped the second request. These numbers depend on the mock. Real routes, Google latency/usage and phones remain untested.

**Integration:** this PR intentionally remains separate from the unmerged calendar/weather PR #9. Their HTML and shell-cache edits require reconciliation when an integration/release order is authorized. No calendar merge, application merge or deployment is part of these fixes.

**Route instructions (optional)** starts blank. Supported semicolon/newline-separated clauses: `first stops: 2, 5`, `north first`, `south first`, and `north cutoff: 42`. North/south classify coordinates at the chosen latitude (40 by default); they are geographic rules, not a weather forecast. First stops outrank regional groups. Unsupported/conflicting instructions or nonexistent stop numbers block planning with an explanation. First checkboxes and move arrows offer direct customization. Keep My Order explicitly ignores priority optimization and preserves the manual list. Saved instructions restore only with their saved route; selecting a new spreadsheet clears earlier job text instructions, and replacing the draft resets earlier first flags. Numeric instruction references follow records when the user moves, removes or optimizes stops.

## Job spreadsheet import

Upload XLSX, CSV or TSV once, review the detected sheet/columns and selected rows, optionally enter instructions, then use **Import & Plan Route** for the same default planner. **Use stops only** lets the user edit before planning. Both keep Start, Finish, MPG, fuel price and existing saved routes intact. The default import replaces the draft stop list; Append is an explicit option. Existing active trips cannot be overwritten by import.

File parsing happens locally with a vendored MIT-licensed ExcelJS 4.4.0 browser build. No spreadsheet is uploaded to a server; addresses are sent to Google only when route planning is requested. The reader detects common complete-address and street/city/state/postal headers, accepts headerless address lists, and offers manual mapping and worksheet/header selection. Mixed full/street-only Address fields are joined with missing locality fields without repeating already-present components. Store labels stay separate from routing addresses, survive reordering/saves/JSON backups and appear in itinerary/trip/report text. Blank rows are omitted, unusable address rows are excluded visibly, and duplicate addresses are preserved as separate visits. Preview is text validation, not confirmation that Google has resolved each address.

Practical import limits: 5 MB file, 5,000 data rows, 100 columns, 100 worksheets; XLSX ZIP expansion is limited to 64 MB before parsing. At most 500 selected intermediate stops can enter one route. Encrypted XLSX, old binary XLS and unsupported formats are rejected with an explanation. Leading-zero text ZIP codes and numeric ZIP cells formatted with zeros are preserved. Formula cells use their cached results; formulas are not executed. No direct Google Sheet URL import is provided; download XLSX/CSV first.
Only after this optimization are navigation URLs split into overlapping legs. Links contain at most nine intermediate waypoints on desktop or three for recognized mobile browsers/iPads. URL navigation requires internet; Start from my location applies only to the first leg. Unusual browsers that do not identify themselves as mobile may need next-stop navigation. Very long addresses can exceed Google's 2,048-character URL limit; next-stop navigation uses shorter URLs.

Address edits, a newer request, normalization from autocomplete, authentication failure, and request timeouts keep obsolete responses from publishing. Missing or malformed result data does not start a trip. The existing trip snapshots and reports remain available.

Editing MPG or fuel price refreshes the fuel estimate for a current valid plan without another Maps request. Invalid or overflowing costs show as unavailable. Active trips keep the estimate and fuel settings captured when they started.

## Offline access

After one successful online visit over HTTPS (or localhost), the service worker saves the local shell. Reopening can show saved routes, trip progress and reports from that browser's localStorage. The worker explicitly allows only app files; it never caches Google scripts, maps, tiles, Places or Directions responses, downloaded backups, or customer route/report data.

Maps, autocomplete, planning and external navigation require internet. Offline status is visible and planning is blocked when the browser reports it is offline. A failed cache installation reports that offline setup could not finish. Storage still belongs to this browser/device: private browsing, site-data deletion and storage eviction can remove it.

The worker uses cache-first responses for a consistent shell release, activates only after the entire compatible app shell is cached, and removes only obsolete caches for this app's scope. Open pages retain their in-memory draft until reloaded. Reload to apply an available update; there is no forced navigation. No customer localStorage is cleared. **Bump `CACHE_NAME` in `service-worker.js` whenever a shell file changes in a release.** Keep the manifest scope, start URL, script and stylesheet URLs relative for the `/Route-planner/` Pages path.

## Saved-route backups

Saved routes → **Export JSON** downloads a version 1 `d7-route-backup` file with named routes, start/stops/finish, MPG and fuel price. **Import JSON** merges it into saved routes on the current device and asks before replacing matching route names. It does not change the route currently being edited or an active trip; choose a saved route and Load to use it. This backup contains saved routes only; the existing CSV export handles trip reports.

Imports validate the entire file before a single storage write. Limits: 1 MB per backup, 500 saved routes, 128 characters per name, 512 characters per address, 500 intermediate stops per route and positive finite fuel settings. Legacy routes with no start field are migrated by using their first stop as the origin. Invalid input, a cancelled replacement, corrupt existing storage or a quota error leave existing storage intact. Names and addresses remain text, including markup and prototype-like names. Keep backups private when they contain customer addresses.

## Maps key and Cloud Console

The browser Maps key is visible to site visitors. Moving it to another static file or a build-time variable cannot make it private. Protect this browser key using website and API restrictions in Google Cloud Console; never place server credentials or a service-account key here.

Inspection on October 10 confirmed the source key matches `d7-droute`'s Maps Platform API Key. Its current website allowlist includes this account's Pages origin and one Codespaces preview; its API list allows 35 services. The user confirmed the key is used only by D7. The recommended change is to reduce that API list to the three services below. This task has not changed Cloud settings. Confirm whether the Codespaces preview is retired before removing its referrer.

1. Open https://console.cloud.google.com/apis/credentials and select the correct Cloud project and the key used by this app. Compare it privately; do not paste it into reviews or chat.
2. This key is dedicated to D7, as confirmed by the user. Confirm whether the old Codespaces preview is still used before removing its website entry.
3. Application restrictions → **Websites**. Allow `https://codydavidek0104-crypto.github.io` and `https://codydavidek0104-crypto.github.io/*`. This covers this account's Pages origin, including other Pages paths under the account. Avoid a wildcard across all `github.io` sites. Browsers often omit paths from cross-origin referrers, making a restriction limited to `/Route-planner/` unreliable.
4. API restrictions → **Restrict key**. Allow **Maps JavaScript API**, **Directions API (Legacy)** and **Places API** for the existing classic Autocomplete integration. Do not substitute Places API (New) unless the app is migrated to that API.
5. Save, allow propagation and verify the actual Pages URL: map display, address suggestions, Optimize Route and Calculate Route. Use Maps metrics filtered by the key to confirm expected services and origins. Console configuration is the source of truth; source code cannot prove it.

For development, use a separate browser key restricted to the exact localhost origin/port and these APIs. Keep the production restriction narrow. Don't disable production restrictions to make a local preview work. Rotate a key if abuse or other evidence warrants it; coordinate replacing it with deployment so existing links keep working.

References: [Google security guidance](https://developers.google.com/maps/api-security-best-practices), [Directions service limits](https://developers.google.com/maps/documentation/javascript/legacy/directions), [Maps URL limits](https://developers.google.com/maps/documentation/urls/get-started).

## Validation

Run:

```text
node --test --test-isolation=none tests/route-safety.test.cjs tests/route-planning.test.cjs tests/branding.test.cjs tests/offline.test.cjs tests/map-theme.test.cjs tests/stop-import.test.cjs
node --check app.js
node --check map-theme.js
node --check service-worker.js
git diff --check
```

The original safety and branding suites were run after each implementation stage. Additional regressions exercise whole-route optimization across navigation boundaries, mobile navigation, malformed results, offline route access, worker cache isolation, backup round-trips, collisions/cancellation, invalid files, storage errors, legacy routes, unusual names, and concurrent imports. Tests use mocked Maps responses; real Maps authorization is checked separately at the public URL.

## Company D7 mark

The header and install icons now use icons/d7-mark-only.png: a D7-only edit of the original company image, removing the domain lettering and Marketing & Installation Services tagline at the user's request. The distinctive black serif D and red sweeping 7 remain beside the existing ROUTE and D7 MARKETING labels. The header backing is transparent as requested. A minimal neutral CSS edge keeps the black D readable on the dark header without changing the artwork pixels or colors. Installed icons retain their existing square canvases. The built-in image tool removed the embedded lettering; scripts/generate-icons.mjs derives all install sizes from that one mark with proportional scaling and a safe maskable inset.

The untouched original email attachment remains as icons/d7-logo-original.png for reference (SHA-256 df64ed682406e6c8bf5034f80e775fe05fa59209d5a80cfe86f23f6527b9d3ce), but is not displayed or included in the shell cache. The private local recovery archive is unchanged. The header mark is an edited derivative, not the byte-identical original attachment.
### October 12 exposure follow-up

The Google key in GitGuardian's reported commit 3ade8d39e61cdd619c5efbd433f267c550cd9bb3 matches the current browser Maps loader key. No server credential was identified in that loader. The signed-in D7 Droute Cloud credentials page returned "Failed to load API keys" during this recovery, so current restrictions and usage could not be verified and no restriction or rotation change was made. The October 10 inspection above is historical evidence, not confirmation of today's settings.

Finish the Cloud review by restricting this dedicated key to the listed three APIs and intended website referrers, checking usage/billing for unexpected traffic, and coordinating rotation with the deployed loader if compromise is suspected. Removing the key from a new source commit does not revoke copies already in Git history. Keep preservation archives local and private; they contain the original source and key. Do not upload them as site assets.
