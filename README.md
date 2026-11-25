# E³ Inventory

A cafeteria management app for browsing meals, managing inventory, recording sales, placing pre-orders, collecting feedback, and taking online payments. The active runtime is the React/Vite client in `src/AppRuntime.jsx` and the Express/PostgreSQL API in `serverRuntime.js`. TypeScript entry points delegate to these same implementations.

## Local development

Requirements: Node.js 22 and PostgreSQL.

1. Create a PostgreSQL database named `ebd_inventory`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your local database connection string. Use Paystack test credentials for local checkout testing.
3. Install dependencies with `npm ci`.
4. Start the app with `npm run dev`, then open `http://localhost:3000`. To launch through the TypeScript entry point, use `npm run dev:tsx`.

To enable Google sign-in, create a Google OAuth client of type **Web application**. Add `http://localhost:3000/api/auth/google/callback` as an authorized redirect URI and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. On Vercel, set those same variables and register the deployed HTTPS origin followed by `/api/auth/google/callback`. The callback uses `APP_BASE_URL` when provided. New Google accounts join as Buyers, and existing password accounts continue to use their password.

The development menu includes two named dishes with matching photos in each category. The photos are from Wikimedia Commons.

- Breakfast uses [Hausa Koko (Porridge)](https://commons.wikimedia.org/wiki/File:Hausa_Koko_(Porridge).jpg) by Flixtey ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), resized).
- Lunch uses [Jollof Rice Ghana](https://commons.wikimedia.org/wiki/File:Jollof_Rice_Ghana.jpg) by Fquasie ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), resized).
- Snacks use [Kelewele](https://commons.wikimedia.org/wiki/File:Kelewele.jpg) by Mac-Jordan Degadjor, cropped by Tbom824 ([CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)).
- Beverages use [A bottle of Sobolo](https://commons.wikimedia.org/wiki/File:A_bottle_of_Sobolo.png) by Umuhiera ([CC0](https://creativecommons.org/publicdomain/zero/1.0/), resized).
- Desserts use [Nkati Cake 02](https://commons.wikimedia.org/wiki/File:Nkati_Cake_02.jpg) by Jwale2 ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), resized).
- [Waakye](https://commons.wikimedia.org/wiki/File:Ghanaian_Cuisine_06_-_Waakye.jpg) by Quami43, [banku and tilapia](https://commons.wikimedia.org/wiki/File:Banku_and_tilapia1.jpg) by Otuo-Akyampong Boakye, [bofrot](https://commons.wikimedia.org/wiki/File:Puff_puff.jpg) by Edithobayaa1, [mashed kenkey](https://commons.wikimedia.org/wiki/File:Mashed_Kenkey_with_honey_and_ginger.jpg) by Harunaamadu95, and [fresh mango](https://commons.wikimedia.org/wiki/File:FRESH_FRUITS_IN_GHANA.jpg) by Abdul Ganiyu Dasana are all [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and resized.

The development server creates demo accounts and sample meals only when their respective tables are empty:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@ebd.com` | `admin123` |
| Seller | `seller@ebd.com` | `seller123` |
| Buyer | `student@ebd.com` | `student123` |

These credentials are for local development only. Do not expose a development server publicly. Public registration creates Buyer accounts. Administrators can create Seller accounts from the **Sellers** page. Sellers can add, edit, and remove only the foods they created; administrators can manage the full menu.

## Vercel deployment

The Express API is exported from `api/[...path].js` as a Vercel Function so API routes work alongside the Vite client. Vite builds the client into `public/`, which Vercel serves through its CDN. PostgreSQL and uploaded image storage are separate persistent services; Vercel's function filesystem is not persistent.

1. Import `En-Nya-prog/Cafeteria-Management-System` into Vercel and use the repository root as the project root. Keep the build command as `npm run build` and the output directory as `public` (also set in `vercel.json`).
2. Create or connect the hosted PostgreSQL database, then follow **Production security setup** below before setting `DATABASE_URL` in Vercel. Use a separate database for Preview deployments.
3. Create a Vercel Blob store and connect it to the project. This supplies `BLOB_READ_WRITE_TOKEN` for public meal images; without it, image uploads return an explicit configuration error.
4. For this free, non-commercial test deployment, set `PAYSTACK_MODE=test` and use a Paystack **test** `PAYSTACK_SECRET_KEY`. Also set `EBD_ADMIN_EMAIL` and a unique `EBD_ADMIN_PASSWORD`. The app rejects a live key in test mode. Never use this Hobby deployment for real sales or live payments.
5. Set `APP_BASE_URL` to the HTTPS deployment origin if needed; Vercel's `VERCEL_URL` is used as the default.
6. Deploy and confirm `/api/healthz` returns `{"status":"ok"}`. If testing webhooks, configure the Paystack test account webhook to `https://<your-vercel-domain>/api/webhooks/paystack`.
7. Create Seller accounts from the admin UI and add menu items through **Inventory**. Sellers manage only their own items, while administrators can manage the full menu. The menu starts empty; local CSV data and uploaded images are not automatically deployed.
8. This Hobby deployment is for preview/testing only. Campus production requires a suitable paid Vercel plan, a production database plan, live Paystack credentials, backups, webhook checks, session/admin recovery, and a low-value payment/refund rehearsal. Review provider usage limits and pricing before launch.

### Production security setup

1. Rotate any credentials that were ever committed, update deployments using the affected credentials, and coordinate history cleanup with everyone who uses the GitHub repository. Publish the cleaned history only after rotation and review of all branches and tags. Keep real values in the provider dashboards or ignored environment files.
2. In hosted PostgreSQL, create a separate login role for the app with no ownership, elevated privileges, or schema-create access. Give it access only to the cafeteria database. Use the schema-owner connection from a trusted machine to run `npm run migrate:schema` with `DATABASE_MIGRATION_URL` and `DATABASE_RUNTIME_ROLE` set. The command applies the schema and grants the runtime role access to the operational tables. Put only the restricted role's URL in Vercel as `DATABASE_URL`. Use `DATABASE_CA_CERT` when your provider requires a private CA. Run the migration again before deploying future schema changes.
3. Set a stable `STAFF_MFA_KEY` in Vercel. Generate 32 random bytes encoded as 64 hex characters, for example with `node -p "require('node:crypto').randomBytes(32).toString('hex')"` in a private terminal. Store a recovery copy in the team's secret manager apart from database backups. At first sign-in, each Administrator and Seller adds the displayed setup key to an authenticator and enters a six-digit code. Existing unverified staff sessions must sign in again.
4. Configure Google OAuth for the deployed origin. Production accepts verified Google Buyers by default. For a rollout that must continue accepting existing password-only Buyer accounts, set `REQUIRE_VERIFIED_BUYERS=false`.
5. Administrators can review events in the app's Audit Log. Direct access to the `security_audit` table is reserved for authorized database operators. It records price changes, meal deletions, staff account and authenticator changes, and payment status changes. Archive it with managed backups and review events during incident investigations. For a lost staff authenticator, verify the person's identity out of band, then use the schema-owner connection to invalidate their sessions and remove their enrollment so they can enroll again.
6. Schedule managed PostgreSQL backups and rehearse a restore into a separate database before taking real payments. Verify the menu and order records, audit history, and the audit triggers after restoration. Back up uploaded images separately.

Set `TEST_DATABASE_URL` to a local PostgreSQL connection with permission to create a temporary schema to run the database-backed authorization tests with `npm test`.

### New meal announcements

Every existing Buyer account receives an in-app notification when a meal is added or updated. Buyers can opt in to email and/or SMS from **Notifications**; SMS requires an international-format number such as `+233241234567`. Buyers can change their choices at any time. Add these server-only variables to Vercel to enable external delivery:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | Verified sender address, such as `E³ Cafeteria <menu@your-verified-domain>` |
| `HUBTEL_CLIENT_ID` | Hubtel SMS API client ID |
| `HUBTEL_CLIENT_SECRET` | Hubtel SMS API client secret |
| `HUBTEL_SENDER_ID` | Sender ID approved for the Hubtel account |

If a provider is not configured or rejects a message, the meal remains listed and the in-app alert is still created. Failed external deliveries are logged by the API; check the Vercel function logs and provider account before enabling buyer opt-in.

#### Importing `products.csv` and local images

The migration command deduplicates identical meal rows, copies referenced `/uploads/...` files to public Vercel Blob storage, and imports meals without replacing any existing meal IDs. It preserves image URLs that are already absolute URLs. If any meal IDs already exist in PostgreSQL, the command stops before uploading images or importing meals.

1. Confirm the production PostgreSQL database is connected to the Vercel project and the app has deployed successfully.
2. Authenticate and link the repository to the Vercel project with the Vercel CLI. Vercel connects Blob through OIDC; the CLI downloads the short-lived OIDC credentials into the ignored `.env.local` file.
3. Vercel does not allow secret environment variables to be pulled. In Neon, choose the Node.js connection-string option and replace the `DATABASE_URL` placeholder in the ignored local `.env.migrate` file with the complete one-line `postgresql://...` URL. Do not copy it into chat or commit the file.
4. Validate the CSV and image files without making remote changes: `npm run migrate:products -- --check`.
5. Run the read-only database preflight: `npm run migrate:products -- --preflight`. The migration reads the local `.env.migrate` database URL and the Vercel OIDC credentials from `.env.local`. Resolve any existing meal-ID conflicts before continuing.
6. Back up the production PostgreSQL database. When ready to import, run `npm run migrate:products -- --migrate`.
7. After verifying the production menu and images, remove `.env.migrate` with `Remove-Item .env.migrate` and confirm the files are available in the deployed app.

Rate-limit counters are stored in PostgreSQL so they are shared across Vercel Function instances. Enable appropriate Vercel Firewall protections as an additional edge control before public production use.

### Migrating an existing SQLite installation to Vercel

The migration script imports users, meals, sales, pre-orders, feedback, and notifications; it deliberately does not import sessions or payment attempts. Back up the SQLite database and uploaded images, stop writes to the old app, and provision PostgreSQL before deploying.

1. Set `SQLITE_SOURCE_PATH` to the backed-up database file and `DATABASE_URL` to the Vercel PostgreSQL provider's connection string on a trusted migration machine. Keep connection strings in local environment variables; do not commit or share them.
2. Run `node --experimental-sqlite scripts/migrate-sqlite-to-postgres.js`, then reconcile imported/skipped row counts, users, stock, sales totals, and pre-orders before switching traffic.
3. Migrate existing images to Blob separately and update meal image URLs in PostgreSQL. The SQLite import script does not copy image files.
4. Keep the old database and image files untouched until post-cutover checks pass.

## Render deployment (alternative)

The `render.yaml` Blueprint provisions a Render web service, a managed PostgreSQL database, and a persistent disk for uploaded images and the menu CSV. The persistent disk means the web service must run as a **single instance**; scale its instance size rather than adding web instances. PostgreSQL is shared and managed independently.

1. Create the Blueprint in Render and confirm the region, service plan, database plan, and disk size meet your traffic and budget needs. Run the schema migration and configure the restricted runtime database URL, staff MFA key, and Google credentials as described in **Production security setup**.
2. Set `APP_BASE_URL` to the final HTTPS origin, for example `https://cafeteria.example.edu`.
3. Set `PAYSTACK_SECRET_KEY` using Render's secret field. Use the Paystack live secret only after test-mode acceptance checks are complete.
4. Set a unique `EBD_ADMIN_EMAIL` and a strong `EBD_ADMIN_PASSWORD` (10–128 characters). These are required when the production users table is first created.
5. In Paystack, configure the webhook URL as `https://cafeteria.example.edu/api/webhooks/paystack`; verify the live account supports GHS and the checkout channels enabled in `serverRuntime.js`.
6. Confirm the `/api/healthz` check is healthy, create the initial menu and staff accounts, and complete a live low-value payment/refund rehearsal before campus-wide launch.
7. Enable managed database backups and test a restore. Back up uploaded images separately and test image access after deployment.

The server rejects production startup without HTTPS `APP_BASE_URL`, a live Paystack secret, and initial admin credentials when the users table is empty. It does not create demo users or meals in production. Payment confirmation comes from Paystack server-side verification or a signed webhook; the browser callback alone cannot mark an order paid.

### Migrating an existing SQLite installation

The production server now uses PostgreSQL; it does not read or modify an existing SQLite file. The migration script imports users, meals, sales, pre-orders, feedback, and notifications; it deliberately does not import sessions or payment attempts.

1. Make a verified backup of the SQLite database and uploaded images. Stop writes to the old app.
2. Run `npm run migrate:schema` with the schema-owner URL to create the PostgreSQL tables. Keep the web service stopped while importing.
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
