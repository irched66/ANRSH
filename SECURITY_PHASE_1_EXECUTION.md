# ANRSH DIGITAL — Security Phase 1 Execution Plan

Status: design baseline only; implementation and verification are NOT complete.
Target branch: security-phase-1
Production safety: no changes to main, no D1 writes, no Worker deployment, no Pages deployment.

## Confirmed D1 baseline (read-only checks supplied by the project owner)
- admin_users: 0 rows
- admin_credentials: 0 rows
- admin_otps: 0 rows
- admin_sessions: 0 rows
- admin_invitations: 0 rows

The tables exist, but no administrative identities or credentials have been provisioned.

## Work packages

### 1. National-office authentication
- Two separate national identities: irched2521@gmail.com and anrsh1994@gmail.com.
- Passwords must be individually salted and derived with PBKDF2-SHA-256 (or a reviewed stronger WebCrypto-compatible KDF).
- No passwords, bootstrap tokens, or OTP values in source control, SQL migrations, logs, or chat.
- Initial provisioning must be one-time, authenticated, and fail closed once the first two national accounts exist.
- Each account must require a second factor at login.

### 2. Regional-office accounts and invitations
- Regional accounts are created only through a national-office invitation and subsequent approval.
- Unique administrative email and dedicated phone per regional president.
- Invitations are single-use, hashed at rest, and expire.
- The regional account remains inactive until approved.

### 3. Role and bureau isolation
- Every authenticated request resolves its actor from a hashed server-side session token.
- National role may administer all bureaus.
- Regional role is restricted to its own bureau; never trust a bureau supplied by the browser.
- List, document, approval, office profile, wilaya assignment, and report routes must all enforce the same scope.
- Preserve unique wilaya assignment and national oversight.

### 4. Personal-document protection
- Remove the shared ADMIN_API_KEY model from all administrative routes.
- Require authenticated, role-scoped access for every document read.
- Keep documents private; do not return Base64 document contents in list responses.
- Add audit events for sensitive document access.
- Review encryption-at-rest/storage architecture before claiming documents are encrypted. Base64 is encoding, not encryption.

### 5. Payment validation (500 DZD)
- A payment record must capture amount, currency, method, receipt reference, reviewer, timestamps, and status.
- Approval must require an exact 500 DZD amount and an authorized reviewer.
- Do not infer successful payment from an uploaded receipt alone.
- Financial split: 20% national office / 80% regional office, with auditable calculations and reconciliation.
- Do not invent bank/postal details or payment provider integrations.

### 6. Membership card and QR verification
- QR must contain an opaque, non-guessable verification identifier or signed token, not the public request reference alone.
- Verification must query current membership status and validity in D1; a valid signature alone is insufficient.
- Card issuance must require verified payment and national/authorized approval.
- Print/download authorization must be short-lived and revocable.

### 7. Reports, notifications, and release verification
- Quarterly reports must be generated from auditable payment and membership records, scoped by bureau.
- Notifications must report approval/rejection/renewal without exposing sensitive documents or OTPs.
- Email delivery requires a verified provider configuration; SMS requires a selected provider and secret configuration.
- Test Arabic/French UI, mobile layout, 69 wilayas, duplicate assignment prevention, authorization boundaries, rate limits, expiry, revocation, and failure cases.

## Release gates
1. Implement backend authentication and authorization before changing the admin UI.
2. Add any required D1 migration as a reviewed SQL file only; never run it against live D1 from this branch.
3. Add/execute automated tests against an isolated test database and test Worker environment.
4. Verify all existing public registration and member flows remain compatible.
5. Review the complete diff and migration with the project owner.
6. Obtain separate explicit approval before applying D1 migrations or deploying either Worker or Pages.

## Known blockers to resolve during implementation
- The current Worker uses one shared ADMIN_API_KEY for all admin list, document, approve, and delete routes.
- The current HTML frontend contains the shared-key login UI and must be migrated with the backend.
- Existing OTP for member approval is 24 hours and is returned to the browser; this must be redesigned.
- Current print token verification does not check live membership/payment status.
- Current Worker has no implemented admin login/session/invitation endpoints.
- Current D1 schema supplied so far does not include dedicated payment ledger or quarterly report tables.
- SMS provider is not configured in the inspected code. Provider selection/configuration must be handled without committing secrets.
- No live Worker, D1 data, secrets, or deployment environment has been tested from this workspace.

This document records scope and release gates; it does not certify that any work package is implemented or secure.
