# ANRSH DIGITAL — PWA installation preparation

This branch is isolated from `main`. It is not published and does not change the production deployment.

## Changes
- Updated the web app manifest for standalone installation.
- Versioned the service-worker cache.
- Removed references to missing PNG icons from the precache list.
- Restricted offline caching to the known static app files; API, authentication, and member-data requests are not cached.
- Kept the existing install button and service-worker registration in the application shell.

## Install on Android after an approved HTTPS deployment
1. Open the platform URL in Google Chrome.
2. Open the ⋮ menu.
3. Choose **Install app** or **Add to Home screen**.
4. Confirm. The ANRSH shortcut/app will appear on the phone.

## Required before production release
- Audit Supabase RLS and every Worker/API route.
- Ensure the release uses the approved backend only and does not expose member documents or personal data.
- Test registration, file upload, approval, payment verification, notifications, and QR validation in an isolated test environment.
- Verify the manifest, icons, HTTPS, and service worker on the deployed origin.
- Obtain National Office approval before public registration or real payments are enabled.

These PWA changes alone do not certify the platform's business workflows or authorize public launch.
