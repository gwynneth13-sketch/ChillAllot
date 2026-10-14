# Tested iPhone checkpoint — October 13, 2026

## Source and build

- Base: `v1-bill-reminders`, commit `7f61f886de36a7f00454328673444a46457701a3`.
- Capacitor core, iOS, and CLI: 8.5.3.
- App ID: `com.gwynneth13.chillallot`; version 1.0, build 1; minimum iOS 15.
- Built using Xcode 27.0, Node 24.21.0, npm 11.19.0, and Vite 8.3.1.
- Tested on an iPhone 16 Pro Max with iOS 26.7.1.
- Signing currently uses the owner's Personal Team. Other developers must select their own team in Xcode.

## Local configuration

Create `.env.local` from `.env.example` using the existing backend's public URL and publishable key. The working Mac already has this file. It is intentionally ignored by Git; never add a service-role key to the frontend.

Generated web assets, Xcode user state, and build output are ignored. Recreate web assets before building:

```sh
npm ci
npm test
npm run ios:sync
npm run ios:open
```

Select the connected, unlocked iPhone in Xcode and Run. Developer Mode and trust for the developer certificate are required. Free Personal Team provisioning expires after seven days; rebuild/reinstall as needed.

## Changes and verified behavior

- Added the Capacitor configuration and native iOS project.
- Mobile form controls use 16px text to avoid focus zoom.
- Viewport and safe-area spacing keep controls below the status area and above the home indicator.
- Popups follow VisualViewport dimensions and offsets while the keyboard is open.
- Focused popup fields are brought into view by scrolling the dialog.
- Dialogs scroll vertically without horizontal drift.
- 48 automated tests passed, including viewport resize, offset, fallback, and cleanup checks.
- User verified sign-in, household loading, another account joining, zoom correction, top-button access, and popup scrolling with the keyboard open.
- User reports Android sharing and notifications now pass. The Android source/build was not inspected in this Mac session.

## Next iPhone milestone

Native push notifications are not implemented in this checkpoint. The current notification transport is Web Push; the in-app inbox is implemented separately. Plan native device registration, permissions, APNs delivery, token lifecycle on sign-out, foreground presentation, and notification-tap routing. Confirm Apple Developer Program membership before enabling the required push capability.

Test delivery with the phone locked and the app closed, quiet hours, recipient/list permissions, and tapping reminders to open the correct item. Preserve the passing Android notification path.

## Remaining release work

- Native invitation links currently use the app origin (`capacitor://localhost`); replace with an appropriate public HTTPS invitation URL and implement/test native link handling.
- The supplied Vercel branch preview is protected by Vercel login. Pasting a complete invitation link into the installed app's Join household field extracts its code without opening that website.
- Confirm email-verification and password-reset links return to the intended app/web flow.
- Prepare TestFlight and release requirements after the native notification milestone.
