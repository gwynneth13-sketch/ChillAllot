# ChillAllot Version 1 launch checklist

Prepared October 8, 2026. This is a proposed launch gate based on inspected code and saved handoff notes. Evidence below distinguishes earlier saved tests from October 8 results.

## Verified starting point

- GitHub read access verified for gwynneth13-sketch/ChillAllot.
- Remote main: 38c8454. Remote notification-inbox-test: 933f346.
- Working copy starts from 933f346, matching the saved release repository. New local branch: v1-preference-safety.
- The referenced conversation exposes user messages but its assistant replies are placeholder references. Detailed October 1–5 handoff notes supplied useful context; code takes precedence for current implementation.
- No connected GitHub browser tab or saved Codex project was available. Repository inspection used Git and the saved source. At that initial checkpoint GitHub write access and current production deployment were not verified. October 8: the signed-in repository-owner browser session was verified and implementation files were published on the separate v1-bill-reminders review branch.

## P0 — launch gates

- [x] Start from the latest notification branch rather than older main.
- [x] Serialize notification preference saves so delayed older requests cannot overwrite newer choices. Cancel queued writes after leaving the scope; display thrown network failures; require matching account/household load before saving.
- [x] Regression tests: delayed writes/latest value, pending-write cancellation, thrown/returned errors and recovery. Three tests pass. Production build and whitespace check pass.
- [ ] Test the React preference integration with delayed loads, rapid edits, household/account changes, offline errors and reload. Current automated tests cover the writer, not mounted React or live database behavior.
- [ ] Verify live database setup against repository scripts, including bill/appointment/shopping isolation, stale-write conflicts, ownership handoff, departure and deletion cleanup. Use two real accounts; ensure direct unauthorized access fails. Do not reapply scripts blindly.
- [ ] Complete or explicitly remove unsupported reminder promises from Version 1: bill overdue events; chore reminders/current-turn supply reminders; appointment reminders and add/edit/delete notices. The initial inspected branch only delivered queued events. October 8 local bill package now supplies a reminder producer and optional bill-added notices; hosted scheduling and phone acceptance remain pending.
- [ ] Define reminder timing before implementing scheduling: user timezone, daylight-saving changes, lead times, recurring occurrence identity, snooze effects and deduplication. Test retries and cancellation after edits, completion or deletion.
- [x] October 8: user verified Samsung Android/Brave silent push arrived without sound and tapping routed directly to Shopping. Sound-on comparison also received push with audible sound; expanding/tapping the lock-screen notification opened the shopping list. Lock-screen contents remained hidden as reported by user. These pass the phone delivery/sound/routing checks for this tested browser and preview; they do not establish scheduling or production deployment readiness.
- Earlier October 8 tests initially showed inbox notices without observed phone push. Read-only live queries confirmed one accepted push and one notice read before processing; a later check found the device registration missing. Subsequent physical-phone silent and sound-on tests passed as recorded above. The cause of the earlier registration disappearance remains unproven. See the saved local push-delivery findings.
- [ ] Verify quiet hours, delivery retry/receipt deduplication, denied permission, device disable and sign-out cleanup with real accounts. Keep notification preferences personal to each account and household.
- [ ] Finish exact-item routes for bills/chores/appointments when their producers are implemented. Confirm removed/inaccessible items show a clear message without leaking details. Shopping exact-list routing already exists in source.
- [ ] Smoke-test main flows: account creation/recovery, invitation/approval, switch/hide/restore/leave household, bill amounts/splits/payment Undo, chore rotation/snooze, appointment optional reminders, shopping membership/edit/delete and empty state.
- [ ] Confirm release defaults contain no demo accounts, sample items, mock backend adapters or private keys.
- [ ] Reconcile notification branch into main only after preview acceptance. Record migration/deployment order, rollback plan and release commit; test production after deployment.

## P1 — polish and behavior decisions

- [ ] Theme scope: inspected code stores theme as shared household data. This explains how another device can receive a theme change; decide whether the intended scope is account or device before changing persistence. Audit button foreground/background and toast contrast in each theme.
- Parked observation, not an action item: the user finds the Patchwork yellow hue potentially off-putting and will seek another human's opinion. Do not change or investigate it unless the user asks later.
- [ ] Notification settings currently offer grouped switches. Match their descriptions to actual supported triggers; add individual switches only alongside real producer/delivery behavior.
- [ ] Household selector: handoff notes say retain it on every page, but inspected source limits it to Home and Settings. Confirm and restore the intended navigation with phone regression coverage.
- [ ] Review remaining noted chore/custom interval issues against current source and screenshots. Avoid treating every historic note as a current defect.

## P2 — accessibility test, no immediate redesign

- [ ] Apply the small-text readability observation app-wide to all text using the same size as the reported examples. Locate matching styles and review affected screens; the user does not need to identify every instance page by page. Preserve this as a later review, with no immediate redesign.
- [ ] Specific small-text discomfort reported October 8: the mobile navigation labels “Bills”, “Shopping”, “Appointments” and “Chores”, plus the shopping item quantity/added-by line (for example, “1 · added by G2”). Start the future readability review with these exact locations. This is a saved observation for later, not a request to change them now.
- [ ] Mobile text readability on Samsung Android/Brave at normal size and enlarged browser/system text. Include small metadata, helper text, reminders, badges and confirmation dialogs.
- [ ] Check zoom/reflow and containment at 320, 390 and 480 CSS pixels; labels should remain readable and controls reachable without horizontal scrolling.
- [ ] Check contrast across themes, keyboard focus, accessible names and comfortable touch targets. Record concrete failures before proposing font/layout changes.

The user currently reports being able to read and tap the interface. Small mobile fonts are a lower-priority observation, not authorization for a visual redesign.

## First implementation package

Initially prepared locally; now included on v1-bill-reminders for review. No merge, hosted SQL update, worker deployment or Cron activation has occurred. The patch starts from notification-inbox-test at 933f346.

Changes: PushPreferenceSync now binds readiness to account/household, resets errors on reload, handles rejected loads, and uses a scoped serialized writer. The writer coalesces pending edits, prevents overlapping writes, suppresses late callbacks after disposal and handles thrown/returned failures. Added a repeatable test command with no new dependencies.

Limitations: an already-started request can finish after leaving; it retains its original account/household destination. Edits made during initial loading can still be replaced by the loaded server preferences, as before. A failed final save reports an error but is not automatically retried. Cross-device simultaneous writes remain last-write-wins. These require follow-up testing and product decisions before launch.

Persistence API reviewed against [Supabase upsert documentation](https://supabase.com/docs/reference/javascript/upsert). No schema, permissions, credentials or delivery settings changed.

## Bill reminder implementation package — October 8

Local implementation and tests are complete. Code is published in [draft pull request #1](https://github.com/gwynneth13-sketch/ChillAllot/pull/1) on v1-bill-reminders; hosted database updates, worker deployment, Cron activation and real-phone bill acceptance remain pending. GitHub's Vercel deployment reports the branch frontend ready. Its shared database still needs the matching reviewed updates before full reminder acceptance.

- [x] Confirmed recipient decision: bill reminders and optional bill-added notices go only to payers. The creator can choose whether to notify other payers when adding a split bill.
- [x] Confirmed shared-card rule for bills, appointments and chores: creator reminder remains personal. A recipient starts with **Set reminder**, chooses their own timing, and taps the visible timing later to change it. Implemented for bills; appointment/chore changes are still pending.
- [x] Bill storage/API no longer returns inherited shared reminder defaults. Preserve an existing creator's choice when migrating; never overwrite explicit personal settings or another person's reminder.
- [x] Calendar scheduling uses the recipient's saved timezone. One notice per bill, payer and occurrence; partial payments follow the next occurrence shown to that payer. Quiet hours defer phone delivery; unread stale notices cancel/reschedule after changes. Read/accepted notices are not duplicated by Undo.
- [x] Worker checks bill access and current reminder both before processing and before each device send. Scheduler/private preference access is unavailable to ordinary accounts.
- [x] Exact bill routes select Upcoming, Overdue or Paid, clear conflicting search and focus the corresponding card. Unavailable/changed items show a neutral message.
- [x] Twenty automated tests pass, including actual feature SQL in local PostgreSQL/PGlite, worker execution with test transport adapters, routing and preference-write regressions. Production build and worker syntax check pass.
- [x] Local browser checks at 390 CSS pixels: Set reminder opens the personal editor; chosen timing survives reload; turning it off restores Set reminder. Mounted card-routing fixture clears a conflicting search, opens/focuses an overdue card and handles an inaccessible target.
- [ ] Deploy the reviewed bill database functions, matching worker and preview frontend; activate one named Cron producer only after account/permission checks. See BILL-REMINDER-REVIEW.md for order and rollback.
- [ ] Real phone/two-account bill acceptance: optional creator notice, separate reminder choices, scheduled delivery with app closed, exact card route, quiet hours, payment/edit cancellation and duplicate prevention. Earlier successful Shopping push tests do not satisfy these bill checks.
- [ ] Follow with the same personal reminder flow for appointments, then chores. Chores currently use a shared document; personal preferences require a backend change before promising personal reminders.
