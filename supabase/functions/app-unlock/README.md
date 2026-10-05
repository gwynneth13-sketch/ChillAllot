# App unlock — deployment and test gate

Local implementation only; do not claim physical-device support until tested.

1. Apply supabase/app-unlock-setup.sql (credentials and challenges are inaccessible to anonymous and authenticated clients; service role only).
2. Deploy app-unlock with Supabase Edge Functions. Validate the runtime supports the pinned SimpleWebAuthn 14.0.0 package (requires Deno 2.4+). The function validates the signed-in account with auth.getUser and does not rely on user-editable metadata.
3. Configure APP_UNLOCK_ORIGIN to the exact HTTPS preview origin, without trailing slash. RP ID is its hostname. No wildcard origins. Keep SUPABASE_SERVICE_ROLE_KEY server-side only.
4. A passkey registered at a preview hostname is scoped to that hostname and will require new setup on the live hostname. Do not silently switch RP IDs.
5. Test on Samsung Android Brave through that HTTPS origin: registration, cancellation, failed verification, lock timeout, foreground stays unlocked, preserving form input, fresh page load locks, disabled option, sign out/recovery. Do not test using a downloaded HTML file.

Build, SQL access/challenge tests, browser state tests, and real WebAuthn signature tests using a Chromium virtual authenticator passed locally. The complete deployed Edge Function and physical Brave/Samsung test have not run.

This is a browser privacy lock, not encryption of cached household data or a replacement for server authorization. Settings are per-account and per-browser. The signed-in Supabase session stays active while the UI is locked. No authenticated database policies rely on the client lock flag. Device credential verification uses an expiring single-use server challenge and required user verification.

Pending: deployed-function integration tests, physical phone test, and exact-item notification routing (notification delivery remains separate work).

Account-level join/loading/recovery/hidden-household views now share the same persistent unlock boundary. Sign out confirmation and cancellation are implemented, including the locked-screen escape route. Browser tests cover preserving an unfinished join code across a lock and canceling sign out.
