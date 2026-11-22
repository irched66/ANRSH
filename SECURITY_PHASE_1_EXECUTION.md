# ANRSH DIGITAL — Security Phase 1: implementation audit

Audit date: 2026-11-22
Target branch: `security-phase-1`
Production safety: `main`, live D1, deployed Worker and Pages have not been changed by this audit.

## Executive status

**Not approved for production handover yet.** The development branch now contains substantial implementation for all seven work packages, but implementation presence is not the same as verified operation. No isolated Cloudflare test environment, provider secrets, live mail delivery, production migration, or end-to-end acceptance run was available in this review.

A concrete reliability fix was committed during this audit: regional invitation consumption and inactive account creation now run in one D1 batch, so a failed account insert does not burn the invitation token.

## Work package status

| # | Area | Code observed on development branch | Remaining release gate |
|---|---|---|---|
| 1 | National admin login | One-time two-account bootstrap; PBKDF2-SHA-256 password derivation; email OTP with 10-minute expiry; hashed server-side sessions; logout/revocation; failed-password lockout. | Provision the two national identities only through the protected bootstrap procedure; verify Resend sender/secrets and test both identities, OTP expiry, replay, lockout and session revocation in an isolated environment. D1 currently has zero admin users per the last owner-supplied read-only check. |
| 2 | Regional accounts | National-only invitations; 72-hour single-use hashed invitation; password creation; inactive account pending national approval; national activation route and UI. | Test invitation delivery, expiry, replay, duplicate email, inactive state and activation. Confirm every president's unique official email/phone and bureau record. |
| 3 | Role and bureau isolation | Server-side bearer session lookup; national vs bureau-scoped list/document/payment/report/office/wilaya operations; active-office and active-wilaya checks; global unique wilaya assignment index. | Exercise negative authorization tests for every route with two regional accounts and national account. Confirm the 69 active wilaya records and resolve any incorrect assignments through an audited workflow. |
| 4 | Personal documents | New uploads use AES-256-GCM with a server-side key; private authenticated document retrieval; bureau scope; no Base64 files in list output; document access audit. | Legacy Base64 documents remain unencrypted. Verify encryption key configuration, backup/recovery, size/type checks, access controls and migration strategy before handling real identity documents. Do not claim legacy documents are encrypted. |
| 5 | 500 DZD payment | Payment ledger records 500 DZD; manual authorized review; 100 DZD national / 400 DZD regional allocation; duplicate payment-per-member/year constraint; audit entries. | Validate migration against a disposable copy of the schema; test pending/verified/rejected flows, concurrent reviews, reconciliation and real receipt checks. A file upload alone is not proof that money was received. |
| 6 | Membership card / QR | Random 256-bit QR verification token stored as a hash; public verification checks active card, unlocked member and verified current-year 500 DZD payment; short-lived signed print token also checks current membership/payment. | Verify actual HTML card printing/download calls the correct Worker checks; test expired/revoked/renewed cards and ensure no card can be issued before verified payment and approval. |
| 7 | Reports / notifications / release | Bureau-scoped quarterly report generation and storage; email notification paths for selected events; frontend report submission/history; notification log. | Scheduled-handler code exists to generate the previous quarter's reports and email the two national addresses, and to send annual renewal reminders. The Cloudflare Cron Trigger still must be configured and tested in staging. SMS/automatic WhatsApp sending is not integrated. Verify idempotency, delivery failures and retry behavior. Test Arabic/French/English and mobile layout. |

## Confirmed technical observations

- Frontend `index.html` calls the D1 Worker at `https://anrsh-ap-dev.irched2521.workers.dev` and contains the password + OTP login and invitation acceptance UI.
- Worker routes include registration, member OTP verification, QR verification, print-check, authentication, invitations, office profile, wilaya assignments, payment review and quarterly report generation.
- New member submission creates a pending 500 DZD payment record and requires the configured core documents. Payment must still be manually verified by an authorized reviewer.
- The Worker requires configuration including `FILE_ENCRYPTION_KEY`, `CARD_SIGNING_SECRET`, `ANRSH_BOOTSTRAP_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, and D1 binding `DB`. Presence and correctness of production values were not verified here. Never commit or send their values in chat.
- The reviewed SQL file `migrations/2026-11-21-security-phase-1-proposal.sql` is a proposal only. It creates payment ledger/allocation, card-token, quarterly-report and notification-log tables. It has not been executed against live D1.
- Static/schema check scripts and a GitHub Actions workflow exist: `tests/check-javascript.mjs`, `tests/check-migration.py`, and `.github/workflows/security-phase-1-checks.yml`. The workflow is configured for pushes to `security-phase-1` and PRs to `main`. No workflow run result was available for the latest audit commit; these checks have not been certified as passed.
- No Worker or Pages deployment was performed.

## Changes made during this audit

- `ANRSH-worker-counter.js`: made regional invitation acceptance atomic by batching invitation consumption, inactive admin-user insertion and password-credential insertion. This avoids consuming a valid invitation if account creation fails.
- Commit: `1e7d69bf0d9b77d9e0aa454b61efa31758301b4c`.

## Release checklist — must pass before handover

1. Create an isolated test D1 database and test Worker; apply the reviewed migration there only.
2. Configure test-only secrets and a verified test email sender. Do not use real member documents for tests.
3. Run the existing static JavaScript and SQLite migration checks in GitHub Actions, then add/execute endpoint, schema-compatibility, role-isolation, OTP, invitation, payment, document-encryption, QR, scheduled-report and frontend end-to-end tests.
4. Confirm 69 active wilayas, 11 regional offices, valid bureau mappings, and uniqueness of wilaya assignments.
5. Confirm the actual deployment origin is in the Worker CORS allow-list.
6. Test the complete member journey on Android: application, required files, payment receipt review, OTP, QR verification, card printing and renewal.
7. Test regional and national admin journeys separately, including negative cross-bureau access attempts.
8. Review and approve the D1 migration; then obtain separate explicit approval before applying it to production.
9. Provision the two national accounts through the one-time secure bootstrap outside source control and chat.
10. Obtain separate explicit approval before deploying the Worker and Pages frontend.
11. Produce the final handover pack: release commit SHA, migration version, deployment endpoints, test report, admin guide, member guide and rollback/backup procedure.

## Handover decision

**Current decision: development review only — not production-ready / not certified.**

The seven areas have code in place to varying degrees, but the remaining release gates above are real blockers. In particular, no test database or provider configuration was available, legacy document encryption is unresolved, and automated quarterly delivery plus SMS/WhatsApp are not implemented. Do not invite retirees to upload personal documents or announce public launch until the release gates are passed.
