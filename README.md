# EBD Inventory

A cafeteria management app for browsing meals, managing inventory, recording sales, placing pre-orders, collecting feedback, and taking online payments. The active runtime is the React/Vite client in `src/App.jsx` and the Express/PostgreSQL API in `server.js`.

## Local development

Requirements: Node.js 22 and PostgreSQL.

1. Create a PostgreSQL database named `ebd_inventory`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your local database connection string. Use Paystack test credentials for local checkout testing.
3. Install dependencies with `npm ci`.
4. Start the app with `npm run dev`, then open `http://localhost:3000`.

The development server creates demo accounts and sample meals only when their respective tables are empty:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@ebd.com` | `admin123` |
| Seller | `seller@ebd.com` | `seller123` |
| Buyer | `student@ebd.com` | `student123` |

These credentials are for local development only. Do not expose a development server publicly. Public registration creates Buyer accounts; assign staff roles only through trusted database administration.

## Render deployment

The `render.yaml` Blueprint provisions a Render web service, a managed PostgreSQL database, and a persistent disk for uploaded images and the menu CSV. The persistent disk means the web service must run as a **single instance**; scale its instance size rather than adding web instances. PostgreSQL is shared and managed independently.

1. Create the Blueprint in Render and confirm the region, service plan, database plan, and disk size meet your traffic and budget needs.
2. Set `APP_BASE_URL` to the final HTTPS origin, for example `https://cafeteria.example.edu`.
3. Set `PAYSTACK_SECRET_KEY` using Render's secret field. Use the Paystack live secret only after test-mode acceptance checks are complete.
4. Set a unique `EBD_ADMIN_EMAIL` and a strong `EBD_ADMIN_PASSWORD` (10–128 characters). These are required when the production users table is first created.
5. In Paystack, configure the webhook URL as `https://cafeteria.example.edu/api/webhooks/paystack`; verify the live account supports GHS and the checkout channels enabled in `server.js`.
6. Confirm the `/api/healthz` check is healthy, create the initial menu and staff accounts, and complete a live low-value payment/refund rehearsal before campus-wide launch.
7. Enable managed database backups and test a restore. Back up uploaded images separately and test image access after deployment.

The server rejects production startup without HTTPS `APP_BASE_URL`, a live Paystack secret, and initial admin credentials when the users table is empty. It does not create demo users or meals in production. Payment confirmation comes from Paystack server-side verification or a signed webhook; the browser callback alone cannot mark an order paid.

### Migrating an existing SQLite installation

The production server now uses PostgreSQL; it does not read or modify an existing SQLite file. The migration script imports users, meals, sales, pre-orders, feedback, and notifications; it deliberately does not import sessions or payment attempts.

1. Make a verified backup of the SQLite database and uploaded images. Stop writes to the old app.
2. Deploy once to Render with the production admin secrets so PostgreSQL tables are created. Stop the web service before importing.
3. Temporarily allowlist the trusted migration machine's IP in the Render database network settings. From that machine with Node.js 22, set `SQLITE_SOURCE_PATH` to the backed-up database file and `DATABASE_URL` to the Render database's external connection string. Keep the URL in an environment variable; do not save or share it.
4. Run `node --experimental-sqlite scripts/migrate-sqlite-to-postgres.js`. Review imported/skipped row counts, then reconcile users, stock, sales totals, and pre-orders before resuming the service.
5. Remove the temporary database IP allowlist entry. Copy existing uploaded images to the Render disk's `/var/data/uploads` directory and verify the referenced images load. Keep the original database and images untouched until post-cutover checks pass.

Rows that conflict with an existing PostgreSQL ID or email are skipped and counted. Resolve skipped rows explicitly before relying on migrated data. Do not point `DATABASE_URL` at a SQLite path.

### Operational notes

- Uploaded images and the CSV export live on the Render disk at `/var/data`. The disk is not replicated across instances.
- Payment reservations expire after 30 minutes. Successful payments received after expiry or when stock cannot be fulfilled are flagged for staff review rather than silently discarded.
- Configure and periodically test PostgreSQL backups, recovery, Paystack webhook delivery, admin access recovery, and application logs.
- Production sessions use secure, HTTP-only cookies. HTTPS is required.

## Checks

- `npm test` — payment/pricing and webhook helper tests.
- `npm run lint` — TypeScript checking for configured TypeScript files.
- `npm run build` — production frontend build.
