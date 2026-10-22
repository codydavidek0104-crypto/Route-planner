# D7 calendar update in progress — October 21, 2026

Working branch: calendar-in-d7, based on origin/main 8c03a83. No commit, push, PR, merge or publication made.

User requested D7's own calendar, adding final routes only when explicitly requested. They chose the simpler first release: calendar, route details and rescheduling; no statuses or calendar backup. Single date or inclusive date range supported; date ranges do not split stops into daily routes. Data is browser-local and explicitly described as not syncing or included in saved-route backups.

Implementation: calendar.js, Calendar navigation, explicit Add to calendar after a valid completed plan, independent ordered route snapshots including stop labels/preferences, date picker, month navigation, per-day route details, reschedule/load/remove, duplicate prevention, storage validation and safe write failures. Shell version v28 includes calendar.js. Existing and new tests: 138 passed, zero failed. Syntax and diff checks passed before the last styling revision. Browser QA still pending; live Maps is not verified for this candidate.

Latest cosmetic direction: user rejected boxy cards and a large calendar that replaces the map. Keep the map, use a smaller calendar, borderless design and professional restrained visual polish. Removed full-width/map-hiding styles and reduced calendar to sidebar size, transparent date cells and simple divider lines. Specific placement awaits selection from new visual concepts: A tucked into planner, B floating map corner, C slim schedule strip beneath map. No cosmetic choice has been approved.

Latest concept board (preview only): C:/Users/codyd/.codex/generated_images/01a15eac-676d-75e2-b7b4-1c8b59c08753/exec-aaad08f1-5d0f-4b55-8f5d-3db47c8f3dbb.png

Earlier rejected board: exec-a3e5ae5d-7041-4710-a614-2ececa90cd88.png in the same directory. Do not implement its boxed cards. User's most recent request is to show more visual examples. Finish chosen layout, check responsive browser behavior, document/test changes, then prepare the update for review. Do not claim deployment. Do not touch project mirror sources/.
