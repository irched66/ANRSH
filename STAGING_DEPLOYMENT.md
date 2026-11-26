# ANRSH DIGITAL — Staging deployment only

This configuration is isolated from the production Worker and production D1 database.

## 1. Confirm the target database

The staging configuration targets D1 database `anrsh-staging` with ID
`00dc7c78-80f8-48db-8b4d-7a56d34dea43`.

In Cloudflare Dashboard, verify that this exact database exists and contains the expected staging schema before applying migrations. Do not substitute `anrsh`, `anrsh-ap`, or another production database.

## 2. Deploy the staging Worker

From the repository root, with Wrangler authenticated to the intended Cloudflare account:

```sh
npx wrangler deploy --config wrangler.staging.toml
```

Copy the exact Worker URL printed by Wrangler. Do not guess the URL.

## 3. Configure secrets on this Worker only

```sh
npx wrangler secret put ADMIN_API_KEY --config wrangler.staging.toml
npx wrangler secret put TEXTBEE_API_KEY --config wrangler.staging.toml
```

Use a newly generated random `ADMIN_API_KEY` of at least 32 characters. Do not commit secrets to GitHub or place them in `assets/anrsh-config.js`.

SMS sending also depends on the TextBee device being online, the correct device ID in the Worker, Android SMS permission, and a working SIM. An accepted provider request is not proof of handset delivery. Email is optional and requires separately configured Resend credentials and a verified sender.

## 4. Apply database migrations cautiously

The Worker expects the D1 schema already to be present. First inspect the staging database tables and migration history. Apply only migrations that are missing from staging. Do not blindly replay the full migrations directory if equivalent tables were created manually.

Migration `007_central_membership_collection.sql` renames the former 20/80 finance ledger to `anrsh_membership_finance_legacy_006` and creates a new 100/0 ledger. It preserves the old ledger for audit. Apply it only after confirming that migration 006 exists in this staging database and after taking a staging backup.

Example command when the migration history is confirmed:

```sh
npx wrangler d1 execute anrsh-staging --remote --config wrangler.staging.toml --file=migrations/007_central_membership_collection.sql
```

Do not run this against a production database.

## 5. Connect the frontend to the deployed staging Worker

Edit `assets/anrsh-config.js` and set `window.ANRSH_API_BASE_OVERRIDE` to the exact URL copied from Wrangler. This file must contain only the public Worker URL, never API keys.

The frontend intentionally has no fallback to the old `anrsh-ap-dev` endpoint. Until the staging URL is configured, API requests fail closed.

## 6. Verify before using real data

Check these read-only endpoints first:

- `/api/health` — must report `environment: "staging"`, `database: "connected"`, 69 active wilayas and 11 active offices (if the staging seed is current).
- `/api/wilayas`
- `/api/offices`

Then use fictitious test data only to test application submission, national-office approval, SMS OTP, OTP verification, and card print validation. The member OTP expires after 5 minutes; the print token expires after 15 minutes and is bound to the request reference.

The current Worker stores private files in D1 (maximum 1 MiB total per request) because R2 is not configured. File routes require an authenticated National Office key or a scoped regional-office session. Do not treat this as a production document-storage approval.

## Production protection

No production Worker or production D1 database should be deployed, migrated, or modified as part of this staging procedure. Production handover requires a separate review and explicit approval.
