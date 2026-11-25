import { DAILY_MEAL_DAYS } from "./mealAvailability.js";

export async function applyDatabaseSchema(db) {
  await db.exec("SELECT pg_advisory_xact_lock(hashtext(current_schema() || '-cafeteria-schema'))");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      price DOUBLE PRECISION NOT NULL,
      stock INTEGER NOT NULL,
      image_url TEXT,
      available_start TEXT,
      available_end TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      meal_id TEXT,
      quantity INTEGER,
      total_price DOUBLE PRECISION,
      customer_name TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS preorders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      meal_id TEXT,
      quantity INTEGER,
      pickup_time TEXT,
      status TEXT DEFAULT 'Pending',
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      meal_id TEXT,
      rating INTEGER,
      comment TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      message TEXT,
      recipients_count INTEGER,
      channel TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      role TEXT,
      password TEXT
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      meal_id TEXT,
      timestamp TEXT NOT NULL,
      read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      reference TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_kobo INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reserved_until TEXT NOT NULL,
      verified_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_items (
      id BIGSERIAL PRIMARY KEY,
      reference TEXT NOT NULL,
      meal_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      pickup_time TEXT,
      unit_amount INTEGER NOT NULL,
      FOREIGN KEY (reference) REFERENCES payments(reference) ON DELETE CASCADE
    );
  `);

  for (const table of ["sales", "preorders", "feedback"]) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id TEXT`);
  }
  await db.exec("ALTER TABLE sales ADD COLUMN IF NOT EXISTS pickup_time TEXT");
  for (const table of ["sales", "preorders", "payment_items"]) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS pickup_date TEXT`);
  }
  await db.exec(`ALTER TABLE meals ADD COLUMN IF NOT EXISTS available_days TEXT NOT NULL DEFAULT '${DAILY_MEAL_DAYS}'`);
  await db.exec("ALTER TABLE meals ADD COLUMN IF NOT EXISTS item_code BIGINT GENERATED ALWAYS AS IDENTITY");
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS meals_item_code_idx ON meals (item_code)");
  await db.exec(`
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS reference TEXT;
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_status TEXT NOT NULL DEFAULT 'new';
    ALTER TABLE preorders ADD COLUMN IF NOT EXISTS seller_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE preorders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
    ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS related_id TEXT;
    CREATE INDEX IF NOT EXISTS sales_reference_idx ON sales (reference);
    CREATE INDEX IF NOT EXISTS preorders_seller_idx ON preorders (seller_id, timestamp DESC);
  `);
  await db.exec(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_subject TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_subject_idx ON users (google_subject);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS meal_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS meal_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS user_notifications_user_timestamp_idx
      ON user_notifications (user_id, timestamp DESC);
  `);
  await db.exec("ALTER TABLE meals ADD COLUMN IF NOT EXISTS seller_id TEXT REFERENCES users(id) ON DELETE SET NULL");
  await db.exec("ALTER TABLE meals ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available'");
  await db.exec(`
    CREATE INDEX IF NOT EXISTS payments_reservations_idx ON payments (status, reserved_until);
    CREATE INDEX IF NOT EXISTS payment_items_meal_idx ON payment_items (meal_id);
    CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions (expires_at);
    CREATE INDEX IF NOT EXISTS rate_limits_expiration_idx ON rate_limits (reset_at);
    CREATE INDEX IF NOT EXISTS meals_seller_id_idx ON meals (seller_id);
  `);
  await db.exec(`
  CREATE TABLE IF NOT EXISTS seller_order_notification_deliveries (
    reference TEXT NOT NULL REFERENCES payments(reference) ON DELETE CASCADE,
    seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    status TEXT NOT NULL DEFAULT 'sending'
      CHECK (status IN ('sending', 'sent', 'failed')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (reference, seller_id, channel)
  );

    CREATE TABLE IF NOT EXISTS order_assignments (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','accepted','preparing','ready','completed','cancelled')),
      assigned_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(sale_id)
    );
`);
  await db.exec("ALTER TABLE order_assignments ALTER COLUMN seller_id DROP NOT NULL");
  await db.exec(`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS staff_mfa (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_secret TEXT NOT NULL,
      last_counter BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS security_audit (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      actor_id TEXT,
      database_role TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL
    );
    CREATE OR REPLACE VIEW cafeteria_audit_log AS
      SELECT event.id, event.recorded_at, event.actor_id, actor.name AS actor_name,
        event.resource, event.resource_id, event.action, event.details
      FROM security_audit event
      LEFT JOIN users actor ON actor.id = event.actor_id;
    CREATE OR REPLACE FUNCTION record_cafeteria_audit() RETURNS TRIGGER
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $audit$
    DECLARE
      previous JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      current_row JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
      details JSONB := '{}'::jsonb;
      row_id TEXT := COALESCE(current_row->>'id', previous->>'id', current_row->>'reference', previous->>'reference',
        current_row->>'user_id', previous->>'user_id');
    BEGIN
      IF TG_TABLE_NAME = 'meals' THEN
        IF TG_OP = 'UPDATE' AND previous->'price' IS NOT DISTINCT FROM current_row->'price' THEN RETURN NEW; END IF;
        details := jsonb_build_object('previous_price', previous->'price', 'current_price', current_row->'price');
      ELSIF TG_TABLE_NAME = 'payments' THEN
        IF TG_OP = 'UPDATE' AND previous->'status' IS NOT DISTINCT FROM current_row->'status' THEN RETURN NEW; END IF;
        details := jsonb_build_object('previous_status', previous->'status', 'current_status', current_row->'status');
      ELSIF TG_TABLE_NAME = 'users' THEN
        IF COALESCE(current_row->>'role', previous->>'role') NOT IN ('Admin', 'Seller')
           AND COALESCE(previous->>'role', '') NOT IN ('Admin', 'Seller') THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND
           (previous->'name', previous->'email', previous->'phone', previous->'role', previous->'password') IS NOT DISTINCT FROM
           (current_row->'name', current_row->'email', current_row->'phone', current_row->'role', current_row->'password') THEN RETURN NEW; END IF;
        details := jsonb_build_object('previous_role', previous->'role', 'current_role', current_row->'role',
          'password_changed', TG_OP = 'UPDATE' AND previous->'password' IS DISTINCT FROM current_row->'password');
      ELSIF TG_TABLE_NAME = 'staff_mfa' AND TG_OP = 'UPDATE' THEN
        RETURN NEW;
      END IF;
      EXECUTE format('INSERT INTO %I.security_audit (actor_id, database_role, resource, resource_id, action, details) VALUES ($1,$2,$3,$4,$5,$6)', TG_TABLE_SCHEMA)
        USING NULLIF(current_setting('cafeteria.actor_id', true), ''), session_user, TG_TABLE_NAME, row_id, TG_OP, details;
      RETURN NULL;
    END;
    $audit$;
  `);
  for (const table of ["meals", "payments", "users", "staff_mfa"]) {
    await db.exec(`DROP TRIGGER IF EXISTS cafeteria_audit ON ${table};
      CREATE TRIGGER cafeteria_audit AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION record_cafeteria_audit()`);
  }
}
