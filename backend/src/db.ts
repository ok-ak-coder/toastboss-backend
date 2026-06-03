import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? {
        rejectUnauthorized: false,
      }
    : false,
});

export const runMigrations = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      email TEXT PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      bio TEXT,
      profile_image_url TEXT,
      boss_score INTEGER NOT NULL DEFAULT 100,
      setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
      password TEXT,
      notification_preferences JSONB NOT NULL DEFAULT '{"emailReminders":true,"swapAlerts":true}'::jsonb
    );
  `);

  await pool.query(`
    ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS bio TEXT;
  `);

  await pool.query(`
    ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      agenda JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (account_email, club_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roster (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      member_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone_number TEXT,
      current_position TEXT,
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      eligible_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (club_id, member_email)
    );
  `);

  await pool.query(`
    ALTER TABLE roster
    ADD COLUMN IF NOT EXISTS eligible_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await pool.query(`
    ALTER TABLE roster
    ADD COLUMN IF NOT EXISTS phone_number TEXT;
  `);

  await pool.query(`
    ALTER TABLE roster
    ADD COLUMN IF NOT EXISTS current_position TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_callouts (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      meeting_date TEXT NOT NULL,
      member_email TEXT NOT NULL,
      called_out BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (club_id, meeting_date, member_email)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_availability_defaults (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      default_status TEXT NOT NULL DEFAULT 'always',
      PRIMARY KEY (club_id, member_email)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_availability_overrides (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (club_id, member_email, meeting_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_attendance_verifications (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      meeting_date TEXT NOT NULL,
      role TEXT NOT NULL,
      member_email TEXT,
      status TEXT NOT NULL,
      points_delta INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (club_id, meeting_date, role)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_schedule_locks (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      meeting_date TEXT NOT NULL,
      locked_by_email TEXT NOT NULL,
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (club_id, meeting_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_schedule_assignments (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      meeting_date TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      slot_order INTEGER NOT NULL DEFAULT 0,
      role_label TEXT NOT NULL,
      role_key TEXT,
      member_id TEXT,
      member_email TEXT,
      member_name TEXT,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      reason TEXT,
      PRIMARY KEY (club_id, meeting_date, slot_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_role_confirmations (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      meeting_date TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      member_email TEXT NOT NULL,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (club_id, meeting_date, slot_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_flags (
      flag_key TEXT PRIMARY KEY,
      flag_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS speech_details (
      club_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      speech_title TEXT,
      speech_time TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (club_id, meeting_date, slot_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_themes (
      club_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      theme TEXT NOT NULL,
      set_by_email TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (club_id, meeting_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_offer_tokens (
      token_hash TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      role_label TEXT NOT NULL,
      offered_by_email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_by_email TEXT,
      accepted_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_verification_tokens (
      token_hash TEXT PRIMARY KEY,
      account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    );
  `);
};
