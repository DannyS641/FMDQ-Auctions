Run these SQL migrations in order in the Supabase SQL Editor, or apply them automatically with:

```bash
npm run db:migrate
```

`npm run db:migrate` requires `SUPABASE_DB_URL` and a local `psql` client.

After each migration, run:

```sql
notify pgrst, 'reload schema';
```

Applied versions are tracked in `public.schema_migrations`, and the backend refuses to start if required versions are missing.

Current migrations:
- `0001_bid_queue_hardening.sql`
- `0002_metadata_rls_hardening.sql`
- `0003_notification_queue_claim_columns.sql`
