# Supabase Portfolio Storage

Supabase is the server database for StockPulse inventory, transactions, login challenges, user TOTP settings, sessions, and portfolios. The custom email-code/TOTP login remains in Express; Supabase Auth is not used.

## Configure Supabase

1. In the Supabase dashboard, open **Project Settings > API** and copy the Project URL and service-role key.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql) to create the application tables and RPC functions. This migration is safe to rerun.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` for local development, or in the hosting provider's secret manager for deployment.
4. Restart StockPulse.

The service-role key bypasses Supabase row-level security. Keep it server-side and out of frontend files. These portfolio routes use the signed-in StockPulse session's user ID; they do not use Supabase Auth or accept a user ID from the request body.

## Portfolio API

- `GET /api/portfolio` returns the signed-in user's Supabase portfolio entries.
- `POST /api/portfolio` accepts `{ "symbol": "MSFT", "shares": 10 }` and inserts a new Supabase entry for the signed-in user.

All endpoints require the existing StockPulse email-code/TOTP session. Inventory and transactions are filtered by the session user ID. New accounts receive their own copy of the bundled `data/store.json` starter inventory; existing unowned rows are claimed by the configured admin account. Back up and migrate newer local inventory before using an existing database. Supabase RLS is enabled with no client policies; the service-role key stays server-side.