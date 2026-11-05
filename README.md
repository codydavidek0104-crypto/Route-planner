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

Each Directions request respects Google's 25 intermediate waypoint limit. Plan Route runs at most **two independent sections at a time**, buffers out-of-order replies, and assembles every leg in route order. Keep My Order retains sequential requests. All sections share endpoints; the app displays one fitted map and globally numbered markers, itinerary and trip snapshot. No partial route or partial stop reorder is published. Each request has a 20-second timeout. Edits and authorization failures invalidate pending work. If an optional comparison fails after a compliant complete candidate exists, the app keeps that candidate and explicitly labels the comparison incomplete; a failed initial pass cannot expose a partial route.

For unconstrained routes of up to 25 stops, Google first optimizes the whole waypoint list. Larger or constrained routes first measure the entered order to obtain coordinates, then use full-list nearest-neighbor / bounded 2-opt geographic ordering followed by road optimization inside homogeneous priority groups. Only complete, compliant, distinct visit permutations enter the comparison. If fewer than two have been evaluated, the app measures one geographic alternative in its exact order, reversing within priority tiers if needed to obtain a distinct candidate. It stops after that attempt; it does not run a pairwise distance matrix or unbounded search. Zero/one-stop jobs and fully fixed tier orders may have only one distinct route. Duplicate addresses remain separate visits with their own labels and First flags.

Recommendations are sorted first by the chosen objective: **fuel** uses measured mileage (gallons = miles / fixed MPG), **time** uses summed Directions driving duration, and **backtracking** counts geographic heading changes over 90 degrees at stops, then breaks ties with mileage/time. Backtracking is a geographic proxy, not repeated-road or turn-by-turn detection. If coordinates are unavailable for any candidate, backtracking falls back to mileage and says so. Neither fuel nor time is a vehicle/elevation model or an arrival-traffic prediction. This bounded heuristic does not guarantee a global optimum. The recommendation appears first with mileage, drive time, estimated gallons/cost and reversal counts for each evaluated candidate. Fuel edits refresh these estimates without another request; active trips retain their snapshots.

First checkboxes (including the spreadsheet First column) mean **all marked stops before all unmarked stops**; order within a group remains flexible. Supported regional instructions apply after First. Mark a job's required early locations explicitly; the app does not interpret arbitrary prose, predict weather or invent dates/deadlines. Keep My Order retains its separate behavior and ignores optimization priorities. Saved routes/backups retain the selected objective; old saves default to fuel without changing the backup version or storage keys.

Request budget before provider-requested splits/priority boundaries: two or more unconstrained stops up to 25 normally use two requests rather than one; 100 stops usually use eight, and 500 usually forty. If the baseline is noncompliant or the second result repeats the baseline, one extra exact-order pass may be needed (100: up to twelve; 500: up to sixty). Priority boundaries and provider length-limit splits can add sections. These are existing Directions API requests and can affect existing usage; no new service/key/Cloud configuration is introduced. Planning status shows elapsed click-to-result time, request count and distinct complete routes evaluated.

**Performance verification (mocked network):** the regression test models a one-second response per request for a 100-stop, eight-request job, replies out of order, and measures **4.0 seconds** with the two-section limit, versus eight seconds for the same sequential request graph. This verifies scheduling and assembly, not live Google latency or the cause of Cody's reported delay. Small jobs now wait for an additional comparison request. Live latency, a real poor-route reproduction and actual API usage/quotas still need checking before release; the new on-screen timing provides a starting measurement. No hardware diagnosis is inferred.

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
node --test --test-isolation=none tests/route-safety.test.cjs tests/branding.test.cjs tests/offline.test.cjs tests/map-theme.test.cjs tests/stop-import.test.cjs
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
