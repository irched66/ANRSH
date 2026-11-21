# ANRSH DIGITAL — Security Phase 1 Operations and Activation

This branch contains proposed implementation work. It is NOT deployed. The live Worker and D1 database have not been modified.

## Required Cloudflare Worker configuration

Keep all values in Cloudflare Worker Secrets/Variables only. Never commit them or send them in chat.

Secrets:
- `ANRSH_BOOTSTRAP_SECRET`: random secret, at least 32 characters; used once to provision the two national accounts.
- `CARD_SIGNING_SECRET`: random secret, at least 32 characters; signs short-lived card print tokens.
- `FILE_ENCRYPTION_KEY`: exactly 64 hexadecimal characters (32 random bytes); AES-256-GCM key for newly uploaded documents.
- `RESEND_API_KEY`: Resend API key for email OTP and invitations.

Variable:
- `RESEND_FROM`: sender identity verified by Resend.

Existing binding:
- `DB`: the intended D1 database binding.

Email OTP, regional invitations, and member confirmation codes fail closed if Resend is not configured. SMS and automatic WhatsApp Business delivery are not implemented in this branch; do not advertise them as active.

## Required one-time activation order

1. Take and verify an export/backup of the intended D1 database.
2. Review `migrations/2026-11-21-security-phase-1-proposal.sql` against the exact live schema.
3. Apply that additive migration only after explicit approval. This repository branch does not execute it.
4. Configure the secrets and verified sender above in the Worker environment.
5. Deploy the Worker from this branch to a separate staging Worker, not the production Worker.
6. Call `POST /api/auth/bootstrap` once with header `x-bootstrap-secret` and JSON body containing exactly two objects:
   - `{"email":"irched2521@gmail.com","password":"<unique-strong-password>" }`
   - `{"email":"anrsh1994@gmail.com","password":"<different-unique-strong-password>" }`
   The request body is `{"accounts":[...two objects...]}`. Use a trusted local terminal or secret manager; never put real passwords in GitHub files, browser URLs, screenshots, or ChatGPT.
7. Remove/rotate `ANRSH_BOOTSTRAP_SECRET` after successful provisioning. Bootstrap will also refuse to run once any admin account exists.
8. Test login for each national account: email + password, then the six-digit email OTP (10-minute validity).
9. Issue regional invitations from the national account. Each regional president accepts the invitation, chooses a password (minimum 14 characters), then waits for national approval.
10. Configure the Worker Cron Trigger to run at `0 5 1 1,4,7,10 *` (05:00 UTC on the first day of each quarter). The scheduled handler generates the previous quarter's office reports and emails the two national addresses.
11. Run all staging tests before considering production.

## Payment and card workflow

- New registrations create a pending 500 DZD payment review record and store newly uploaded documents encrypted with AES-256-GCM.
- A reviewer must inspect the receipt and independently confirm receipt of exactly 500 DZD before marking the payment verified.
- The allocation ledger records 100 DZD national (20%) and 400 DZD regional (80%) per verified payment.
- Only after payment verification can the office issue the member confirmation OTP by email. The member OTP expires in 10 minutes and is consumed once.
- After OTP verification, the service issues a random QR token; only its SHA-256 hash is stored. Public QR verification checks current membership and current-year verified payment.
- Permanent deletion of member records is disabled. Follow an approved retention policy instead.

## Important existing-data limitation

Older member files in `members.files` were stored as Base64, which is encoding, not encryption. The new code can read those legacy files but does not retroactively encrypt them. Before production activation, plan and test a separate in-place re-encryption of existing documents with a verified backup and key-recovery procedure. Do not lose or rotate the encryption key after new uploads exist.

## Verification status

- GitHub branch changes: committed to `security-phase-1` only.
- Production `main`: unchanged.
- Live D1 migration: not applied.
- Cloudflare secrets: not configured or inspected.
- Worker deployment: not performed.
- GitHub Pages deployment: not performed.
- End-to-end browser tests against a staging Worker/D1: pending.
- CI static checks: workflow added; inspect the latest run before relying on it.

## Rollback

Rollback means redeploying the previously verified Worker version and restoring a database backup only if necessary. Do not drop the new tables or delete member records as a routine rollback step.
