# Bill reminder preview package

Prepared October 8, 2026. Implementation is published in [draft pull request #1](https://github.com/gwynneth13-sketch/ChillAllot/pull/1), based on notification-inbox-test. GitHub's Vercel deployment reports the [branch preview](https://chill-allot-git-v1-bill-reminders-chill-ad07.vercel.app/) ready. Hosted bill database updates, worker deployment and Cron activation remain pending, so this preview does not yet provide the complete new reminder behavior. The phone's existing preview link still points to its earlier version.

## Agreed behavior

The creator may notify the other payers when adding a shared bill. That notice opens the bill card. Each payer sees **Set reminder** until choosing a personal reminder; their chosen timing then appears as a link they can tap to change. The creator's timing is never automatically assigned to someone else.

This is the agreed flow for bills, appointments and chores. This package implements bills. Appointment and chore changes remain next in the launch checklist. The Patchwork yellow observation is parked until the user returns with feedback. Existing small mobile text remains a later app-wide accessibility review.

## What is ready

- Personal bill reminder storage, including preserving an existing creator's reminder during the transition.
- Optional bill-added notices to other payers, written atomically with creation. Leaving the checkbox off sends none. Changing a bill does not write another payer's personal preference.
- A private database producer that queues reminders for the existing inbox/push delivery system. No browser tab needs to remain open.
- One notice per payer, bill and due-date occurrence. Queued unread/undelivered reminders cancel or reschedule after changed timing, payment, deletion, access loss or opting out. A previously read or push-service-accepted occurrence is not notified again after Undo.
- Bill notification links resolve the current authorized card, select its Upcoming/Overdue/Paid tab, clear conflicting search and focus it. New-bill notices open the current card; reminder notices identify a specific due-date occurrence.
- Delivery-time checks repeat before each phone send, including after quiet-hour delays or retries.

## Timing rules

New bill reminder controls offer days/weeks before the due date at the person's chosen local time, including zero days for the due day. Scheduling requires a saved valid timezone in that person's notification preferences; it does not guess from the server's timezone.

Calendar intervals preserve the chosen local clock across daylight-saving changes. PostgreSQL resolves a nonexistent spring-transition time forward and an ambiguous fall-transition time using standard time. Tests cover both cases and month-end clamping. Legacy hours/minutes-before values anchor to midnight at the start of the bill's due day; this package adds no new hour/minute controls for date-only bills.

The producer runs once a minute after activation. A late run catches up within 24 hours of the intended time, ending earlier at the end of the due day. Quiet hours delay phone delivery within that same window; the inbox notice is created when the reminder becomes due. Continuous overdue reminders are not part of this package.

A payer who has paid their current share follows the next occurrence shown in their bill list, even while another payer still owes their current share. Completed one-time bills stop reminders.

## Verification

Twenty automated tests pass on Node 24.19.0. They include the actual bill, inbox, push and reminder SQL scripts executed in local PostgreSQL/PGlite 0.3.14 with minimal Supabase auth prerequisites; authenticated/service-role permission checks; creator/payer isolation; optional notices; timezone and DST behavior; cancellation/rescheduling; one-time payment/Undo; access revocation; deduplication; execution of the actual delivery worker with fake network/database adapters; exact bill routing; and the earlier preference-save tests.

The production frontend build, worker TypeScript syntax check and whitespace check pass. The real local browser at 390 CSS pixels verifies direct reminder editing, persistence after reload and opt-out. A separate mounted BillWorkspace fixture verifies search clearing, overdue tab selection/card focus and unavailable-card handling. Test fixture files under tests/browser are excluded from the normal production build entry point.

Run `npm ci` and `npm test`; run `npm run build` for the frontend. The worker tests require Node's `stripTypeScriptTypes` API; the tested runtime is Node 24. The pinned PGlite package is a development dependency only.

Local tests do not verify hosted Supabase Cron, PostgREST schema refresh, real concurrent database sessions, deployed Deno imports, or physical-phone bill delivery. Those are deployment/acceptance gates.

## Deployment order

This project uses administrator-reviewed setup SQL scripts. The additions follow that existing layout. Do not reapply unrelated scripts.

The preview deployments share the hosted database. Applying the bill transition changes shared bill behavior across those deployments, and enabling the producer schedules opted-in payer reminders across eligible households. This is not isolated to a single preview or test household. Review that scope before live activation.

1. Verify the selected Supabase project and source branch. Review live bill/inbox/push definitions against these files, and preserve the current bill data/functions privately for rollback. Avoid exporting credentials, device subscriptions or personal financial records into chat or Git.
2. Apply the updated `supabase/bill-access-setup.sql` and new `supabase/bill-reminders-setup.sql`, in that order, while the reminder Cron job remains inactive. The latter adds a nullable inbox due date and private deduplication ledger. Its worker access wrapper is restricted to service_role. No new secrets or public table access are required.
3. Deploy the matching `supabase/functions/push-delivery/index.ts` and preview frontend from the same commit. Verify two-account visibility, personal settings and optional creation notice before enabling scheduling.
4. Enable Supabase Cron if necessary and apply `supabase/bill-reminder-cron.sql` as the administrator. The named `bill-reminders` job runs the private producer once a minute. Reusing its name updates the job rather than creating another. Monitor successful job runs and database duration. The current producer locks/scans bill rows; measure this on hosted data before increasing scale.
5. Perform the phone checks below. Keep main/production promotion pending until they pass.

Cron setup follows the [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart). The existing push-delivery job still drains the queue; the new job produces bill events.

## Phone and two-account checks

1. Creator adds a shared split bill with the optional notice checked. Only the other payers receive it. Tapping opens that bill and shows Set reminder for a payer who has not chosen one.
2. Creator and another payer choose different times. Verify neither choice changes the other person's timing. A visibility-only viewer receives no payer reminder. Add a second bill with notification unchecked and verify no creation notice.
3. For a due-today test bill, choose zero days before and a time a few minutes ahead. Close the app and leave the phone dormant. Verify scheduled push, sound/silent behavior and the exact bill card route. Do not open/read the inbox before testing push; the existing worker skips read notices.
4. Verify quiet-hour deferral, reminder opt-out, payment before delivery, changed timing, deletion, visibility removal/departure and repeated Cron runs. Confirm the expected next occurrence after partial payment and no duplicate for an already read/delivered occurrence after Undo.

## Rollback

First deactivate the named bill-reminders Cron job to stop new production, then finish/cancel pending bill push jobs administratively before reverting the worker/frontend. Keep ledger history so re-enabling does not resend consumed occurrences. The nullable inbox column and private ledger can remain while scheduling is disabled.

A full rollback to inherited shared reminder behavior needs the private pre-deployment backup and explicit review; do not synthesize shared defaults from another person's personal settings. A notification already accepted by a push service cannot be recalled. Access checks reduce stale sends but cannot make an external phone delivery atomic with a simultaneous bill edit.
