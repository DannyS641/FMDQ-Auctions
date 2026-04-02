# Backup And Restore

This project uses Supabase as the system of record and stores uploaded files on the application server under `server/uploads/`.

## Backup Scope

- Supabase tables:
  - `users`
  - `roles`
  - `user_roles`
  - `sessions`
  - `email_verification_tokens`
  - `items`
  - `item_files`
  - `bids`
  - `audits`
  - `notification_queue`
  - `categories`
- Server file storage:
  - `server/uploads/images`
  - `server/uploads/documents`

## Recommended Schedule

- Supabase database backup: daily
- Uploads backup: daily
- Keep at least:
  - 7 daily backups
  - 4 weekly backups
  - 3 monthly backups

## Restore Order

1. Restore the Supabase database backup.
2. Restore `server/uploads`.
3. Restart the backend application.
4. Verify:
   - sign in works
   - items load
   - document downloads work
   - operations desk loads

## Operational Checks

After restore, validate:

- `/api/health`
- account sign-in
- item details page
- bidding page
- operations desk
- password reset flow

## Notes

- Uploaded documents are tied to `item_files.url`, so restoring database rows without restoring `server/uploads` will leave broken file links.
- Sessions can be safely cleared after restore if needed by deleting rows from `sessions`.
