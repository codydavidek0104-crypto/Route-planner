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

An active trip hides the editable address form, planning actions and planning navigation controls, while keeping trip controls and the map accessible. Fuel settings collapse and remain reachable through their summary or the header shortcut; editing them does not alter a trip's saved snapshot. Restored trips use the same state. Finishing a trip opens its report; Home, Skip and Plan return to the appropriate accessible planning or trip heading. JSON backups live in Saved routes, and CSV/copy/email/share remain in Trip reports. There is no spreadsheet-import placeholder or arrival scheduling.

Roadmap styling changes geography and labels through Google's map options; native map/satellite, zoom, fullscreen and attribution remain intact. Custom Start, numbered Stop and Finish markers use actual validated Directions coordinates. If marker capabilities or coordinates are unavailable, Google's normal markers remain. Maps authorization/load failure shows a clear message while leaving plain-text route editing and saved routes usable.

## Route planning

The start and finish stay fixed. **Optimize Route** sends all intermediate stops (up to 20) together with `optimizeWaypoints: true`. **Calculate Route** sends them in their entered order without optimization. Delayed Places formatting preserves the selected action. Google supports 25 intermediate waypoints in this service, so Directions request chunking is unnecessary at the current app limit. The app validates the entire returned permutation and every leg before publishing the map, totals, itinerary or navigation links. Optimization is Google's whole-route heuristic; it is not a proof of a mathematically shortest route.

Only after this optimization are navigation URLs split into overlapping legs. Links contain at most nine intermediate waypoints on desktop or three for recognized mobile browsers/iPads. URL navigation requires internet; Start from my location applies only to the first leg. Unusual browsers that do not identify themselves as mobile may need next-stop navigation. Very long addresses can exceed Google's 2,048-character URL limit; next-stop navigation uses shorter URLs.

Address edits, a newer request, normalization from autocomplete, authentication failure, and request timeouts keep obsolete responses from publishing. Missing or malformed result data does not start a trip. The existing trip snapshots and reports remain available.

Editing MPG or fuel price refreshes the fuel estimate for a current valid plan without another Maps request. Invalid or overflowing costs show as unavailable. Active trips keep the estimate and fuel settings captured when they started.

## Offline access

After one successful online visit over HTTPS (or localhost), the service worker saves the local shell. Reopening can show saved routes, trip progress and reports from that browser's localStorage. The worker explicitly allows only app files; it never caches Google scripts, maps, tiles, Places or Directions responses, downloaded backups, or customer route/report data.

Maps, autocomplete, planning and external navigation require internet. Offline status is visible and planning is blocked when the browser reports it is offline. A failed cache installation reports that offline setup could not finish. Storage still belongs to this browser/device: private browsing, site-data deletion and storage eviction can remove it.

The worker uses cache-first responses for a consistent shell release, does not force a waiting update into open tabs, and removes only obsolete caches for this app's scope. Close all D7 tabs/windows and reopen to apply an available update. **Bump `CACHE_NAME` in `service-worker.js` whenever a shell file changes in a release.** Keep the manifest scope, start URL, script and stylesheet URLs relative for the `/Route-planner/` Pages path.

## Saved-route backups

Saved routes → **Export JSON** downloads a version 1 `d7-route-backup` file with named routes, start/stops/finish, MPG and fuel price. **Import JSON** merges it into saved routes on the current device and asks before replacing matching route names. It does not change the route currently being edited or an active trip; choose a saved route and Load to use it. This backup contains saved routes only; the existing CSV export handles trip reports.

Imports validate the entire file before a single storage write. Limits: 1 MB per backup, 500 saved routes, 128 characters per name, 512 characters per address, 20 intermediate stops per route and positive finite fuel settings. Legacy routes with no start field are migrated by using their first stop as the origin. Invalid input, a cancelled replacement, corrupt existing storage or a quota error leave existing storage intact. Names and addresses remain text, including markup and prototype-like names. Keep backups private when they contain customer addresses.

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
node --test --test-isolation=none tests/route-safety.test.cjs tests/branding.test.cjs tests/offline.test.cjs tests/map-theme.test.cjs
node --check app.js
node --check map-theme.js
node --check service-worker.js
git diff --check
```

The original safety and branding suites were run after each implementation stage. Additional regressions exercise whole-route optimization across navigation boundaries, mobile navigation, malformed results, offline route access, worker cache isolation, backup round-trips, collisions/cancellation, invalid files, storage errors, legacy routes, unusual names, and concurrent imports. Tests use mocked Maps responses; real Maps authorization is checked separately at the public URL.

## Company D7 mark

The header and install icons now use icons/d7-mark-only.png: a D7-only edit of the original company image, removing the domain lettering and Marketing & Installation Services tagline at the user's request. The distinctive black serif D and red sweeping 7 remain beside the existing ROUTE and D7 MARKETING labels. A white backing keeps the black D visible. The built-in image tool removed the embedded lettering; scripts/generate-icons.mjs derives all install sizes from that one mark with proportional scaling and a safe maskable inset.

The untouched original email attachment remains as icons/d7-logo-original.png for reference (SHA-256 df64ed682406e6c8bf5034f80e775fe05fa59209d5a80cfe86f23f6527b9d3ce), but is not displayed or included in the shell cache. The private local recovery archive is unchanged. The header mark is an edited derivative, not the byte-identical original attachment.
### October 12 exposure follow-up

The Google key in GitGuardian's reported commit 3ade8d39e61cdd619c5efbd433f267c550cd9bb3 matches the current browser Maps loader key. No server credential was identified in that loader. The signed-in D7 Droute Cloud credentials page returned "Failed to load API keys" during this recovery, so current restrictions and usage could not be verified and no restriction or rotation change was made. The October 10 inspection above is historical evidence, not confirmation of today's settings.

Finish the Cloud review by restricting this dedicated key to the listed three APIs and intended website referrers, checking usage/billing for unexpected traffic, and coordinating rotation with the deployed loader if compromise is suspected. Removing the key from a new source commit does not revoke copies already in Git history. Keep preservation archives local and private; they contain the original source and key. Do not upload them as site assets.
