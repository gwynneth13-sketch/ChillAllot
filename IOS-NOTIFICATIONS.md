# Native iPhone notification preparation — October 14, 2026

## Checkpoint status

This branch builds on the tested iPhone checkpoint `34491418679db4e51bef5736329cca096e556417`. Safe-area spacing, form focus zoom, and keyboard-aware popup scrolling are preserved.

The client integration and APNs sender are prepared, but native push is gated off until Apple membership, signing, server credentials, and backend deployment are ready. No live database or Edge Function was changed in this session, and no new build was installed on an iPhone.

The live Android backend already had FCM support not present in the original checkout. `supabase/functions/push-delivery/index.ts` incorporates that deployed version 6 before adding the iOS path. Preserve its FCM transport and existing secrets when deploying.

## Prepared implementation

- `@capacitor/push-notifications` 8.1.3, Swift registration callbacks, and foreground banner/list/sound configuration.
- Separate native iOS settings; permissions are requested only after tapping Enable.
- Tokens refresh on launch only for an account that opted in.
- Registration waits for the server save; sign-out removes it before ending the local session. Sign-out is local to this device.
- Native notification taps retain the existing inbox ID until sign-in, household loading, and access checks complete.
- Additive `ios_push_devices` migration with RLS, restricted owner-only registration/removal, token validation, and stable delivery identities. Existing Android device tables are unchanged.
- APNs ES256 provider authentication, environment-specific keys, 50-minute token caching, quiet sound payloads, and one-hour notification expiry.
- The existing worker applies quiet hours, recipient membership, list/bill/appointment validity, duplicate receipts, and current device registration checks to iOS targets as well.
- APNs configuration errors are retryable; only explicit Unregistered responses retire a matching device token.

## Activation steps, in order

1. Confirm the Apple Developer Program membership is active, then select the paid team in Xcode.
2. Add Push Notifications in the app target's Signing & Capabilities. Check the generated `aps-environment` entitlement and provisioning profile. Do not enable this capability on the old Personal Team build.
3. Create an APNs signing key for the app/team and correct environment in Apple's developer account. Store the `.p8` file securely; do not commit it or paste it in chat.
4. Review/apply `supabase/migrations/20261014183653_ios_push_devices.sql` to the existing project. Validate ownership/RLS and run security advisors after applying.
5. Set server-only Edge Function secrets for the appropriate environment:
   - `APNS_SANDBOX_TEAM_ID`, `APNS_SANDBOX_KEY_ID`, `APNS_SANDBOX_PRIVATE_KEY`
   - `APNS_PRODUCTION_TEAM_ID`, `APNS_PRODUCTION_KEY_ID`, `APNS_PRODUCTION_PRIVATE_KEY` for TestFlight/App Store builds.
   Preserve existing `FCM_*`, `PUSH_*`, and Supabase secrets. No private credential belongs in any `VITE_*` variable.
6. Deploy the combined push-delivery worker only after the migration is applied. Verify the live worker hasn't changed since the version inspected here before replacing it.
7. In the local frontend environment, set `VITE_IOS_PUSH_READY=true` and the signing-appropriate `VITE_APNS_ENVIRONMENT=sandbox` or `production`. These are public configuration flags, not secrets. Development provisioning normally uses sandbox; TestFlight/App Store signing uses production. A mismatch must be fixed rather than deleting valid tokens.
8. Run `npm test`, `npm run ios:sync`, and build/run using the paid signing team.

## Real-device acceptance test

- Enable notifications and accept the iOS permission prompt. Confirm the phone appears under the correct account in `ios_push_devices`.
- Trigger one shared-list notification from Android; verify foreground behavior, then background and locked-phone delivery.
- Tap the alert and confirm the correct household/list opens. Repeat from a fully closed app.
- Verify bill and appointment reminders, sound disabled, quiet-hour deferral, and retries without duplicates.
- Remove list access or leave the household before delivery; the alert must not be sent.
- Turn notifications off, then sign out. Confirm registration removal and that the next account doesn't inherit the previous account's alerts.
- Recheck the passing Android delivery path after deployment.

Unit tests and unsigned compilation do not establish real APNs delivery. The key, entitlement, paid profile, deployed worker, and actual iPhone test are still required.
