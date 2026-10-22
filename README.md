# D7 Route · D7 Marketing

A static route planner hosted at https://codydavidek0104-crypto.github.io/Route-planner/.
No build step or server application is required. Publish the root files and icons to the same Pages location to keep the existing shared URL.

## Files

- `index.html`: accessible page markup, branding links and Google Maps loader.
- `styles.css`: pure-black responsive interface, open address timeline and restrained crimson actions.
- `map-theme.js`: embedded dark roadmap styling and real-coordinate route markers.
- `app.js`: route planning, navigation, saved routes, trip progress and reports.
- `calendar.js`: explicit scheduling of final route snapshots in this browser.
- `route-tools.js`: traffic controls, full-route view and on-demand stop forecasts.
- `service-worker.js`: versioned, same-origin app shell cache.
- `manifest.webmanifest` and `icons/`: existing install metadata and D7 assets.

`map-theme.js` loads before `app.js`; `calendar.js` and `route-tools.js` follow `app.js`. All local scripts load before the asynchronous Google script so the map callbacks and optional controls are ready. Do not add `async` or `defer` to the local scripts without revisiting this ordering.

## Calendar, weather and map update

The compact calendar sits below the planner controls, with the map alongside it on desktop. **Calendar** jumps to the schedule. After planning the final route, choose **Add to calendar**, enter a name and choose one date or an inclusive date range. Nothing is scheduled automatically. A range marks the same route on each selected day; it does not divide stops into daily jobs or calculate arrival times.

Select a scheduled date to open its routes in a small dialog, or a bottom sheet on phones. The saved order is expanded immediately. Close with the × button, Escape or the backdrop. Empty dates show a short message. **Reschedule** changes the name or dates, and **Load route** brings a separate copy into the planner. Use **Keep My Order** to obtain fresh directions without optimizing that order. Loading asks before replacing an existing draft and is blocked during an active trip. Later planner edits do not change the calendar snapshot.

Calendar entries are saved only in this browser/device, up to 500 entries. They do not sync to Google Calendar or other devices and are not included in saved-route JSON backups. Clearing site data can remove them. The update retains existing saved routes and reports.

After planning, open **Weather** above the map or **Weather along your route** below the calendar. Select Start, any numbered stop or Finish, then **Check forecast**. This sends that location's coordinates to the National Weather Service when requested; route names and address lists are not sent to NWS. It shows upcoming day/night forecasts, temperatures, wind and precipitation chances for supported U.S. locations, usually about seven days. These are upcoming forecasts, not forecasts matched to an estimated arrival time or a future calendar date. Results stay in memory for up to ten minutes; a route edit clears the displayed result. Offline or unavailable forecasts do not block route planning.

**Traffic** toggles Google's live traffic layer where available. It does not alter route order or make the existing drive-time estimate traffic-aware. **Show full route** fits all route locations. Map markers use **S** for Start, **F** for Finish and larger, contrasting stop numbers, including three-digit numbers.

Provider references: [NWS API documentation](https://www.weather.gov/documentation/services-web-api), [Google TrafficLayer](https://developers.google.com/maps/documentation/javascript/trafficlayer).

The candidate is prepared for a separate `updated/` path under the current Pages site. Runtime assets use relative paths, and offline caches are scoped to each path. Browser storage is origin-based, so the old and new links on this same origin share saved-route/report storage. Do not install the candidate at the existing root until an intentional replacement is requested. Local review maps are simulated fixtures outside this repository and must never be published.

## Interface and workflow

D7 Route implements the approved Seamless + Horizon hybrid with a pure-black canvas, the company D7 mark beside Route and D7 Marketing, open underlined address rows, small ring-and-dot stop markers and a red route connector. The route form begins with Start; the single fuel section sits below Finish. Plan, Saved routes and Trip reports select working views without clearing the current draft. The header's Vehicle & fuel shortcut reveals and focuses those same inline MPG and price settings. On tablet and phone, the map sits above the planner and the page scrolls naturally.

An active trip hides the editable address form, planning actions and planning navigation controls, while keeping trip controls and the map accessible. Fuel settings collapse and remain reachable through their summary or the header shortcut; editing them does not alter a trip's saved snapshot. Restored trips use the same state. Finishing a trip opens its report; Home, Skip and Plan return to the appropriate accessible planning or trip heading. JSON backups live in Saved routes, and CSV/copy/email/share remain in Trip reports. Job spreadsheets can be reviewed and imported directly; there is no arrival scheduling.

Roadmap styling changes geography and labels through Google's map options; native map/satellite, zoom, fullscreen and attribution remain intact. Custom Start, numbered Stop and Finish markers use actual validated Directions coordinates. If marker capabilities or coordinates are unavailable, Google's normal markers remain. Maps authorization/load failure shows a clear message while leaving plain-text route editing and saved routes usable.

## Route planning

The start and finish stay fixed. **Plan Route** is the default action and aims to reduce driving/estimated fuel for up to **500 intermediate stops**. **Keep My Order** preserves the entered/manual order. To return to a depot, enter the same Start and Finish. Delayed Places formatting preserves the selected action.

Each Directions request respects Google's 25 intermediate waypoint limit. Requests run sequentially and share endpoints; the app combines every leg's distance and duration, displays all route sections with one fitted map and globally numbered markers, and generates one itinerary and trip snapshot. No partial result or partial stop reorder is published. Each request has a 20-second timeout; quota, malformed results, edits and authorization failures abandon the plan. Larger jobs require more time and normal existing API usage: 100 stops need four requests for Keep My Order and eight for default full-list planning; 500 need twenty and forty respectively. Priority boundaries can add requests. There is no promise of instant calculation or unlimited route size, and Cloud quotas can stop a request.

For unconstrained routes of up to 25 stops, Google optimizes the whole waypoint list in one request. Larger routes or routes with instructions first calculate the entered order to obtain the service's returned coordinates, then use a full-list nearest-neighbor / bounded 2-opt geographic heuristic. A second Directions pass optimizes bounded homogeneous priority groups. The candidate is compared with the original **actual driving distance**; the shorter evaluated route is retained only when it complies with the instructions. A noncompliant original order is never chosen merely because it is shorter. This is a lower-driving heuristic, not a global road-distance optimum or a guarantee of lowest real-world fuel use. Fuel estimates still use the user's existing MPG and fuel price.

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
node --test --test-isolation=none tests/route-tools.test.cjs tests/route-safety.test.cjs tests/branding.test.cjs tests/offline.test.cjs tests/map-theme.test.cjs tests/stop-import.test.cjs
node --check app.js
node --check calendar.js
node --check route-tools.js
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
