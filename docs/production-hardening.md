Production hardening steps that must be applied alongside the app:

1. Run [security-events.sql](/Users/wksadmin/FMDQ-Auctions/docs/security-events.sql) in every Supabase environment.
2. Run [supabase-hardening.sql](/Users/wksadmin/FMDQ-Auctions/docs/supabase-hardening.sql) to clear the mutable `search_path` warning.
3. In Supabase Auth, enable leaked password protection.
4. Set these environment variables in production:
   - `MALWARE_SCAN_MODE=command`
   - `MALWARE_SCAN_COMMAND=...scanner command...`
   - `OPS_ALERT_WEBHOOK_URL=...`
   - `IMAGE_ACCESS_POLICY=bidder_visible` or stricter
   - `NOTIFICATION_WORKER_MODE=api` for the API deployment
5. Run the notification worker separately with:
   - `npm run dev:worker` in development
   - `NOTIFICATION_WORKER_MODE=worker` in production
6. Review retention settings as needed:
   - `TEMP_UPLOAD_RETENTION_HOURS`
   - `OUTBOX_RETENTION_DAYS`
   - `DEAD_LETTER_RETENTION_DAYS`
   - `QUARANTINE_RETENTION_DAYS`
