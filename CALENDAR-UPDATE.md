# D7 update candidate — October 22, 2026

Local worktree: C:/DEV/Route-planner-calendar. Branch: calendar-in-d7. Current main (8c6db10) has been integrated. Calendar checkpoint dee2a50 and merge dfb2608 exist locally. Nothing has been pushed or published.

## Agreed scope

- D7's own compact calendar below the planner controls (chosen concept A), with the map beside it on desktop.
- Explicit Add to calendar for a final route, one date or an inclusive range, route details, reload, reschedule and remove. No automatic scheduling, external calendar integration, statuses or calendar backup in this release.
- On-demand forecast at Start, any stop or Finish.
- Live traffic overlay and clearer numbered map stops.
- Restrained black/red styling with open spacing and fine separators, retaining existing branding and workflows.
- A new link while the original remains available. User wants to see the preview before publication.

## Implemented

calendar.js stores independent ordered snapshots under d7CalendarV1 in browser storage. It validates dates and routes, preserves malformed existing data, handles write failures, prevents duplicate route/date snapshots and rejects stale edits from another tab. Inclusive ranges mark the same route each day; they do not split stops or create arrival times. Saved-route backup does not include calendar entries.

route-tools.js adds a TrafficLayer toggle and whole-route bounds control. Weather uses transient Directions coordinates to request NWS forecasts only after Check forecast. It validates provider URLs/data, limits request duration, cancels stale requests, caches in memory for ten minutes and handles unsupported locations, offline state and unavailable service. It displays upcoming day/night periods, not arrival-time forecasts. Traffic does not affect route optimization or drive-time estimates.

map-theme.js draws S/F endpoints and larger contrasting numbered stop markers, including 100–500. The local shell is v29 and includes both new scripts; remote map/weather responses are not cached.

## Validation completed

- Full suite: 148 tests passed, zero failed, including calendar storage/snapshot/reschedule checks, forecasts, request cancellation, timeouts, service failures, traffic controls and 500-stop markers.
- JavaScript syntax checks and git diff whitespace checks passed.
- Visible browser review: created a sample calendar entry, rescheduled its end date, reloaded the page and restored the scheduled route into the planner.
- Real browser NWS request succeeded for Roseville, CA with timestamp, wind and precipitation chances.
- Responsive checks at 320, 390 and 768 pixels found no horizontal page overflow; map stays present.

## Preview and release boundaries

Visible local preview: http://127.0.0.1:4188/?review=1. The temporary server and simulated map fixture live outside this repository in the project workspace output directory. The banner identifies the map/traffic and distances as simulated; NWS weather calls are real. No customer data is used.

The production browser Maps key rejects localhost. No key restrictions were weakened or changed. Actual Google tiles, live traffic and planning must be checked on the allowed public origin after publication; simulated checks do not validate these services.

Proposed separate address: https://codydavidek0104-crypto.github.io/Route-planner/updated/. This is a deployment target, not a published link yet. Install candidate runtime assets only under updated/, retaining existing root files. Relative URLs and path-scoped service-worker caches support this layout. Both paths share origin-based localStorage; saved routes/reports remain accessible on the same browser. Never publish the preview fixture.

Remaining: review the visible candidate with Cody; publish the reviewed runtime package at the new path; verify actual Maps, traffic, forecast and offline installation; provide the confirmed new link. Never change the read-only project sources/ files.
