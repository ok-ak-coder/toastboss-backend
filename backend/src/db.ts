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
      boss_score INTEGER NOT NULL DEFAULT 100,
      setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
      password TEXT,
      notification_preferences JSONB NOT NULL DEFAULT '{"emailReminders":true,"swapAlerts":true}'::jsonb
    );
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
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (club_id, member_email)
    );
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
};
