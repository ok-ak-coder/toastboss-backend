import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import { generateSchedule, explainAssignment, suggestSwapCandidates } from './engine';
import { pool, runMigrations } from './db';
import type {
  AgendaItem,
  AgendaEvaluatorMode,
  AttendanceVerificationRecord,
  AvailabilityStatus,
  ClubMembership,
  ClubMemberRecord,
  Meeting,
  MeetingRoleSlot,
  Member,
  RoleKey,
  UserAccount,
  UserRole,
} from './types';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const IDTT_CLUB_ID = 'idtt';
const IDTT_CLUB_NAME = "I'll Drink to That Toastmasters";
const IDTT_MEETING_WEEKDAY = 4;
const CLUB_TIME_ZONE = 'America/Los_Angeles';
const MEMBER_PORTAL_URL = (process.env.MEMBER_PORTAL_URL ?? 'https://idtttoastmasters.com/member-portal/').trim();
const PASSWORD_RESET_FROM_EMAIL = (process.env.PASSWORD_RESET_FROM_EMAIL ?? 'admin@idtttoastmasters.com').trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY ?? '').trim();
const BUNDLED_ROSTER_PATH = path.resolve(__dirname, '../src/data/Club-Membership20260522.csv');
const BUNDLED_HISTORY_PATH = path.resolve(__dirname, '../src/data/idtt-schedule-history.json');
const FIXED_ADMIN_EMAILS = new Set(['nolavaavalon@gmail.com']);
const FIXED_ADMIN_NAMES = new Set(['avalon korringa']);
const BCRYPT_HASH_PREFIXES = ['$2a$', '$2b$', '$2y$'];
const MEMBER_DEFAULT_ACCOUNT_PASSWORDS: Record<string, { password: string; setupComplete: boolean }> = {
  'butlerlife444@gmail.com': {
    password: 'BBtoast!',
    setupComplete: true,
  },
};

type ClubActivityType =
  | 'portalLogin'
  | 'accountSetup'
  | 'availabilityUpdated'
  | 'roleConfirmed'
  | 'roleConfirmationRemoved'
  | 'roleOfferCreated'
  | 'roleOfferAccepted';

type ClubActivityMetadata = Record<string, unknown>;

type ClubActivityEntry = {
  id: number;
  clubId: string;
  memberEmail: string;
  memberName: string;
  actorEmail: string;
  actorName: string;
  activityType: ClubActivityType;
  summary: string;
  metadata: ClubActivityMetadata;
  createdAt: string;
};

type ClubActivityMemberStatus = {
  memberEmail: string;
  memberName: string;
  isActive: boolean;
  lastLoginAt: string | null;
};

const sampleMembers: Member[] = [
  {
    id: 'm1',
    name: 'Avery Silva',
    email: 'avery@example.com',
    clubId: IDTT_CLUB_ID,
    bossScore: 108,
    eligibleRoles: ['toastmaster', 'improvmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator', 'timer', 'grammarians', 'educationalMoment'],
    availability: {},
    preferredRoles: ['toastmaster', 'speaker', 'timer'],
  },
  {
    id: 'm2',
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    clubId: IDTT_CLUB_ID,
    bossScore: 92,
    eligibleRoles: ['toastmaster', 'improvmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator', 'timer', 'grammarians', 'educationalMoment'],
    availability: { '2026-05-08': 'tentative' },
    preferredRoles: ['grammarians', 'educationalMoment', 'timer'],
  },
  {
    id: 'm3',
    name: 'Taylor Park',
    email: 'taylor@example.com',
    clubId: IDTT_CLUB_ID,
    bossScore: 110,
    eligibleRoles: ['toastmaster', 'improvmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator', 'timer', 'grammarians', 'educationalMoment'],
    availability: {},
    preferredRoles: ['speaker', 'generalEvaluator', 'topics'],
  },
];

const isBcryptHash = (value: string) => BCRYPT_HASH_PREFIXES.some((prefix) => value.startsWith(prefix));

const getDefaultAccountConfig = (email: string) =>
  MEMBER_DEFAULT_ACCOUNT_PASSWORDS[String(email).trim().toLowerCase()] ?? null;

const sampleMeeting: Meeting = {
  id: 'meeting-1',
  clubId: IDTT_CLUB_ID,
  date: '2026-05-08',
  roles: ['toastmaster', 'speaker', 'speaker', 'evaluators', 'evaluators', 'generalEvaluator', 'topics', 'timer', 'grammarians', 'educationalMoment'],
};

const defaultAgenda = (): AgendaItem[] => [
  { id: 'agenda-1', title: 'Opening Toast', role: 'openingToast', durationMinutes: 5, notes: 'Welcome and introductions', meetingMode: 'all' },
  { id: 'agenda-3', title: 'Educational Moment', role: 'educationalMoment', durationMinutes: 5, meetingMode: 'all' },
  { id: 'agenda-4', title: 'Grammarian', role: 'grammarian', durationMinutes: 3, meetingMode: 'all' },
  { id: 'agenda-2', title: 'Toastmaster', role: 'toastmaster', durationMinutes: 5, optional: false, meetingMode: 'all' },
  { id: 'agenda-5', title: 'Barroom Topics', role: 'barroomTopics', durationMinutes: 15, meetingMode: 'standard' },
  { id: 'agenda-6', title: 'Speaker 1', role: 'speaker', durationMinutes: 12, meetingMode: 'standard' },
  { id: 'agenda-7', title: 'Speaker 2', role: 'speaker', durationMinutes: 12, meetingMode: 'standard' },
  { id: 'agenda-8', title: 'General Evaluator', role: 'generalEvaluator', durationMinutes: 10, meetingMode: 'all' },
  { id: 'agenda-9', title: 'Speech Evaluator 1', role: 'speechEvaluator', durationMinutes: 8, evaluatorMode: 'individual', meetingMode: 'standard' },
  { id: 'agenda-10', title: 'Speech Evaluator 2', role: 'speechEvaluator', durationMinutes: 8, evaluatorMode: 'individual', meetingMode: 'standard' },
  { id: 'agenda-11', title: 'Timer', role: 'timer', durationMinutes: 3, meetingMode: 'all' },
  { id: 'agenda-12', title: 'Improvmaster 1', role: 'improvmaster', durationMinutes: 15, meetingMode: 'improv' },
  { id: 'agenda-13', title: 'Improvmaster 2', role: 'improvmaster', durationMinutes: 15, meetingMode: 'improv' },
];

const schedulableRoles: RoleKey[] = [
  'openingToast',
  'educationalMoment',
  'grammarians',
  'toastmaster',
  'improvmaster',
  'topics',
  'speaker',
  'evaluators',
  'generalEvaluator',
  'timer',
];

const allEligibleRoles = [...schedulableRoles];

const agendaRoleCatalog: Record<string, { label: string; scheduleRole: RoleKey | null }> = {
  openingToast: { label: 'Opening Toast', scheduleRole: 'openingToast' },
  toastmaster: { label: 'Toastmaster', scheduleRole: 'toastmaster' },
  improvmaster: { label: 'Improvmaster', scheduleRole: 'improvmaster' },
  educationalMoment: { label: 'Educational Moment', scheduleRole: 'educationalMoment' },
  grammarian: { label: 'Grammarian', scheduleRole: 'grammarians' },
  barroomTopics: { label: 'Barroom Topics', scheduleRole: 'topics' },
  speaker: { label: 'Speaker', scheduleRole: 'speaker' },
  speechEvaluator: { label: 'Speech Evaluator', scheduleRole: 'evaluators' },
  generalEvaluator: { label: 'General Evaluator', scheduleRole: 'generalEvaluator' },
  timer: { label: 'Timer', scheduleRole: 'timer' },
  other: { label: 'Other', scheduleRole: null },
};

const agendaRoleOrder = new Map<string, number>([
  ['openingToast', 1],
  ['educationalMoment', 2],
  ['grammarian', 3],
  ['toastmaster', 4],
  ['improvmaster', 5],
  ['barroomTopics', 5],
  ['speaker', 6],
  ['generalEvaluator', 7],
  ['speechEvaluator', 8],
  ['timer', 9],
  ['other', 99],
]);

const getAgendaItemSortKey = (item: AgendaItem) => {
  const order = agendaRoleOrder.get(item.role) ?? 99;
  const title = (item.title ?? '').toLowerCase();
  return { order, title };
};

const sortAgendaItems = (items: AgendaItem[]) =>
  [...items].sort((left, right) => {
    const leftKey = getAgendaItemSortKey(left);
    const rightKey = getAgendaItemSortKey(right);

    if (leftKey.order !== rightKey.order) {
      return leftKey.order - rightKey.order;
    }

    return leftKey.title.localeCompare(rightKey.title);
  });

const looksLikeLegacyDefaultAgenda = (items: Array<{ title?: string; role?: string }>) => {
  const legacyTitles = new Set(
    items.map((item) => `${item.title ?? ''}`.trim().toLowerCase()),
  );
  const legacyRoles = new Set(
    items.map((item) => `${item.role ?? ''}`.trim().toLowerCase()),
  );

  return (
    items.length <= 6 &&
    (legacyTitles.has('opening') || legacyRoles.has('custom')) &&
    (legacyTitles.has('toastmaster') || legacyRoles.has('toastmaster')) &&
    (legacyTitles.has('table topics') || legacyRoles.has('topics')) &&
    (legacyTitles.has('prepared speaker') || legacyRoles.has('speaker')) &&
    (legacyTitles.has('general evaluation') || legacyRoles.has('generalevaluator'))
  );
};

const normalizeAgendaRole = (legacyRole: string, legacyTitle: string) => {
  const roleValue = legacyRole.trim().toLowerCase();
  const titleValue = legacyTitle.trim().toLowerCase();

  if (roleValue === 'openingtoast' || titleValue === 'opening toast' || titleValue === 'opening') {
    return 'openingToast';
  }

  if (roleValue === 'toastmaster' || titleValue === 'toastmaster') {
    return 'toastmaster';
  }

  if (roleValue === 'improvmaster' || titleValue.includes('improvmaster')) {
    return 'improvmaster';
  }

  if (roleValue === 'educationalmoment' || titleValue === 'educational moment') {
    return 'educationalMoment';
  }

  if (roleValue === 'grammarian' || roleValue === 'grammarians' || titleValue === 'grammarian' || titleValue === 'grammarian/ah counter') {
    return 'grammarian';
  }

  if (roleValue === 'barroomtopics' || roleValue === 'topics' || titleValue === 'barroom topics' || titleValue === 'table topics') {
    return 'barroomTopics';
  }

  if (roleValue === 'speaker' || titleValue.includes('speaker')) {
    return 'speaker';
  }

  if (roleValue === 'speechevaluator' || roleValue === 'evaluators' || titleValue.includes('speech evaluator')) {
    return 'speechEvaluator';
  }

  if (roleValue === 'generalevaluator' || titleValue === 'general evaluator' || titleValue === 'general evaluation') {
    return 'generalEvaluator';
  }

  if (roleValue === 'timer' || titleValue === 'timer' || titleValue === 'timer/vote counter') {
    return 'timer';
  }

  if (roleValue === 'other' || roleValue === 'custom') {
    return 'other';
  }

  return legacyRole;
};

const parseMeetingMode = (value: unknown): AgendaItem['meetingMode'] => {
  if (value === 'standard' || value === 'improv' || value === 'all') {
    return value;
  }

  return 'all';
};

const isImprovMeetingDate = (meetingDate: string) => {
  const meeting = new Date(`${meetingDate}T12:00:00Z`);
  if (Number.isNaN(meeting.getTime())) {
    return false;
  }

  return meeting.getUTCDate() <= 7;
};

const filterAgendaForMeetingMode = (agenda: AgendaItem[], meetingDate: string) => {
  const requiredMode = isImprovMeetingDate(meetingDate) ? 'improv' : 'standard';
  return agenda.filter((item) => {
    const meetingMode = item.meetingMode ?? 'all';
    return meetingMode === 'all' || meetingMode === requiredMode;
  });
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const deriveDisplayNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Club Admin';

const logClubActivity = async (
  clubId: string,
  actorEmail: string,
  memberEmail: string,
  activityType: ClubActivityType,
  summary: string,
  metadata: ClubActivityMetadata = {},
) => {
  await pool.query(
    `
      INSERT INTO club_activity_log (club_id, member_email, actor_email, activity_type, summary, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      clubId,
      memberEmail.trim().toLowerCase(),
      actorEmail.trim().toLowerCase(),
      activityType,
      summary,
      JSON.stringify(metadata),
    ],
  );
};

const logPortalActivityForMemberships = async (
  account: UserAccount,
  source: 'member' | 'admin',
) => {
  await Promise.all(
    account.memberships.map((membership) =>
      logClubActivity(
        membership.clubId,
        account.email,
        account.email,
        'portalLogin',
        `${account.name} signed in to the ${source === 'admin' ? 'admin' : 'member'} portal.`,
        { source },
      ),
    ),
  );
};

const logAccountSetupForMemberships = async (account: UserAccount) => {
  await Promise.all(
    account.memberships.map((membership) =>
      logClubActivity(
        membership.clubId,
        account.email,
        account.email,
        'accountSetup',
        `${account.name} completed account setup.`,
      ),
    ),
  );
};

const getRecentClubActivity = async (clubId: string, limit = 100): Promise<ClubActivityEntry[]> => {
  const normalizedLimit = Math.max(1, Math.min(limit, 250));
  const result = await pool.query(
    `
      SELECT
        activity.id,
        activity.club_id,
        activity.member_email,
        activity.actor_email,
        activity.activity_type,
        activity.summary,
        activity.metadata,
        activity.created_at,
        COALESCE(NULLIF(member_account.name, ''), member_roster.name, activity.member_email) AS member_name,
        COALESCE(NULLIF(actor_account.name, ''), actor_roster.name, activity.actor_email) AS actor_name
      FROM club_activity_log activity
      LEFT JOIN accounts member_account
        ON LOWER(member_account.email) = activity.member_email
      LEFT JOIN roster member_roster
        ON member_roster.club_id = activity.club_id
       AND LOWER(member_roster.member_email) = activity.member_email
      LEFT JOIN accounts actor_account
        ON LOWER(actor_account.email) = activity.actor_email
      LEFT JOIN roster actor_roster
        ON actor_roster.club_id = activity.club_id
       AND LOWER(actor_roster.member_email) = activity.actor_email
      WHERE activity.club_id = $1
      ORDER BY activity.created_at DESC, activity.id DESC
      LIMIT $2
    `,
    [clubId, normalizedLimit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    clubId: String(row.club_id),
    memberEmail: String(row.member_email),
    memberName: String(row.member_name ?? row.member_email),
    actorEmail: String(row.actor_email),
    actorName: String(row.actor_name ?? row.actor_email),
    activityType: String(row.activity_type) as ClubActivityType,
    summary: String(row.summary),
    metadata: (row.metadata as ClubActivityMetadata | null) ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
};

const getClubActivityMemberStatuses = async (clubId: string): Promise<ClubActivityMemberStatus[]> => {
  const result = await pool.query(
    `
      SELECT
        roster.member_email,
        COALESCE(NULLIF(accounts.name, ''), roster.name) AS member_name,
        CASE
          WHEN NULLIF(COALESCE(accounts.password, ''), '') IS NOT NULL
          THEN TRUE
          ELSE FALSE
        END AS is_active,
        (
          SELECT created_at
          FROM club_activity_log
          WHERE club_id = $1
            AND member_email = LOWER(roster.member_email)
            AND activity_type = 'portalLogin'
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_login_at
      FROM roster
      LEFT JOIN accounts
        ON LOWER(accounts.email) = LOWER(roster.member_email)
      WHERE roster.club_id = $1
      ORDER BY COALESCE(NULLIF(accounts.name, ''), roster.name) ASC
    `,
    [clubId],
  );

  return result.rows.map((row: any) => ({
    memberEmail: String(row.member_email),
    memberName: String(row.member_name ?? row.member_email),
    isActive: Boolean(row.is_active),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  }));
};

const hashPasswordResetToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const buildPasswordResetLink = (email: string, token: string) => {
  const url = new URL(MEMBER_PORTAL_URL);
  url.searchParams.set('reset', '1');
  url.searchParams.set('email', email);
  url.searchParams.set('token', token);
  return url.toString();
};

const sendPasswordResetEmail = async (toEmail: string, resetLink: string) => {
  if (!RESEND_API_KEY || !PASSWORD_RESET_FROM_EMAIL) {
    console.warn(`Password reset email not sent for ${toEmail}. Missing RESEND_API_KEY or PASSWORD_RESET_FROM_EMAIL.`);
    console.warn(`Reset link for ${toEmail}: ${resetLink}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: PASSWORD_RESET_FROM_EMAIL,
      to: [toEmail],
      subject: `${IDTT_CLUB_NAME} password reset`,
      html: `
        <div style="font-family: Segoe UI, Arial, sans-serif; color: #2f3642; line-height: 1.5;">
          <h2 style="color: #7a2e1f;">Reset your password</h2>
          <p>We received a request to reset your ${IDTT_CLUB_NAME} member portal password.</p>
          <p><a href="${resetLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#c55b2f;color:#fff7ef;text-decoration:none;font-weight:700;">Reset password</a></p>
          <p>If you did not request this, you can ignore this email.</p>
          <p>This link expires in 1 hour.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Unable to send password reset email. ${response.status} ${errorBody}`);
  }
};

const buildVerificationLink = (email: string, token: string) => {
  const url = new URL(MEMBER_PORTAL_URL);
  url.searchParams.set('verify', '1');
  url.searchParams.set('email', email);
  url.searchParams.set('token', token);
  return url.toString();
};

const sendVerificationEmail = async (toEmail: string, memberName: string, verificationLink: string) => {
  if (!RESEND_API_KEY || !PASSWORD_RESET_FROM_EMAIL) {
    console.warn(`Verification email not sent for ${toEmail}. Missing RESEND_API_KEY or PASSWORD_RESET_FROM_EMAIL.`);
    console.warn(`Verification link for ${toEmail}: ${verificationLink}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: PASSWORD_RESET_FROM_EMAIL,
      to: [toEmail],
      subject: `Set up your ${IDTT_CLUB_NAME} member portal account`,
      html: `
        <div style="font-family: Segoe UI, Arial, sans-serif; color: #2f3642; line-height: 1.5;">
          <h2 style="color: #7a2e1f;">Welcome to ${IDTT_CLUB_NAME}, ${memberName}!</h2>
          <p>Click the button below to finish setting up your member portal account. This link expires in 24 hours.</p>
          <p><a href="${verificationLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#c55b2f;color:#fff7ef;text-decoration:none;font-weight:700;">Set up my account</a></p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Unable to send verification email. ${response.status} ${errorBody}`);
  }
};

const createVerificationToken = async (email: string) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `DELETE FROM account_verification_tokens WHERE account_email = $1 OR expires_at <= NOW() OR used_at IS NOT NULL`,
    [email],
  );

  await pool.query(
    `INSERT INTO account_verification_tokens (token_hash, account_email, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, email, expiresAt.toISOString()],
  );

  return token;
};

const validateVerificationToken = async (email: string, token: string) => {
  const tokenHash = hashPasswordResetToken(token);
  const result = await pool.query(
    `SELECT token_hash FROM account_verification_tokens
     WHERE token_hash = $1 AND account_email = $2 AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash, email],
  );
  return (result.rowCount ?? 0) > 0;
};

const consumeVerificationToken = async (email: string, token: string) => {
  const tokenHash = hashPasswordResetToken(token);
  const result = await pool.query(
    `UPDATE account_verification_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND account_email = $2 AND used_at IS NULL AND expires_at > NOW()
     RETURNING token_hash`,
    [tokenHash, email],
  );
  return (result.rowCount ?? 0) > 0;
};

const buildRoleOfferLink = (token: string) => {
  const url = new URL(MEMBER_PORTAL_URL);
  url.searchParams.set('offer', token);
  return url.toString();
};

const createRoleOfferToken = async (
  clubId: string,
  meetingDate: string,
  slotId: string,
  roleLabel: string,
  offeredByEmail: string,
) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await pool.query(
    `DELETE FROM role_offer_tokens
     WHERE club_id = $1 AND meeting_date = $2 AND slot_id = $3 AND offered_by_email = $4`,
    [clubId, meetingDate, slotId, offeredByEmail],
  );

  await pool.query(
    `INSERT INTO role_offer_tokens (token_hash, club_id, meeting_date, slot_id, role_label, offered_by_email, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tokenHash, clubId, meetingDate, slotId, roleLabel, offeredByEmail, expiresAt.toISOString()],
  );

  return token;
};

const getRoleOffer = async (token: string) => {
  const tokenHash = hashPasswordResetToken(token);
  const result = await pool.query(
    `SELECT club_id, meeting_date, slot_id, role_label, offered_by_email, expires_at, accepted_by_email, accepted_at
     FROM role_offer_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] as {
    club_id: string;
    meeting_date: string;
    slot_id: string;
    role_label: string;
    offered_by_email: string;
    expires_at: string;
    accepted_by_email: string | null;
    accepted_at: string | null;
  } | undefined;
};

const consumeRoleOfferToken = async (token: string, acceptedByEmail: string) => {
  const tokenHash = hashPasswordResetToken(token);
  const result = await pool.query(
    `UPDATE role_offer_tokens SET accepted_by_email = $1, accepted_at = NOW()
     WHERE token_hash = $2 AND accepted_at IS NULL AND expires_at > NOW()
     RETURNING club_id, meeting_date, slot_id, role_label`,
    [acceptedByEmail, tokenHash],
  );
  return result.rows[0] as {
    club_id: string;
    meeting_date: string;
    slot_id: string;
    role_label: string;
  } | undefined;
};

const filterToSupportedMemberships = (memberships: ClubMembership[]) =>
  memberships.filter((membership) => membership.clubId === IDTT_CLUB_ID);

const normalizeIdentityName = (value: string | null | undefined) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const isFixedAdminIdentity = (email: string | null | undefined, name: string | null | undefined) => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedName = normalizeIdentityName(name);
  return FIXED_ADMIN_EMAILS.has(normalizedEmail) || FIXED_ADMIN_NAMES.has(normalizedName);
};

const parseRoles = (value: unknown): UserRole[] => {
  if (!Array.isArray(value)) {
    return ['member'];
  }

  const normalized = new Set<UserRole>();

  for (const entry of value) {
    if (entry === 'admin' || entry === 'vpe') {
      normalized.add('admin');
      normalized.add('member');
      continue;
    }

    if (entry === 'member') {
      normalized.add('member');
    }
  }

  if (normalized.size === 0) {
    normalized.add('member');
  }

  return Array.from(normalized);
};

const parseAgenda = (value: unknown): AgendaItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  if (shouldUpgradeAgendaTemplate(value as Array<{ title?: string; role?: string }>)) {
    return sortAgendaItems(defaultAgenda());
  }

  return sortAgendaItems(value.map((item, index) => {
    const record = item as Partial<AgendaItem>;
    const legacyRole = String(record.role ?? '');
    const legacyTitle = String(record.title ?? '');
    const normalizedRole = normalizeAgendaRole(legacyRole, legacyTitle);
    const roleMeta = agendaRoleCatalog[normalizedRole];
    const defaultTitle = roleMeta
      ? roleMeta.label
      : `Agenda item ${index + 1}`;

    return {
      id: record.id || `agenda-${index + 1}`,
      title:
        normalizedRole === 'other'
          ? record.title || defaultTitle
          : roleMeta?.label === 'Speaker'
            ? legacyTitle || `Speaker ${index + 1}`
            : roleMeta?.label === 'Speech Evaluator'
              ? legacyTitle || `Speech Evaluator ${index + 1}`
              : roleMeta?.label || defaultTitle,
      role: normalizedRole || 'other',
      durationMinutes: Number(record.durationMinutes) || 0,
      notes: record.notes ?? '',
      minBossScore: Number(record.minBossScore) || 0,
      priority:
        record.priority === 'high' || record.priority === 'flexible' || record.priority === 'standard'
          ? record.priority
          : 'standard',
      optional: Boolean(record.optional),
      evaluatorMode:
        record.evaluatorMode === 'roundRobin' || record.evaluatorMode === 'individual'
          ? record.evaluatorMode
          : 'individual',
      meetingMode: parseMeetingMode(record.meetingMode),
    };
  }));
};

const agendaNeedsRequiredRoleRefresh = (agenda: AgendaItem[]) => {
  const speakerCount = agenda.filter((item) => item.role === 'speaker').length;
  const evaluatorCount = agenda.filter((item) => item.role === 'speechEvaluator').length;
  return speakerCount === 0 || evaluatorCount === 0;
};

const parsePreferences = (value: unknown) => {
  const record = (value as { emailReminders?: boolean; swapAlerts?: boolean } | null) ?? {};
  return {
    emailReminders: record.emailReminders !== false,
    swapAlerts: record.swapAlerts !== false,
  };
};

const parseCsvLine = (line: string) => {
  const columns: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      columns.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  columns.push(current.trim());
  return columns;
};

const parseOfficerRoles = (currentPosition: string, name = '', email = ''): UserRole[] => {
  const normalizedPosition = currentPosition.trim().toLowerCase();
  const isPresident = normalizedPosition.includes('club president') || normalizedPosition === 'president';
  const isVpe =
    normalizedPosition.includes('club vp education')
    || normalizedPosition.includes('vice president education')
    || normalizedPosition.includes('vpe');

  return isPresident || isVpe || isFixedAdminIdentity(email, name) ? ['admin', 'member'] : ['member'];
};

const parseEligibleRoles = (value: unknown): RoleKey[] => {
  if (!Array.isArray(value)) {
    return [...allEligibleRoles];
  }

  const normalized = value.filter((role): role is RoleKey => typeof role === 'string' && isRoleKey(role));
  if (normalized.length === 0) {
    return [...allEligibleRoles];
  }

  const unique = Array.from(new Set(normalized));
  const legacyDefaultRoles: RoleKey[] = [
    'openingToast',
    'educationalMoment',
    'grammarians',
    'toastmaster',
    'topics',
    'speaker',
    'generalEvaluator',
    'evaluators',
    'timer',
  ];

  const looksLikeLegacyAllRoles =
    !unique.includes('improvmaster')
    && legacyDefaultRoles.every((role) => unique.includes(role));

  return looksLikeLegacyAllRoles ? [...unique, 'improvmaster'] : unique;
};

const normalizePhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }

  return digits.length === 10 ? digits : '';
};

const pickRosterPhoneNumber = (...values: Array<string | undefined>) => {
  for (const value of values) {
    const normalized = normalizePhoneNumber(String(value ?? '').trim());
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

const isPaidRosterStatus = (value: string) => {
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return normalized === '' || normalized === 'paidmember';
};

const parseRosterEntries = (rosterText: string) => {
  const lines = rosterText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headerColumns = parseCsvLine(lines[0]).map((column) => column.toLowerCase());
  const emailIndex = headerColumns.findIndex((column) => column === 'email');
  const nameIndex = headerColumns.findIndex((column) => column === 'name');
  const mobilePhoneIndex = headerColumns.findIndex((column) => column === 'mobile phone');
  const homePhoneIndex = headerColumns.findIndex((column) => column === 'home phone');
  const additionalPhoneIndex = headerColumns.findIndex((column) => column === 'additional phone');
  const statusIndex = headerColumns.findIndex((column) => column === 'status (*)');
  const currentPositionIndex = headerColumns.findIndex((column) => column === 'current position');
  const hasToastmastersHeader = emailIndex >= 0 && nameIndex >= 0;
  const dataLines = hasToastmastersHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line, index) => {
      const columns = parseCsvLine(line);
      const memberStatus = hasToastmastersHeader && statusIndex >= 0
        ? (columns[statusIndex] ?? '').trim()
        : '';
      const currentPosition = hasToastmastersHeader && currentPositionIndex >= 0
        ? (columns[currentPositionIndex] ?? '').trim()
        : '';
      const email = hasToastmastersHeader
        ? (columns[emailIndex] ?? '').trim()
        : columns.find((column) => /\S+@\S+\.\S+/.test(column)) ?? '';
      const name = hasToastmastersHeader
        ? ((columns[nameIndex] ?? '').trim() || `Member ${index + 1}`)
        : columns.filter((column) => column.trim() && column !== email).join(' ') || `Member ${index + 1}`;
      const phoneNumber = hasToastmastersHeader
        ? pickRosterPhoneNumber(
            mobilePhoneIndex >= 0 ? columns[mobilePhoneIndex] : '',
            homePhoneIndex >= 0 ? columns[homePhoneIndex] : '',
            additionalPhoneIndex >= 0 ? columns[additionalPhoneIndex] : '',
          )
        : '';

      return {
        id: `roster-${index + 1}`,
        name,
        email,
        phoneNumber: phoneNumber || null,
        currentPosition: currentPosition || null,
        memberStatus,
        roles: parseOfficerRoles(currentPosition, name, email),
      };
    })
    .filter((entry) => /\S+@\S+\.\S+/.test(entry.email))
    .filter((entry) => !hasToastmastersHeader || statusIndex < 0 || isPaidRosterStatus(entry.memberStatus))
    .map(({ id, name, email, phoneNumber, currentPosition, roles }) => ({
      id,
      name,
      email,
      phoneNumber,
      currentPosition,
      roles,
    }));
};

const isAvailabilityStatus = (value: string): value is AvailabilityStatus =>
  value === 'always' || value === 'tentative' || value === 'never' || value === 'custom';

const parseAvailabilityDefault = (value: unknown): AvailabilityStatus =>
  typeof value === 'string' && isAvailabilityStatus(value) ? value : 'always';

const parseAvailabilityOverrides = (value: unknown): Record<string, AvailabilityStatus> => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([date, status]) => Boolean(date) && typeof status === 'string' && isAvailabilityStatus(status),
    ),
  ) as Record<string, AvailabilityStatus>;
};

const isRoleKey = (role: string): role is RoleKey => schedulableRoles.includes(role as RoleKey);

const padDatePart = (value: number) => String(value).padStart(2, '0');

const parseDateOnly = (value: string) => new Date(`${value}T12:00:00Z`);

const getDateKeyInTimeZone = (value: Date, timeZone = CLUB_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`Unable to determine date in timezone ${timeZone}.`);
  }

  return `${year}-${month}-${day}`;
};

const getCurrentClubDateKey = () => getDateKeyInTimeZone(new Date());

const getCurrentClubDate = () => parseDateOnly(getCurrentClubDateKey());

const formatDateOnly = (value: Date) =>
  `${value.getUTCFullYear()}-${padDatePart(value.getUTCMonth() + 1)}-${padDatePart(value.getUTCDate())}`;

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const alignToMeetingWeekday = (
  referenceDate: Date,
  direction: 'future' | 'past',
  includeCurrent = true,
) => {
  const currentWeekday = referenceDate.getUTCDay();
  if (direction === 'future') {
    let daysUntilMeeting = (IDTT_MEETING_WEEKDAY - currentWeekday + 7) % 7;
    if (!includeCurrent && daysUntilMeeting === 0) {
      daysUntilMeeting = 7;
    }
    return addDays(referenceDate, daysUntilMeeting);
  }

  let daysSinceMeeting = (currentWeekday - IDTT_MEETING_WEEKDAY + 7) % 7;
  if (!includeCurrent && daysSinceMeeting === 0) {
    daysSinceMeeting = 7;
  }
  return addDays(referenceDate, -daysSinceMeeting);
};

const buildMeetingForClub = (clubId: string, agenda: AgendaItem[] | undefined, meetingDate?: string, meetingIndex = 0): Meeting => {
  const roleCounts = new Map<string, number>();
  const effectiveMeetingDate = meetingDate ?? getCurrentClubDateKey();
  const sortedAgenda = sortAgendaItems(filterAgendaForMeetingMode(agenda ?? [], effectiveMeetingDate));
  const roleSlots = sortedAgenda.reduce<MeetingRoleSlot[]>((acc, item) => {
    const roleMeta = agendaRoleCatalog[item.role];
    if (!roleMeta?.scheduleRole) {
      return acc;
    }

    const currentCount = (roleCounts.get(item.role) ?? 0) + 1;
    roleCounts.set(item.role, currentCount);
    const pairingKey = (() => {
      switch (item.role) {
        case 'openingToast':
          return 'openingToast';
        case 'toastmaster':
          return 'toastmaster';
        case 'improvmaster':
          return `improvmaster${Math.min(currentCount, 2)}`;
        case 'educationalMoment':
          return 'educationalMoment';
        case 'grammarian':
          return 'grammarians';
        case 'barroomTopics':
          return 'topics';
        case 'speaker':
          return `speaker${Math.min(currentCount, 2)}`;
        case 'generalEvaluator':
          return 'generalEvaluator';
        case 'speechEvaluator':
          return `evaluators${Math.min(currentCount, 2)}`;
        case 'timer':
          return 'timer';
        default:
          return item.role;
      }
    })();

    acc.push({
      id: item.id,
      label: item.title || roleMeta.label,
      roleKey: roleMeta.scheduleRole,
      order: acc.length,
      pairingKey,
      optional: Boolean(item.optional),
      evaluatorMode: item.evaluatorMode === 'roundRobin' ? 'roundRobin' : 'individual',
    });
    return acc;
  }, []);
  const rolesFromAgenda = roleSlots.map((item) => item.roleKey);
  const roleRequirements = sortedAgenda.reduce<NonNullable<Meeting['roleRequirements']>>((acc, item) => {
    const scheduleRole = agendaRoleCatalog[item.role]?.scheduleRole;
    if (!scheduleRole) {
      return acc;
    }

    acc[scheduleRole] = {
      minBossScore: Number(item.minBossScore) || 0,
      priority: item.priority ?? 'standard',
    };
    return acc;
  }, {});

  return {
    id: `meeting-${clubId}-${meetingIndex + 1}`,
    clubId,
    date: effectiveMeetingDate,
    roles: rolesFromAgenda.length > 0 ? rolesFromAgenda : sampleMeeting.roles,
    roleSlots,
    roleRequirements,
  };
};

const buildUpcomingMeetingsForClub = (clubId: string, agenda: AgendaItem[] | undefined, numberOfWeeks = 4): Meeting[] => {
  const startDate = alignToMeetingWeekday(getCurrentClubDate(), 'future');
  return Array.from({ length: numberOfWeeks }, (_value, index) =>
    buildMeetingForClub(
      clubId,
      agenda,
      formatDateOnly(addDays(startDate, index * 7)),
      index,
    ),
  );
};

const buildPastMeetingDates = (numberOfWeeks = 6) => {
  const startDate = alignToMeetingWeekday(getCurrentClubDate(), 'past');
  return Array.from({ length: numberOfWeeks }, (_value, index) =>
    formatDateOnly(addDays(startDate, -7 * index)),
  );
};

const shouldUpgradeAgendaTemplate = (items: Array<{ title?: string; role?: string }>) => {
  const normalizedRoles = items.map((item) =>
    normalizeAgendaRole(String(item.role ?? ''), String(item.title ?? '')),
  );
  const speakerCount = normalizedRoles.filter((role) => role === 'speaker').length;
  const evaluatorCount = normalizedRoles.filter((role) => role === 'speechEvaluator').length;
  const improvmasterCount = normalizedRoles.filter((role) => role === 'improvmaster').length;
  const hasMeetingModeMetadata = items.some((item) => {
    const record = item as Partial<AgendaItem>;
    return record.meetingMode === 'all' || record.meetingMode === 'standard' || record.meetingMode === 'improv';
  });

  return (
    looksLikeLegacyDefaultAgenda(items)
    || speakerCount === 0
    || evaluatorCount === 0
    || improvmasterCount < 2
    || !hasMeetingModeMetadata
  );
};

const getAvailabilityDefaultsForClub = async (clubId: string) => {
  const result = await pool.query(
    `
      SELECT member_email, default_status
      FROM member_availability_defaults
      WHERE club_id = $1
    `,
    [clubId],
  );

  return new Map<string, AvailabilityStatus>(
    result.rows.map((row: any) => [
      String(row.member_email).toLowerCase(),
      parseAvailabilityDefault(row.default_status),
    ]),
  );
};

const getAvailabilityOverridesForClub = async (clubId: string) => {
  const result = await pool.query(
    `
      SELECT member_email, meeting_date, status
      FROM member_availability_overrides
      WHERE club_id = $1
    `,
    [clubId],
  );

  const overrides = new Map<string, Record<string, AvailabilityStatus>>();

  for (const row of result.rows as any[]) {
    const email = String(row.member_email).toLowerCase();
    const current = overrides.get(email) ?? {};
    current[String(row.meeting_date)] = parseAvailabilityDefault(row.status);
    overrides.set(email, current);
  }

  return overrides;
};

const setMemberAvailability = async (
  clubId: string,
  memberEmail: string,
  defaultStatus: AvailabilityStatus,
  overrides: Record<string, AvailabilityStatus>,
) => {
  await pool.query(
    `
      INSERT INTO member_availability_defaults (club_id, member_email, default_status)
      VALUES ($1, $2, $3)
      ON CONFLICT (club_id, member_email)
      DO UPDATE SET default_status = EXCLUDED.default_status
    `,
    [clubId, memberEmail, defaultStatus],
  );

  await pool.query(
    `
      DELETE FROM member_availability_overrides
      WHERE club_id = $1 AND member_email = $2
    `,
    [clubId, memberEmail],
  );

  for (const [meetingDate, status] of Object.entries(overrides)) {
    await pool.query(
      `
        INSERT INTO member_availability_overrides (club_id, member_email, meeting_date, status)
        VALUES ($1, $2, $3, $4)
      `,
      [clubId, memberEmail, meetingDate, status],
    );
  }
};

const generateUpcomingSchedules = (meetings: Meeting[], members: Member[]) => {
  const pastAssignments: ReturnType<typeof generateSchedule>[`assignments`] = [];

  return meetings.map((meeting) => {
    const schedule = generateSchedule(meeting, members, pastAssignments);
    pastAssignments.push(...schedule.assignments);
    return schedule;
  });
};

const getHistoricalAssignmentsForClub = async (
  clubId: string,
  members: Member[],
  numberOfWeeks = 8,
) => {
  const historicalMeetingDates = buildPastMeetingDates(numberOfWeeks);
  const attendanceResult = await pool.query(
    `
      SELECT meeting_date, role, member_email
      FROM meeting_attendance_verifications
      WHERE club_id = $1
        AND meeting_date = ANY($2::text[])
        AND member_email IS NOT NULL
      ORDER BY meeting_date ASC, role ASC
    `,
    [clubId, historicalMeetingDates],
  );

  const membersByName = new Map(
    members.map((member) => [normalizeMemberName(member.name), member]),
  );
  const membersByEmail = new Map(
    members.map((member) => [member.email.trim().toLowerCase(), member]),
  );

  const historyAssignments = loadBundledScheduleHistory()
    .map((entry) => {
      const member = membersByName.get(normalizeMemberName(entry.memberName));
      const normalizedRole = normalizeAgendaRole(entry.role, entry.role);
      const roleKey = agendaRoleCatalog[normalizedRole]?.scheduleRole;

      if (!member || !roleKey) {
        return null;
      }

      return {
        meetingId: `history-${clubId}-${entry.meetingDate}`,
        meetingDate: entry.meetingDate,
        slotId: `history-${slugify(entry.role)}`,
        memberId: member.id,
        memberEmail: member.email,
        memberName: member.name,
        role: entry.role,
        roleKey,
        confidence: 1,
        reason: 'Bundled club history used for schedule fairness.',
      };
    });

  const attendanceAssignments = (attendanceResult.rows as any[])
    .map((row) => {
      const memberEmail = String(row.member_email).trim().toLowerCase();
      const member = membersByEmail.get(memberEmail);
      const normalizedRole = normalizeAgendaRole(String(row.role ?? ''), String(row.role ?? ''));
      const roleKey = agendaRoleCatalog[normalizedRole]?.scheduleRole;

      if (!member || !roleKey) {
        return null;
      }

      return {
        meetingId: `history-${clubId}-${String(row.meeting_date)}`,
        meetingDate: String(row.meeting_date),
        slotId: `history-${slugify(String(row.role))}`,
        memberId: member.id,
        memberEmail: member.email,
        memberName: member.name,
        role: String(row.role),
        roleKey,
        confidence: 1,
        reason: 'Historical attendance assignment used for schedule fairness.',
      };
    });

  const dedupedAssignments = new Map<string, ReturnType<typeof generateSchedule>['assignments'][number]>();
  [...historyAssignments, ...attendanceAssignments]
    .filter(Boolean)
    .forEach((assignment) => {
      const key = `${assignment!.meetingDate}|${assignment!.roleKey}|${assignment!.memberId}`;
      dedupedAssignments.set(key, assignment!);
    });

  return Array.from(dedupedAssignments.values()).sort((left, right) => (
    left.meetingDate === right.meetingDate
      ? left.role.localeCompare(right.role)
      : left.meetingDate!.localeCompare(right.meetingDate!)
  ));
};

const getPersistedScheduleMap = async (clubId: string, meetingDates: string[]) => {
  if (meetingDates.length === 0) {
    return new Map<string, { locked: boolean; assignments: ReturnType<typeof generateSchedule>['assignments'] }>();
  }

  const lockResult = await pool.query(
    `
      SELECT meeting_date
      FROM meeting_schedule_locks
      WHERE club_id = $1
        AND meeting_date = ANY($2::text[])
    `,
    [clubId, meetingDates],
  );

  const assignmentResult = await pool.query(
    `
      SELECT meeting_date, slot_id, role_label, role_key, member_id, member_email, member_name, confidence, reason
      FROM meeting_schedule_assignments
      WHERE club_id = $1
        AND meeting_date = ANY($2::text[])
      ORDER BY meeting_date ASC, slot_order ASC
    `,
    [clubId, meetingDates],
  );

  const assignmentMap = new Map<string, ReturnType<typeof generateSchedule>['assignments']>();
  for (const row of assignmentResult.rows as any[]) {
    const meetingDate = String(row.meeting_date);
    const assignments = assignmentMap.get(meetingDate) ?? [];
    assignments.push({
      meetingId: `meeting-${clubId}`,
      meetingDate,
      slotId: String(row.slot_id),
      role: String(row.role_label),
      roleKey: row.role_key ? (String(row.role_key) as RoleKey) : undefined,
      memberId: row.member_id ? String(row.member_id) : null,
      memberEmail: row.member_email ? String(row.member_email) : null,
      memberName: row.member_name ? String(row.member_name) : null,
      confidence: Number(row.confidence ?? 0),
      reason: String(row.reason ?? ''),
    });
    assignmentMap.set(meetingDate, assignments);
  }

  const lockedDates = new Set(lockResult.rows.map((row: any) => String(row.meeting_date)));
  const meetingMap = new Map<string, { locked: boolean; assignments: ReturnType<typeof generateSchedule>['assignments'] }>();

  for (const meetingDate of meetingDates) {
    const assignments = assignmentMap.get(meetingDate) ?? [];
    const locked = lockedDates.has(meetingDate);
    if (assignments.length > 0 || locked) {
      meetingMap.set(meetingDate, { locked, assignments });
    }
  }

  return meetingMap;
};

const getRoleConfirmationMap = async (clubId: string, meetingDates: string[]) => {
  if (meetingDates.length === 0) {
    return new Map<string, string>();
  }

  const confirmationResult = await pool.query(
    `
      SELECT meeting_date, slot_id, member_email, confirmed_at
      FROM meeting_role_confirmations
      WHERE club_id = $1
        AND meeting_date = ANY($2::text[])
    `,
    [clubId, meetingDates],
  );

  const confirmationMap = new Map<string, string>();
  for (const row of confirmationResult.rows as any[]) {
    const meetingDate = String(row.meeting_date);
    const slotId = String(row.slot_id);
    const memberEmail = String(row.member_email).trim().toLowerCase();
    const confirmedAt = new Date(row.confirmed_at).toISOString();
    confirmationMap.set(`${meetingDate}|${slotId}|${memberEmail}`, confirmedAt);
  }

  return confirmationMap;
};

const pruneStaleRoleConfirmations = async (
  clubId: string,
  meetingDate: string,
  assignments: ReturnType<typeof generateSchedule>['assignments'],
) => {
  const validSlotAssignments = new Map<string, string>();
  assignments.forEach((assignment, index) => {
    const slotId = assignment.slotId ?? `slot-${index + 1}`;
    const memberEmail = String(assignment.memberEmail ?? '').trim().toLowerCase();
    if (memberEmail) {
      validSlotAssignments.set(slotId, memberEmail);
    }
  });

  const existingConfirmations = await pool.query(
    `
      SELECT slot_id, member_email
      FROM meeting_role_confirmations
      WHERE club_id = $1
        AND meeting_date = $2
    `,
    [clubId, meetingDate],
  );

  for (const row of existingConfirmations.rows as any[]) {
    const slotId = String(row.slot_id);
    const memberEmail = String(row.member_email).trim().toLowerCase();
    if (validSlotAssignments.get(slotId) !== memberEmail) {
      await pool.query(
        `
          DELETE FROM meeting_role_confirmations
          WHERE club_id = $1
            AND meeting_date = $2
            AND slot_id = $3
        `,
        [clubId, meetingDate, slotId],
      );
    }
  }
};

const persistLockedSchedule = async (
  clubId: string,
  meeting: Meeting,
  assignments: ReturnType<typeof generateSchedule>['assignments'],
  lockedByEmail: string,
) => {
  await pool.query(
    `
      INSERT INTO meeting_schedule_locks (club_id, meeting_date, locked_by_email)
      VALUES ($1, $2, $3)
      ON CONFLICT (club_id, meeting_date)
      DO UPDATE SET
        locked_by_email = EXCLUDED.locked_by_email,
        locked_at = NOW()
    `,
    [clubId, meeting.date, lockedByEmail],
  );

  await pool.query(
    `
      DELETE FROM meeting_schedule_assignments
      WHERE club_id = $1
        AND meeting_date = $2
    `,
    [clubId, meeting.date],
  );

  for (const [index, assignment] of assignments.entries()) {
    const slot = meeting.roleSlots?.find((entry) => entry.id === assignment.slotId);
    await pool.query(
      `
        INSERT INTO meeting_schedule_assignments (
          club_id,
          meeting_date,
          slot_id,
          slot_order,
          role_label,
          role_key,
          member_id,
          member_email,
          member_name,
          confidence,
          reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        clubId,
        meeting.date,
        assignment.slotId ?? `slot-${index + 1}`,
        slot?.order ?? index,
        assignment.role,
        assignment.roleKey ?? null,
        assignment.memberId,
        assignment.memberEmail ?? null,
        assignment.memberName ?? null,
        assignment.confidence,
        assignment.reason,
      ],
    );
  }

  await pruneStaleRoleConfirmations(clubId, meeting.date, assignments);
};

const persistDraftScheduleAssignments = async (
  clubId: string,
  meeting: Meeting,
  assignments: ReturnType<typeof generateSchedule>['assignments'],
) => {
  await pool.query(
    `
      DELETE FROM meeting_schedule_assignments
      WHERE club_id = $1
        AND meeting_date = $2
    `,
    [clubId, meeting.date],
  );

  for (const [index, assignment] of assignments.entries()) {
    const slot = meeting.roleSlots?.find((entry) => entry.id === assignment.slotId);
    await pool.query(
      `
        INSERT INTO meeting_schedule_assignments (
          club_id,
          meeting_date,
          slot_id,
          slot_order,
          role_label,
          role_key,
          member_id,
          member_email,
          member_name,
          confidence,
          reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        clubId,
        meeting.date,
        assignment.slotId ?? `slot-${index + 1}`,
        slot?.order ?? index,
        assignment.role,
        assignment.roleKey ?? null,
        assignment.memberId,
        assignment.memberEmail ?? null,
        assignment.memberName ?? null,
        assignment.confidence,
        assignment.reason,
      ],
    );
  }

  await pruneStaleRoleConfirmations(clubId, meeting.date, assignments);
};

const unlockMeetingSchedule = async (clubId: string, meetingDate: string) => {
  await pool.query('DELETE FROM meeting_schedule_locks WHERE club_id = $1 AND meeting_date = $2', [clubId, meetingDate]);
};

const runOneTimeLockedAgendaRefreshFromHistory = async (clubId: string) => {
  const flagKey = `refresh_locked_agendas_from_history_v1:${clubId}`;
  const existingFlag = await pool.query(
    `
      SELECT flag_key
      FROM system_flags
      WHERE flag_key = $1
    `,
    [flagKey],
  );

  if ((existingFlag.rowCount ?? 0) > 0) {
    return false;
  }

  const today = getCurrentClubDateKey();

  await pool.query(
    `
      DELETE FROM meeting_schedule_locks
      WHERE club_id = $1
        AND meeting_date >= $2
    `,
    [clubId, today],
  );

  await pool.query(
    `
      DELETE FROM meeting_schedule_assignments
      WHERE club_id = $1
        AND meeting_date >= $2
    `,
    [clubId, today],
  );

  await pool.query(
    `
      INSERT INTO system_flags (flag_key, flag_value)
      VALUES ($1, $2)
      ON CONFLICT (flag_key) DO NOTHING
    `,
    [flagKey, today],
  );

  return true;
};

const generateSchedulesWithLocks = async (clubId: string, meetings: Meeting[], members: Member[]) => {
  const persistedMap = await getPersistedScheduleMap(clubId, meetings.map((meeting) => meeting.date));
  const pastAssignments: ReturnType<typeof generateSchedule>['assignments'] = await getHistoricalAssignmentsForClub(clubId, members);

  return meetings.map((meeting) => {
    const generated = generateSchedule(meeting, members, pastAssignments);
    const persistedSchedule = persistedMap.get(meeting.date);
    const persistedAssignmentsBySlotId = new Map(
      (persistedSchedule?.assignments ?? [])
        .filter((assignment) => assignment.slotId)
        .map((assignment) => [assignment.slotId as string, assignment]),
    );
    const assignments = generated.assignments.map((assignment) => {
      if (!assignment.slotId) {
        return assignment;
      }

      const persisted = persistedAssignmentsBySlotId.get(assignment.slotId);
      return persisted
        ? {
            ...assignment,
            ...persisted,
            meetingId: meeting.id,
          }
        : assignment;
    });

    pastAssignments.push(...assignments);
    return {
      locked: persistedSchedule?.locked ?? false,
      assignments,
      fairness: generated.fairness,
    };
  });
};

const buildMembersForClub = async (clubId: string): Promise<Member[]> => {
  const club = await getClubRoster(clubId);
  if (!club) {
    return [];
  }

  const members = await Promise.all(
    club.roster.map(async (member) => {
      const account = await getAccountByEmail(member.email);
      return {
        id: member.id,
        name: member.name,
        email: member.email,
        clubId,
        bossScore: account?.bossScore ?? 100,
        eligibleRoles: parseEligibleRoles(member.eligibleRoles),
        availabilityDefault: member.availabilityDefault ?? 'always',
        availability: member.availabilityOverrides ?? {},
        preferredRoles: [],
      } satisfies Member;
    }),
  );

  return members;
};

const getMeetingDateForClub = async (clubId: string) => {
  const agenda = await getClubAgenda(clubId);
  return buildMeetingForClub(clubId, agenda?.agenda).date;
};

const setMeetingCallout = async (clubId: string, meetingDate: string, memberEmail: string, calledOut: boolean) => {
  if (calledOut) {
    await pool.query(
      `
        INSERT INTO meeting_callouts (club_id, meeting_date, member_email, called_out)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (club_id, meeting_date, member_email)
        DO UPDATE SET called_out = EXCLUDED.called_out
      `,
      [clubId, meetingDate, memberEmail],
    );
    return;
  }

  await pool.query(
    `
      DELETE FROM meeting_callouts
      WHERE club_id = $1 AND meeting_date = $2 AND member_email = $3
    `,
    [clubId, meetingDate, memberEmail],
  );
};

const updateMemberBossScore = async (email: string, name: string, bossScore: number) => {
  await upsertAccount(email, name, {
    bossScore,
    setupComplete: false,
    password: null,
    overwriteProfile: false,
  });
};

const upsertAccount = async (
  email: string,
  name: string,
  options?: {
    setupComplete?: boolean;
    password?: string | null;
    bossScore?: number;
    notificationPreferences?: { emailReminders: boolean; swapAlerts: boolean };
    bio?: string | null;
    profileImageUrl?: string | null;
    overwriteProfile?: boolean;
  },
) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const defaultAccountConfig = getDefaultAccountConfig(normalizedEmail);
  const id = `acct-${slugify(normalizedEmail)}`;
  const bossScore = options?.bossScore ?? 100;
  const setupComplete = defaultAccountConfig?.setupComplete ? true : (options?.setupComplete ?? false);
  const rawPassword = options?.password ?? defaultAccountConfig?.password ?? null;
  const password = rawPassword
    ? (isBcryptHash(rawPassword) ? rawPassword : await bcrypt.hash(rawPassword, 10))
    : null;
  const bio = options?.bio ?? null;
  const profileImageUrl = options?.profileImageUrl ?? null;
  const overwriteProfile = options?.overwriteProfile ?? true;
  const preferences = options?.notificationPreferences ?? {
    emailReminders: true,
    swapAlerts: true,
  };

  await pool.query(
    `
      INSERT INTO accounts (
        email,
        id,
        name,
        bio,
        profile_image_url,
        boss_score,
        setup_complete,
        password,
        notification_preferences
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (email)
      DO UPDATE SET
        name = CASE
          WHEN $10 THEN EXCLUDED.name
          ELSE COALESCE(accounts.name, EXCLUDED.name)
        END,
        bio = CASE
          WHEN $10 THEN EXCLUDED.bio
          ELSE accounts.bio
        END,
        profile_image_url = CASE
          WHEN $10 THEN EXCLUDED.profile_image_url
          ELSE accounts.profile_image_url
        END,
        boss_score = COALESCE(accounts.boss_score, EXCLUDED.boss_score),
        setup_complete = accounts.setup_complete OR EXCLUDED.setup_complete,
        password = COALESCE(EXCLUDED.password, accounts.password),
        notification_preferences = CASE
          WHEN accounts.setup_complete AND NOT EXCLUDED.setup_complete THEN accounts.notification_preferences
          ELSE EXCLUDED.notification_preferences
        END
    `,
    [
      normalizedEmail,
      id,
      name,
      bio,
      profileImageUrl,
      bossScore,
      setupComplete,
      password,
      JSON.stringify(preferences),
      overwriteProfile,
    ],
  );
};

const upsertClub = async (clubId: string, clubName: string, agenda?: AgendaItem[]) => {
  await pool.query(
    `
      INSERT INTO clubs (id, name, agenda)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        agenda = COALESCE(clubs.agenda, EXCLUDED.agenda)
    `,
    [clubId, clubName, JSON.stringify(agenda ?? defaultAgenda())],
  );
};

const upsertMembership = async (email: string, membership: ClubMembership) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  await pool.query(
    `
      INSERT INTO memberships (account_email, club_id, roles)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (account_email, club_id)
      DO UPDATE SET roles = EXCLUDED.roles
    `,
    [normalizedEmail, membership.clubId, JSON.stringify(membership.roles)],
  );
};

const replaceRoster = async (clubId: string, clubName: string, roster: ClubMemberRecord[]) => {
  await pool.query('DELETE FROM roster WHERE club_id = $1', [clubId]);

  for (const member of roster) {
    const normalizedEmail = String(member.email).trim().toLowerCase();
    await pool.query(
      `
        INSERT INTO roster (club_id, member_email, member_id, name, phone_number, current_position, roles, eligible_roles)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        clubId,
        normalizedEmail,
        member.id,
        member.name,
        member.phoneNumber ?? null,
        member.currentPosition ?? null,
        JSON.stringify(member.roles),
        JSON.stringify(parseEligibleRoles(member.eligibleRoles)),
      ],
    );

    await upsertAccount(normalizedEmail, member.name, {
      setupComplete: false,
      password: null,
      bossScore: Number(member.bossScore) || 100,
      overwriteProfile: false,
    });

    await upsertMembership(normalizedEmail, {
      clubId,
      clubName,
      roles: member.roles,
    });
  }
};

const getAccountByEmail = async (email: string): Promise<UserAccount | null> => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const accountResult = await pool.query(
    `
      SELECT email, id, name, boss_score, setup_complete, password, notification_preferences
           , bio, profile_image_url
      FROM accounts
      WHERE email = $1
    `,
    [normalizedEmail],
  );

  if (accountResult.rowCount === 0) {
    return null;
  }

  const accountRow = accountResult.rows[0];
  const membershipResult = await pool.query(
    `
      SELECT memberships.club_id, clubs.name AS club_name, memberships.roles
      FROM memberships
      INNER JOIN clubs ON clubs.id = memberships.club_id
      WHERE memberships.account_email = $1
      ORDER BY clubs.name ASC
    `,
    [normalizedEmail],
  );

  const memberships: ClubMembership[] = membershipResult.rows.map((row: any) => ({
    clubId: row.club_id as string,
    clubName: row.club_name as string,
    roles: parseRoles(row.roles),
  }));

  return {
    id: accountRow.id as string,
    name: accountRow.name as string,
    email: accountRow.email as string,
    bossScore: Number(accountRow.boss_score),
    setupComplete: Boolean(accountRow.setup_complete),
    memberships: filterToSupportedMemberships(memberships),
    password: (accountRow.password as string | null) ?? undefined,
    bio: (accountRow.bio as string | null) ?? null,
    profileImageUrl: (accountRow.profile_image_url as string | null) ?? null,
    notificationPreferences: parsePreferences(accountRow.notification_preferences),
  };
};

const createPasswordResetToken = async (email: string) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + (60 * 60 * 1000));

  await pool.query(
    `
      DELETE FROM password_reset_tokens
      WHERE account_email = $1 OR expires_at <= NOW() OR used_at IS NOT NULL
    `,
    [email],
  );

  await pool.query(
    `
      INSERT INTO password_reset_tokens (token_hash, account_email, expires_at)
      VALUES ($1, $2, $3)
    `,
    [tokenHash, email, expiresAt.toISOString()],
  );

  return token;
};

const consumePasswordResetToken = async (email: string, token: string) => {
  const tokenHash = hashPasswordResetToken(token);
  const result = await pool.query(
    `
      UPDATE password_reset_tokens
      SET used_at = NOW()
      WHERE token_hash = $1
        AND account_email = $2
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING account_email
    `,
    [tokenHash, email],
  );

  return (result.rowCount ?? 0) > 0;
};

const getAdminAccountForClub = async (clubId: string): Promise<UserAccount | null> => {
  const result = await pool.query(
    `
      SELECT accounts.email
      FROM accounts
      INNER JOIN memberships
        ON memberships.account_email = accounts.email
      WHERE memberships.club_id = $1
        AND memberships.roles @> '["admin"]'::jsonb
      ORDER BY accounts.email ASC
      LIMIT 1
    `,
    [clubId],
  );

  for (const row of result.rows as Array<{ email: string }>) {
    const account = await getAccountByEmail(String(row.email));
    if (account) {
      const membership = account.memberships.find((entry) => entry.clubId === clubId);
      if (membership && hasRestrictedAdminAccess(membership.roles, account.email, account.name)) {
        return account;
      }
    }
  }

  return null;
};

const getPendingMembershipsByEmail = async (email: string): Promise<ClubMembership[]> => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const membershipResult = await pool.query(
    `
      SELECT memberships.club_id, clubs.name AS club_name, memberships.roles
      FROM memberships
      INNER JOIN clubs ON clubs.id = memberships.club_id
      WHERE memberships.account_email = $1
        AND memberships.club_id = $2
      ORDER BY clubs.name ASC
    `,
    [normalizedEmail, IDTT_CLUB_ID],
  );

  return membershipResult.rows.map((row: any) => ({
    clubId: row.club_id as string,
    clubName: row.club_name as string,
    roles: parseRoles(row.roles),
  }));
};

const ensurePendingSetupAccount = async (clubId: string, email: string) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existingAccount = await getAccountByEmail(normalizedEmail);

  if (existingAccount?.setupComplete) {
    return { error: 'This member account is already set up. They can sign in or reset their password instead.' } as const;
  }

  if (!existingAccount) {
    const rosterResult = await pool.query(
      `
        SELECT COALESCE(NULLIF(accounts.name, ''), roster.name) AS display_name, roster.member_email, accounts.boss_score
        FROM roster
        LEFT JOIN accounts ON accounts.email = roster.member_email
        WHERE LOWER(roster.member_email) = $1
          AND roster.club_id = $2
        ORDER BY COALESCE(NULLIF(accounts.name, ''), roster.name) ASC
        LIMIT 1
      `,
      [normalizedEmail, clubId],
    );

    if (rosterResult.rowCount === 0) {
      return {
        error: 'We could not find that email on the club roster yet. Add them to the roster first.',
      } as const;
    }

    const rosterMember = rosterResult.rows[0];
    const memberName =
      ((rosterMember.display_name as string | null) ?? '').trim() || deriveDisplayNameFromEmail(normalizedEmail);

    await upsertAccount(normalizedEmail, memberName, {
      setupComplete: false,
      password: null,
      bossScore: Number(rosterMember.boss_score) || 100,
      overwriteProfile: false,
    });
  }

  const pendingAccount = await getAccountByEmail(normalizedEmail);
  const memberships = await getPendingMembershipsByEmail(normalizedEmail);

  if (!pendingAccount || memberships.length === 0) {
    return { error: 'Unable to start member signup right now.' } as const;
  }

  return {
    account: pendingAccount,
  } as const;
};

const isEmailOnClubRoster = async (clubId: string, email: string) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await pool.query(
    `
      SELECT 1
      FROM roster
      WHERE club_id = $1
        AND LOWER(member_email) = $2
      LIMIT 1
    `,
    [clubId, normalizedEmail],
  );

  return (result.rowCount ?? 0) > 0;
};

const getClubRoster = async (clubId: string): Promise<{ id: string; name: string; meetingDate: string; roster: ClubMemberRecord[] } | null> => {
  const clubResult = await pool.query('SELECT id, name FROM clubs WHERE id = $1', [clubId]);
  if (clubResult.rowCount === 0) {
    return null;
  }

  const meetingDate = await getMeetingDateForClub(clubId);
  const availabilityDefaults = await getAvailabilityDefaultsForClub(clubId);
  const availabilityOverrides = await getAvailabilityOverridesForClub(clubId);

  const rosterResult = await pool.query(
    `
      SELECT
        roster.member_id,
        COALESCE(NULLIF(accounts.name, ''), roster.name) AS display_name,
        roster.member_email,
        roster.phone_number,
        roster.current_position,
        roster.roles,
        roster.eligible_roles,
        accounts.boss_score,
        accounts.bio,
        accounts.profile_image_url,
        COALESCE(meeting_callouts.called_out, FALSE) AS called_out
      FROM roster
      LEFT JOIN accounts ON accounts.email = roster.member_email
      LEFT JOIN meeting_callouts
        ON meeting_callouts.club_id = roster.club_id
        AND meeting_callouts.member_email = roster.member_email
        AND meeting_callouts.meeting_date = $2
      WHERE roster.club_id = $1
      ORDER BY COALESCE(NULLIF(accounts.name, ''), roster.name) ASC
    `,
    [clubId, meetingDate],
  );

  return {
    id: clubResult.rows[0].id as string,
    name: clubResult.rows[0].name as string,
    meetingDate,
    roster: rosterResult.rows.map((row: any) => {
      const bundledEntry = getBundledRosterEntryByEmail(row.member_email as string | null);
      return {
        id: row.member_id as string,
        name: row.display_name as string,
        email: row.member_email as string,
        phoneNumber: (row.phone_number as string | null) ?? null,
        currentPosition: (row.current_position as string | null) ?? bundledEntry?.currentPosition ?? null,
        roles: getEffectiveRolesForIdentity(
          parseRoles(row.roles),
          row.member_email as string,
          row.display_name as string,
        ),
        eligibleRoles: parseEligibleRoles(row.eligible_roles),
        bossScore: Number(row.boss_score ?? 100),
        calledOut: Boolean(row.called_out),
        bio: (row.bio as string | null) ?? null,
        profileImageUrl: (row.profile_image_url as string | null) ?? null,
        availabilityDefault: availabilityDefaults.get(String(row.member_email).toLowerCase()) ?? 'always',
        availabilityOverrides: availabilityOverrides.get(String(row.member_email).toLowerCase()) ?? {},
      };
    }),
  };
};

const getClubAgenda = async (clubId: string): Promise<{ id: string; name: string; agenda: AgendaItem[] } | null> => {
  const clubResult = await pool.query('SELECT id, name, agenda FROM clubs WHERE id = $1', [clubId]);
  if (clubResult.rowCount === 0) {
    return null;
  }

  const agenda = parseAgenda(clubResult.rows[0].agenda);
  if (agendaNeedsRequiredRoleRefresh(agenda)) {
    const refreshedAgenda = defaultAgenda();
    await pool.query('UPDATE clubs SET agenda = $2::jsonb WHERE id = $1', [clubId, JSON.stringify(refreshedAgenda)]);
    return {
      id: clubResult.rows[0].id as string,
      name: clubResult.rows[0].name as string,
      agenda: refreshedAgenda,
    };
  }

  return {
    id: clubResult.rows[0].id as string,
    name: clubResult.rows[0].name as string,
    agenda,
  };
};

const isScheduledToastmasterForUpcomingMeeting = async (email: string, clubId: string): Promise<boolean> => {
  const today = getCurrentClubDateKey();
  const result = await pool.query(
    `SELECT member_email FROM meeting_schedule_assignments
     WHERE club_id = $1
       AND role_key = 'toastmaster'
       AND meeting_date >= $2
     ORDER BY meeting_date ASC
     LIMIT 1`,
    [clubId, today],
  );
  if ((result.rowCount ?? 0) === 0) return false;
  const assignedEmail = String(result.rows[0].member_email ?? '').trim().toLowerCase();
  return assignedEmail === email.trim().toLowerCase();
};

const majorRoleKeys = new Set<RoleKey>(['toastmaster', 'improvmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator']);
const getAttendancePenalty = (roleKey: RoleKey | undefined) => (roleKey && majorRoleKeys.has(roleKey) ? -10 : -5);
const isMajorRoleKey = (roleKey: RoleKey | undefined) => Boolean(roleKey && majorRoleKeys.has(roleKey));

const getAttendanceVerifications = async (clubId: string, meetingDate: string) => {
  const result = await pool.query(
    `
      SELECT role, member_email, status, points_delta
      FROM meeting_attendance_verifications
      WHERE club_id = $1 AND meeting_date = $2
    `,
    [clubId, meetingDate],
  );

  return new Map<string, { memberEmail: string | null; status: string; pointsDelta: number }>(
    result.rows.map((row: any) => [
      String(row.role),
      {
        memberEmail: row.member_email ? String(row.member_email) : null,
        status: String(row.status),
        pointsDelta: Number(row.points_delta ?? 0),
      },
    ]),
  );
};

const getAdminMemberList = async (clubId: string) => {
  const rosterResult = await pool.query(
    `
      SELECT
        roster.member_id,
        COALESCE(NULLIF(accounts.name, ''), roster.name) AS display_name,
        roster.member_email,
        roster.phone_number,
        roster.current_position,
        roster.roles,
        roster.eligible_roles,
        accounts.setup_complete
      FROM roster
      LEFT JOIN accounts ON accounts.email = roster.member_email
      WHERE roster.club_id = $1
      ORDER BY COALESCE(NULLIF(accounts.name, ''), roster.name) ASC
    `,
    [clubId],
  );

  return rosterResult.rows.map((row: any) => {
    const bundledEntry = getBundledRosterEntryByEmail(row.member_email as string | null);
    return {
      id: String(row.member_id),
      name: String(row.display_name),
      email: String(row.member_email),
      phoneNumber: (row.phone_number as string | null) ?? null,
      currentPosition: (row.current_position as string | null) ?? bundledEntry?.currentPosition ?? null,
      roles: getEffectiveRolesForIdentity(
        parseRoles(row.roles),
        row.member_email as string,
        row.display_name as string,
      ),
      eligibleRoles: parseEligibleRoles(row.eligible_roles),
      setupComplete: Boolean(row.setup_complete),
      status: Boolean(row.setup_complete) ? 'active' : 'pending',
    };
  });
};

const loadBundledRosterEntries = () => {
  if (!fs.existsSync(BUNDLED_ROSTER_PATH)) {
    return [];
  }

  try {
    const rosterText = fs.readFileSync(BUNDLED_ROSTER_PATH, 'utf8');
    return parseRosterEntries(rosterText);
  } catch (error) {
    console.error('Unable to load bundled IDTT roster seed', error);
    return [];
  }
};

const getBundledRosterEntryByEmail = (email: string | null | undefined) => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  return loadBundledRosterEntries().find((entry) => entry.email.toLowerCase() === normalizedEmail) ?? null;
};

let cachedAllowedAdminIdentities: { emails: Set<string>; names: Set<string> } | null = null;

const getAllowedAdminIdentities = () => {
  if (cachedAllowedAdminIdentities) {
    return cachedAllowedAdminIdentities;
  }

  const rosterEntries = loadBundledRosterEntries();
  const emails = new Set<string>(FIXED_ADMIN_EMAILS);
  const names = new Set<string>(FIXED_ADMIN_NAMES);

  rosterEntries
    .filter((entry) => entry.roles.includes('admin'))
    .forEach((entry) => {
      emails.add(String(entry.email).trim().toLowerCase());
      names.add(normalizeIdentityName(entry.name));
    });

  cachedAllowedAdminIdentities = { emails, names };
  return cachedAllowedAdminIdentities;
};

const hasRestrictedAdminAccess = (
  roles: UserRole[],
  email: string | null | undefined,
  name: string | null | undefined,
) => {
  if (isFixedAdminIdentity(email, name)) {
    return true;
  }

  if (!roles.includes('admin')) {
    return false;
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedName = normalizeIdentityName(name);
  const allowed = getAllowedAdminIdentities();

  return allowed.emails.has(normalizedEmail) || allowed.names.has(normalizedName);
};

const getEffectiveRolesForIdentity = (
  roles: UserRole[],
  email: string | null | undefined,
  name: string | null | undefined,
): UserRole[] => {
  const normalized = new Set<UserRole>(['member']);
  if (hasRestrictedAdminAccess(roles, email, name)) {
    normalized.add('admin');
  }
  return Array.from(normalized);
};

const getEffectiveMembershipForAccount = (account: UserAccount, membership: ClubMembership): ClubMembership => ({
  ...membership,
  roles: getEffectiveRolesForIdentity(membership.roles, account.email, account.name),
});

const normalizeMemberName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const loadBundledScheduleHistory = () => {
  if (!fs.existsSync(BUNDLED_HISTORY_PATH)) {
    return [] as Array<{ meetingDate: string; role: string; memberName: string }>;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(BUNDLED_HISTORY_PATH, 'utf8'));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => ({
        meetingDate: String((entry as any).meetingDate ?? ''),
        role: String((entry as any).role ?? ''),
        memberName: String((entry as any).memberName ?? ''),
      }))
      .filter((entry) => entry.meetingDate && entry.role && entry.memberName);
  } catch (error) {
    console.error('Unable to load bundled IDTT schedule history', error);
    return [];
  }
};

const setMemberEligibleRoles = async (clubId: string, memberEmail: string, eligibleRoles: RoleKey[]) => {
  await pool.query(
    `
      UPDATE roster
      SET eligible_roles = $3::jsonb
      WHERE club_id = $1
        AND member_email = $2
    `,
    [clubId, String(memberEmail).trim().toLowerCase(), JSON.stringify(parseEligibleRoles(eligibleRoles))],
  );
};

const setMemberProfile = async (
  clubId: string,
  memberEmail: string,
  profile: {
    name: string;
    bio?: string | null;
    profileImageUrl?: string | null;
  },
) => {
  const normalizedEmail = String(memberEmail).trim().toLowerCase();
  const trimmedName = String(profile.name).trim();
  const normalizedBio = profile.bio?.trim() ? profile.bio.trim() : null;
  const normalizedProfileImageUrl = profile.profileImageUrl?.trim() ? profile.profileImageUrl.trim() : null;

  const memberExists = await pool.query(
    `
      SELECT 1
      FROM roster
      WHERE club_id = $1
        AND member_email = $2
      LIMIT 1
    `,
    [clubId, normalizedEmail],
  );

  if (memberExists.rowCount === 0) {
    throw new Error('Selected member is not on this club roster.');
  }

  await pool.query(
    `
      UPDATE meeting_schedule_assignments
      SET member_name = $3
      WHERE club_id = $1
        AND member_email = $2
    `,
    [clubId, normalizedEmail, trimmedName],
  );

  const account = await getAccountByEmail(normalizedEmail);
  await upsertAccount(normalizedEmail, trimmedName, {
    setupComplete: account?.setupComplete ?? false,
    password: account?.password ?? null,
    bossScore: account?.bossScore ?? 100,
    notificationPreferences: account?.notificationPreferences,
    bio: normalizedBio,
    profileImageUrl: normalizedProfileImageUrl,
  });
};

const syncRosterRoles = async (
  clubId: string,
  clubName: string,
  roster: Array<Pick<ClubMemberRecord, 'email' | 'roles' | 'eligibleRoles'>>,
) => {
  for (const member of roster) {
    const normalizedEmail = String(member.email).trim().toLowerCase();
    const normalizedRoles = parseRoles(member.roles);

    const updateResult = member.eligibleRoles
      ? await pool.query(
          `
            UPDATE roster
            SET roles = $3::jsonb,
                eligible_roles = $4::jsonb
            WHERE club_id = $1
              AND member_email = $2
          `,
          [clubId, normalizedEmail, JSON.stringify(normalizedRoles), JSON.stringify(parseEligibleRoles(member.eligibleRoles))],
        )
      : await pool.query(
          `
            UPDATE roster
            SET roles = $3::jsonb
            WHERE club_id = $1
              AND member_email = $2
          `,
          [clubId, normalizedEmail, JSON.stringify(normalizedRoles)],
        );

    if (updateResult.rowCount && updateResult.rowCount > 0) {
      await upsertMembership(normalizedEmail, {
        clubId,
        clubName,
        roles: normalizedRoles,
      });
    }
  }
};

const getMemberAvailabilityForDate = (
  members: Member[],
  memberId: string | null | undefined,
  meetingDate: string,
): AvailabilityStatus => {
  if (!memberId) {
    return 'always';
  }

  const member = members.find((entry) => entry.id === memberId);
  if (!member) {
    return 'always';
  }

  return member.availability[meetingDate] ?? member.availabilityDefault ?? 'always';
};

const calculateAttendancePoints = (
  status: AttendanceVerificationRecord['status'],
  roleKey: RoleKey | undefined,
  availabilityStatus: AvailabilityStatus | undefined,
) => {
  if (status === 'fulfilled') {
    return 5;
  }

  if (status === 'tentativeNoShow' || availabilityStatus === 'tentative') {
    return 0;
  }

  return getAttendancePenalty(roleKey);
};

const saveAttendanceRecords = async (
  clubId: string,
  meetingDate: string,
  records: Array<AttendanceVerificationRecord & { availabilityStatus?: AvailabilityStatus }>,
) => {
  const previous = await getAttendanceVerifications(clubId, meetingDate);

  for (const record of records) {
    if (!record.memberEmail) {
      continue;
    }

    const nextPoints = calculateAttendancePoints(record.status, record.roleKey, record.availabilityStatus);
    const prior = previous.get(record.role);
    const priorPoints = prior?.pointsDelta ?? 0;
    const delta = nextPoints - priorPoints;

    if (delta !== 0) {
      const account = await getAccountByEmail(record.memberEmail);
      if (account) {
        await upsertAccount(record.memberEmail, account.name, {
          bossScore: account.bossScore + delta,
          setupComplete: account.setupComplete,
          password: account.password ?? null,
          notificationPreferences: account.notificationPreferences,
        });
      }
    }

    await pool.query(
      `
        INSERT INTO meeting_attendance_verifications (club_id, meeting_date, role, member_email, status, points_delta)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (club_id, meeting_date, role)
        DO UPDATE SET
          member_email = EXCLUDED.member_email,
          status = EXCLUDED.status,
          points_delta = EXCLUDED.points_delta
      `,
      [clubId, meetingDate, record.role, record.memberEmail, record.status, nextPoints],
    );
  }
};

const buildSeededAttendanceStatus = (
  assignment: { role: string; roleKey?: RoleKey; memberId: string | null; memberEmail?: string | null },
  availabilityStatus: AvailabilityStatus,
  meetingIndex: number,
) => {
  const fingerprint = `${assignment.memberEmail ?? ''}:${assignment.role}:${meetingIndex}`;
  const score = Array.from(fingerprint).reduce((total, character) => total + character.charCodeAt(0), 0);

  if (availabilityStatus === 'tentative') {
    return score % 3 === 0 ? 'tentativeNoShow' : 'fulfilled';
  }

  if (isMajorRoleKey(assignment.roleKey)) {
    return score % 19 === 0 ? 'noShow' : 'fulfilled';
  }

  return score % 7 === 0 ? 'noShow' : 'fulfilled';
};

const seedAttendanceHistoryForClub = async (clubId: string, numberOfWeeks = 4) => {
  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const meetingDates = buildPastMeetingDates(numberOfWeeks).reverse();
  const pastAssignments: ReturnType<typeof generateSchedule>['assignments'] = [];

  for (const [index, meetingDate] of meetingDates.entries()) {
    const meeting = buildMeetingForClub(clubId, agenda?.agenda, meetingDate, index);
    const schedule = generateSchedule(meeting, members, pastAssignments);
    pastAssignments.push(...schedule.assignments);

    const records = schedule.assignments
      .map((assignment) => ({
        assignment,
        member: assignment.memberId ? members.find((entry) => entry.id === assignment.memberId) ?? null : null,
      }))
      .filter(({ assignment, member }) => assignment.memberId && member?.email)
      .map(({ assignment, member }) => {
        const availabilityStatus = getMemberAvailabilityForDate(members, assignment.memberId, meetingDate);
        return {
          role: assignment.role,
          roleKey: assignment.roleKey,
          memberEmail: member?.email ?? null,
          memberName: assignment.memberName,
          status: buildSeededAttendanceStatus(assignment, availabilityStatus, index),
          pointsDelta: 0,
          availabilityStatus,
        } satisfies AttendanceVerificationRecord & { availabilityStatus: AvailabilityStatus };
      });

    await saveAttendanceRecords(clubId, meetingDate, records);
  }

  return meetingDates;
};

const sanitizeUserForResponse = (account: UserAccount) => ({
  id: account.id,
  name: account.name,
  email: account.email,
  bossScore: account.bossScore,
  setupComplete: account.setupComplete,
  memberships: filterToSupportedMemberships(account.memberships).map((membership) =>
    getEffectiveMembershipForAccount(account, membership),
  ),
  bio: account.bio ?? null,
  profileImageUrl: account.profileImageUrl ?? null,
  notificationPreferences: account.notificationPreferences,
});

const ensureDefaultMemberAccounts = async () => {
  for (const [email, config] of Object.entries(MEMBER_DEFAULT_ACCOUNT_PASSWORDS)) {
    const account = await getAccountByEmail(email);
    if (!account || (account.setupComplete && account.password)) {
      continue;
    }

    await upsertAccount(email, account.name, {
      setupComplete: config.setupComplete,
      password: config.password,
      bossScore: account.bossScore,
      notificationPreferences: account.notificationPreferences,
      bio: account.bio ?? null,
      profileImageUrl: account.profileImageUrl ?? null,
      overwriteProfile: false,
    });
  }
};

const ensureAuthorizedMembership = async (email: string | undefined, clubId: string, allowedRoles: UserRole[]) => {
  if (clubId !== IDTT_CLUB_ID) {
    return { error: 'ToastBoss is currently configured for IDTT only.', status: 403 as const };
  }

  if (!email) {
    return { error: 'User email is required for this action.', status: 400 as const };
  }

  const account = await getAccountByEmail(email);
  if (!account) {
    return { error: 'No ToastBoss account was found for that email.', status: 404 as const };
  }

  const membership = account.memberships.find((entry) => entry.clubId === clubId);
  if (!membership) {
    return { error: 'This account does not belong to that club.', status: 403 as const };
  }

  const effectiveMembership = getEffectiveMembershipForAccount(account, membership);

  if (!allowedRoles.some((role) => effectiveMembership.roles.includes(role))) {
    return { error: 'This account does not have permission for that action.', status: 403 as const };
  }

  return { account, membership: effectiveMembership };
};

const seedInitialData = async () => {
  await upsertClub(sampleMeeting.clubId, IDTT_CLUB_NAME, defaultAgenda());

  const existingClub = await getClubRoster(sampleMeeting.clubId);
  if (existingClub && existingClub.roster.length > 0) {
    const bundledRoster = loadBundledRosterEntries();
    if (bundledRoster.length > 0) {
      await syncRosterRoles(sampleMeeting.clubId, IDTT_CLUB_NAME, bundledRoster);
    }
  } else {
    const bundledRoster = loadBundledRosterEntries();
    if (bundledRoster.length > 0) {
      await replaceRoster(sampleMeeting.clubId, IDTT_CLUB_NAME, bundledRoster.map((member, index) => ({
        id: member.id || `roster-${index + 1}`,
        name: member.name,
        email: member.email,
        roles: member.roles,
        eligibleRoles: [...allEligibleRoles],
      })));
    } else {
      for (const member of sampleMembers) {
        await upsertAccount(member.email, member.name, {
          setupComplete: false,
          bossScore: member.bossScore,
          password: null,
        });

        await upsertMembership(member.email, {
          clubId: member.clubId,
          clubName: IDTT_CLUB_NAME,
          roles: ['member'],
        });
      }

      await replaceRoster(sampleMeeting.clubId, IDTT_CLUB_NAME, sampleMembers.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        roles: ['member'],
        eligibleRoles: member.eligibleRoles,
      })));
    }
  }

  await ensureDefaultMemberAccounts();
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ToastBoss backend' });
});

app.get('/api/admin/status', async (_req, res) => {
  await upsertClub(IDTT_CLUB_ID, IDTT_CLUB_NAME, defaultAgenda());
  const adminAccount = await getAdminAccountForClub(IDTT_CLUB_ID);

  return res.json({
    initialized: Boolean(adminAccount),
    clubId: IDTT_CLUB_ID,
    clubName: IDTT_CLUB_NAME,
    admin: adminAccount
      ? {
          name: adminAccount.name,
          email: adminAccount.email,
        }
      : null,
  });
});

app.post('/api/admin/setup', async (req, res) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  const existingAdmin = await getAdminAccountForClub(IDTT_CLUB_ID);
  if (existingAdmin) {
    return res.status(409).json({ error: 'The admin account has already been set up.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const adminRoles: UserRole[] = ['member', 'admin'];

  await upsertClub(IDTT_CLUB_ID, IDTT_CLUB_NAME, defaultAgenda());
  await upsertAccount(normalizedEmail, String(name).trim(), {
    setupComplete: true,
    password,
  });
  await upsertMembership(normalizedEmail, {
    clubId: IDTT_CLUB_ID,
    clubName: IDTT_CLUB_NAME,
    roles: adminRoles,
  });
  await replaceRoster(IDTT_CLUB_ID, IDTT_CLUB_NAME, [
    {
      id: `acct-${slugify(normalizedEmail)}`,
      name: String(name).trim(),
      email: normalizedEmail,
      roles: adminRoles,
      eligibleRoles: [...allEligibleRoles],
    },
  ]);

  const adminAccount = await getAccountByEmail(normalizedEmail);
  return res.json({
    message: 'Admin account created.',
    user: sanitizeUserForResponse(adminAccount as UserAccount),
  });
});

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const account = await getAccountByEmail(String(email).trim().toLowerCase());
  if (!account) {
    return res.status(404).json({ error: 'No admin account was found for that email.' });
  }

  const membership = account.memberships.find((entry) => entry.clubId === IDTT_CLUB_ID);

  if (!membership || !hasRestrictedAdminAccess(membership.roles, account.email, account.name)) {
    return res.status(403).json({ error: 'This account does not have admin access.' });
  }

  if (!account.setupComplete) {
    return res.status(409).json({ error: 'This admin account still needs setup.' });
  }

  if (account.password) {
    const isHashed = account.password.startsWith('$2b$') || account.password.startsWith('$2a$');
    const valid = isHashed
      ? await bcrypt.compare(String(password ?? ''), account.password)
      : String(password ?? '') === account.password;
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    if (!isHashed) {
      await upsertAccount(account.email, account.name, { password: String(password) });
    }
  }

  await logPortalActivityForMemberships(account, 'admin');

  return res.json({
    message: 'Welcome back.',
    user: sanitizeUserForResponse(account),
  });
});

app.get('/api/admin/members', async (req, res) => {
  const email = req.query.email as string | undefined;
  const auth = await ensureAuthorizedMembership(email, IDTT_CLUB_ID, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  return res.json({
    clubId: IDTT_CLUB_ID,
    clubName: IDTT_CLUB_NAME,
    members: await getAdminMemberList(IDTT_CLUB_ID),
  });
});

app.post('/api/auth/magic-link', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  return res.json({ message: `Magic link sent to ${email}`, email });
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const isOnRoster = await isEmailOnClubRoster(IDTT_CLUB_ID, normalizedEmail);

  if (!isOnRoster) {
    return res.status(404).json({
      error: 'This email address is not registered with the club. Please contact club leadership for assistance.',
    });
  }

  const account = await getAccountByEmail(normalizedEmail);

  if (!account?.setupComplete) {
    return res.status(409).json({
      error: 'This email is on the club roster, but the member portal account has not been set up yet. Please create your member account first.',
    });
  }

  try {
    const token = await createPasswordResetToken(normalizedEmail);
    const resetLink = buildPasswordResetLink(normalizedEmail, token);
    await sendPasswordResetEmail(normalizedEmail, resetLink);
  } catch (error) {
    console.error('Password reset request failed:', error);
    return res.status(500).json({ error: 'Unable to send a password reset email right now.' });
  }

  return res.json({
    message: 'A link to reset your password has been sent.',
  });
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  const { email, token, password } = req.body as { email?: string; token?: string; password?: string };
  if (!email || !token || !password) {
    return res.status(400).json({ error: 'Email, reset token, and new password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const account = await getAccountByEmail(normalizedEmail);
  if (!account || !account.setupComplete) {
    return res.status(400).json({ error: 'That password reset link is invalid or expired.' });
  }

  const consumed = await consumePasswordResetToken(normalizedEmail, token);
  if (!consumed) {
    return res.status(400).json({ error: 'That password reset link is invalid or expired.' });
  }

  await upsertAccount(normalizedEmail, account.name, {
    setupComplete: true,
    password: String(password),
    bossScore: account.bossScore,
    notificationPreferences: account.notificationPreferences,
    bio: account.bio ?? null,
    profileImageUrl: account.profileImageUrl ?? null,
  });

  const updatedAccount = await getAccountByEmail(normalizedEmail);
  return res.json({
    message: 'Your password has been reset.',
    user: updatedAccount ? sanitizeUserForResponse(updatedAccount) : undefined,
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const account = await getAccountByEmail(normalizedEmail);
  if (account) {
    if (account.memberships.length === 0) {
      return res.status(403).json({ error: 'ToastBoss is currently configured for IDTT members only.' });
    }

    if (!account.setupComplete) {
      return res.status(409).json({
        error: 'This account still needs to finish setup before signing in.',
        redirectTo: '/activate-account',
        account: sanitizeUserForResponse(account),
      });
    }

    if (account.password) {
      const isHashed = account.password.startsWith('$2b$') || account.password.startsWith('$2a$');
      const valid = isHashed
        ? await bcrypt.compare(String(password ?? ''), account.password)
        : String(password ?? '') === account.password;
      if (!valid) {
        return res.status(401).json({ error: 'Incorrect password for this ToastBoss account.' });
      }
      if (!isHashed) {
        await upsertAccount(account.email, account.name, { password: String(password) });
      }
    }

    await logPortalActivityForMemberships(account, 'member');

    return res.json({ user: sanitizeUserForResponse(account) });
  }

  return res.status(404).json({ error: 'No ToastBoss member was found for that email address.' });
});

app.post('/api/auth/member-signup', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required to create a member account.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const account = await getAccountByEmail(normalizedEmail);

  if (account) {
    if (account.setupComplete) {
      return res.status(409).json({ error: 'This member account already exists. Please sign in instead.' });
    }

    try {
      const token = await createVerificationToken(normalizedEmail);
      const verificationLink = buildVerificationLink(normalizedEmail, token);
      await sendVerificationEmail(normalizedEmail, account.name, verificationLink);
    } catch (error) {
      console.error('Verification email failed for existing partial account:', error);
      return res.status(500).json({ error: 'Unable to send a verification email right now.' });
    }

    return res.json({ message: 'A verification link has been sent to your email.' });
  }

  const pending = await ensurePendingSetupAccount(IDTT_CLUB_ID, normalizedEmail);
  if (!pending.account) {
    const pendingError = pending.error ?? 'Unable to start member signup right now.';
    return res.status(pendingError.includes('roster') ? 404 : 500).json({ error: pendingError });
  }
  const pendingAccount = pending.account;

  try {
    const token = await createVerificationToken(normalizedEmail);
    const verificationLink = buildVerificationLink(normalizedEmail, token);
    await sendVerificationEmail(normalizedEmail, pendingAccount.name, verificationLink);
  } catch (error) {
    console.error('Verification email failed for new signup:', error);
    return res.status(500).json({ error: 'Unable to send a verification email right now.' });
  }

  return res.json({ message: 'A verification link has been sent to your email.' });
});

app.post('/api/auth/member-signup/verify', async (req, res) => {
  const { email, token } = req.body as { email?: string; token?: string };

  if (!email || !token) {
    return res.status(400).json({ error: 'Email and verification token are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const valid = await validateVerificationToken(normalizedEmail, String(token));

  if (!valid) {
    return res.status(400).json({ error: 'That verification link is invalid or has expired. Request a new one.' });
  }

  const account = await getAccountByEmail(normalizedEmail);

  if (!account) {
    return res.status(404).json({ error: 'No pending account was found for that email.' });
  }

  if (account.setupComplete) {
    return res.status(409).json({ error: 'This account is already set up. Please sign in instead.' });
  }

  return res.json({
    message: 'Email verified. Continue setting up your account.',
    account: sanitizeUserForResponse(account),
  });
});

app.post('/api/auth/complete-setup', async (req, res) => {
  const { email, password, name, emailReminders, swapAlerts, verifyToken } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required to finish account setup.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  if (verifyToken) {
    const consumed = await consumeVerificationToken(normalizedEmail, String(verifyToken));
    if (!consumed) {
      return res.status(400).json({ error: 'That verification link is invalid or has expired. Please request a new one.' });
    }
  }

  const account = await getAccountByEmail(normalizedEmail);
  if (!account) {
    return res.status(404).json({ error: 'No pending ToastBoss account was found for that email.' });
  }

  await upsertAccount(normalizedEmail, name || account.name, {
    setupComplete: true,
    bossScore: account.bossScore,
    password,
    notificationPreferences: {
      emailReminders: emailReminders !== false,
      swapAlerts: swapAlerts !== false,
    },
  });

  const updatedAccount = await getAccountByEmail(normalizedEmail);
  if (updatedAccount) {
    await logAccountSetupForMemberships(updatedAccount);
  }
  return res.json({
    message: `Account setup complete for ${updatedAccount?.name ?? account.name}.`,
    user: sanitizeUserForResponse(updatedAccount ?? account),
  });
});

app.put('/api/clubs/:clubId/profile', async (req, res) => {
  const { clubId } = req.params;
  const {
    email,
    targetEmail,
    name,
    bio,
    profileImageUrl,
  } = req.body as {
    email?: string;
    targetEmail?: string;
    name?: string;
    bio?: string | null;
    profileImageUrl?: string | null;
  };

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'A display name is required.' });
  }

  const club = await getClubRoster(clubId);
  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const normalizedTargetEmail = String(targetEmail ?? email ?? '').trim().toLowerCase();
  if (!normalizedTargetEmail) {
    return res.status(400).json({ error: 'Target member email is required.' });
  }

  const isSelfEdit = auth.account.email.toLowerCase() === normalizedTargetEmail;
  const isAdmin = auth.membership.roles.includes('admin');
  if (!isSelfEdit && !isAdmin) {
    return res.status(403).json({ error: 'Only admins can edit another member profile.' });
  }

  try {
    await setMemberProfile(clubId, normalizedTargetEmail, {
      name: String(name).trim(),
      bio: bio ?? null,
      profileImageUrl: profileImageUrl ?? null,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? 'Unable to update that member profile.' });
  }
  const updatedAccount = await getAccountByEmail(auth.account.email);

  return res.json({
    message: isSelfEdit ? 'Your profile has been updated.' : 'Member profile has been updated.',
    user: sanitizeUserForResponse(updatedAccount ?? auth.account),
    club: await getClubRoster(clubId),
  });
});

app.post('/api/clubs/setup', async (req, res) => {
  return res.status(403).json({
    error: 'ToastBoss is currently configured for IDTT only. New club setup is disabled for now.',
  });
});

app.get('/api/clubs/:clubId/roster', async (req, res) => {
  const { clubId } = req.params;
  const club = await getClubRoster(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(req.query.email as string | undefined, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  return res.json({ club });
});

app.get('/api/clubs/:clubId/activity', async (req, res) => {
  const { clubId } = req.params;
  const auth = await ensureAuthorizedMembership(req.query.email as string | undefined, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const requestedLimit = Number(req.query.limit ?? 100);
  const activities = await getRecentClubActivity(clubId, Number.isFinite(requestedLimit) ? requestedLimit : 100);
  const members = await getClubActivityMemberStatuses(clubId);
  return res.json({ activities, members });
});

app.post('/api/clubs/:clubId/member-setup-link', async (req, res) => {
  const { clubId } = req.params;
  const { email, targetEmail } = req.body as { email?: string; targetEmail?: string };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const normalizedTargetEmail = String(targetEmail ?? '').trim().toLowerCase();
  if (!normalizedTargetEmail) {
    return res.status(400).json({ error: 'Target member email is required.' });
  }

  const pending = await ensurePendingSetupAccount(clubId, normalizedTargetEmail);
  if (!pending.account) {
    const pendingError = pending.error ?? 'Unable to create a setup link right now.';
    const lower = pendingError.toLowerCase();
    const status = lower.includes('already set up') ? 409 : lower.includes('roster') ? 404 : 500;
    return res.status(status).json({ error: pendingError });
  }
  const pendingAccount = pending.account;

  const token = await createVerificationToken(normalizedTargetEmail);
  const setupUrl = buildVerificationLink(normalizedTargetEmail, token);

  return res.json({
    memberName: pendingAccount.name,
    memberEmail: normalizedTargetEmail,
    setupUrl,
  });
});

app.put('/api/clubs/:clubId/availability', async (req, res) => {
  const { clubId } = req.params;
  const {
    email,
    targetEmail,
    availabilityDefault,
    availabilityOverrides,
    eligibleRoles,
  } = req.body as {
    email?: string;
    targetEmail?: string;
    availabilityDefault?: AvailabilityStatus;
    availabilityOverrides?: Record<string, AvailabilityStatus>;
    eligibleRoles?: RoleKey[];
  };

  const club = await getClubRoster(clubId);
  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const normalizedTargetEmail = String(targetEmail ?? email ?? '').trim().toLowerCase();
  if (!normalizedTargetEmail) {
    return res.status(400).json({ error: 'Target member email is required.' });
  }

  const isSelfEdit = auth.account.email.toLowerCase() === normalizedTargetEmail;
  const isAdmin = auth.membership.roles.includes('admin');
  if (!isSelfEdit && !isAdmin) {
    return res.status(403).json({ error: 'Only admins can edit another member availability.' });
  }

  const parsedAvailabilityDefault = parseAvailabilityDefault(availabilityDefault);
  const parsedAvailabilityOverrides = parseAvailabilityOverrides(availabilityOverrides);
  const targetMember = club.roster.find((member) => member.email.toLowerCase() === normalizedTargetEmail);
  const targetMemberName = targetMember ? targetMember.name : deriveDisplayNameFromEmail(normalizedTargetEmail);

  await setMemberAvailability(
    clubId,
    normalizedTargetEmail,
    parsedAvailabilityDefault,
    parsedAvailabilityOverrides,
  );
  if (eligibleRoles) {
    await setMemberEligibleRoles(clubId, normalizedTargetEmail, parseEligibleRoles(eligibleRoles));
  }

  await logClubActivity(
    clubId,
    auth.account.email,
    normalizedTargetEmail,
    'availabilityUpdated',
    isSelfEdit
      ? `${auth.account.name} updated availability.`
      : `${auth.account.name} updated availability for ${targetMemberName}.`,
    {
      targetEmail: normalizedTargetEmail,
      targetName: targetMemberName,
      defaultStatus: parsedAvailabilityDefault,
      overrideCount: Object.keys(parsedAvailabilityOverrides).length,
      updatedByAdmin: !isSelfEdit,
      eligibleRolesUpdated: Array.isArray(eligibleRoles),
    },
  );

  return res.json({
    message: `Availability updated for ${normalizedTargetEmail}.`,
    club: await getClubRoster(clubId),
  });
});

app.put('/api/clubs/:clubId/roster', async (req, res) => {
  const { clubId } = req.params;
  const { email, roster } = req.body as { email?: string; roster?: ClubMemberRecord[] };
  const club = await getClubRoster(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!Array.isArray(roster) || roster.length === 0) {
    return res.status(400).json({ error: 'Updated roster data is required.' });
  }

  const normalizedRoster = roster.map((member, index) => ({
    id: member.id || `roster-${index + 1}`,
    name: member.name,
    email: member.email,
    phoneNumber: member.phoneNumber ?? null,
    currentPosition: typeof member.currentPosition === 'string' ? member.currentPosition : null,
    roles: parseRoles(member.roles),
    eligibleRoles: parseEligibleRoles(member.eligibleRoles),
    bossScore: Number(member.bossScore) || 100,
    calledOut: Boolean(member.calledOut),
    availabilityDefault: parseAvailabilityDefault(member.availabilityDefault),
    availabilityOverrides: parseAvailabilityOverrides(member.availabilityOverrides),
  }));

  await pool.query('DELETE FROM memberships WHERE club_id = $1', [clubId]);
  await replaceRoster(clubId, club.name, normalizedRoster);
  const meetingDate = await getMeetingDateForClub(clubId);
  await pool.query('DELETE FROM meeting_callouts WHERE club_id = $1 AND meeting_date = $2', [clubId, meetingDate]);
  for (const member of normalizedRoster) {
    await updateMemberBossScore(member.email, member.name, Number(member.bossScore) || 100);
    await setMeetingCallout(clubId, meetingDate, member.email, Boolean(member.calledOut));
    await setMemberAvailability(
      clubId,
      member.email,
      parseAvailabilityDefault(member.availabilityDefault),
      parseAvailabilityOverrides(member.availabilityOverrides),
    );
    await setMemberEligibleRoles(clubId, member.email, parseEligibleRoles(member.eligibleRoles));
  }

  return res.json({
    message: `Roster updated for ${club.name}.`,
    club: await getClubRoster(clubId),
  });
});

app.post('/api/clubs/:clubId/roster/import', async (req, res) => {
  const { clubId } = req.params;
  const { email, rosterText } = req.body as { email?: string; rosterText?: string };
  const club = await getClubRoster(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!rosterText?.trim()) {
    return res.status(400).json({ error: 'Roster CSV text is required.' });
  }

  const rosterEntries = parseRosterEntries(rosterText);
  if (rosterEntries.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one valid roster email.' });
  }

  const existingRosterByEmail = new Map(
    club.roster.map((member) => [member.email.toLowerCase(), member]),
  );

  const normalizedRoster: ClubMemberRecord[] = rosterEntries.map((entry, index) => {
    const existing = existingRosterByEmail.get(entry.email.toLowerCase());
    return {
      id: existing?.id || entry.id || `roster-${index + 1}`,
      name: entry.name,
      email: entry.email,
      phoneNumber: entry.phoneNumber || existing?.phoneNumber || null,
      currentPosition: entry.currentPosition || existing?.currentPosition || null,
      roles: parseRoles([...(existing?.roles ?? []), ...entry.roles]),
      eligibleRoles: parseEligibleRoles(existing?.eligibleRoles),
      bossScore: existing?.bossScore ?? 100,
      calledOut: existing?.calledOut ?? false,
      availabilityDefault: existing?.availabilityDefault ?? 'always',
      availabilityOverrides: existing?.availabilityOverrides ?? {},
    };
  });

  if (!normalizedRoster.some((member) => member.email.toLowerCase() === auth.account.email.toLowerCase())) {
    normalizedRoster.unshift({
      id: auth.account.id,
      name: auth.account.name,
      email: auth.account.email,
      phoneNumber: club.roster.find((member) => member.email.toLowerCase() === auth.account.email.toLowerCase())?.phoneNumber ?? null,
      currentPosition: club.roster.find((member) => member.email.toLowerCase() === auth.account.email.toLowerCase())?.currentPosition ?? null,
      roles: auth.membership.roles,
      eligibleRoles: [...allEligibleRoles],
      bossScore: auth.account.bossScore,
      calledOut: false,
      availabilityDefault: 'always',
      availabilityOverrides: {},
    });
  }

  await pool.query('DELETE FROM memberships WHERE club_id = $1', [clubId]);
  await replaceRoster(clubId, club.name, normalizedRoster);

  return res.json({
    message: `Roster imported for ${club.name}. ${normalizedRoster.length} members are now on the club roster.`,
    club: await getClubRoster(clubId),
  });
});

app.get('/api/clubs/:clubId/agenda', async (req, res) => {
  const { clubId } = req.params;
  const email = req.query.email as string | undefined;
  const club = await getClubAgenda(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const isMeetingToastmaster = email ? await isScheduledToastmasterForUpcomingMeeting(email, clubId) : false;

  return res.json({ club, isMeetingToastmaster });
});

app.put('/api/clubs/:clubId/agenda', async (req, res) => {
  const { clubId } = req.params;
  const { email, agenda } = req.body as { email?: string; agenda?: AgendaItem[] };
  const club = await getClubAgenda(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const isAdmin = auth.membership.roles.includes('admin');
  if (!isAdmin) {
    const isTM = email ? await isScheduledToastmasterForUpcomingMeeting(email, clubId) : false;
    if (!isTM) {
      return res.status(403).json({ error: 'Only admins and the scheduled toastmaster can edit the agenda.' });
    }
  }

  if (!Array.isArray(agenda) || agenda.length === 0) {
    return res.status(400).json({ error: 'Updated agenda items are required.' });
  }

  const normalizedAgenda = agenda.map((item, index) => ({
    id: item.id || `agenda-${index + 1}`,
    title: item.title,
    role: item.role as RoleKey | 'custom',
    durationMinutes: Number(item.durationMinutes) || 0,
    notes: item.notes ?? '',
    minBossScore: Number(item.minBossScore) || 0,
    priority:
      item.priority === 'high' || item.priority === 'flexible' || item.priority === 'standard'
        ? item.priority
        : 'standard',
    optional: Boolean(item.optional),
    evaluatorMode:
      item.evaluatorMode === 'roundRobin' || item.evaluatorMode === 'individual'
        ? item.evaluatorMode
        : 'individual' as AgendaEvaluatorMode,
    meetingMode: parseMeetingMode(item.meetingMode),
  }));

  await pool.query('UPDATE clubs SET agenda = $2::jsonb WHERE id = $1', [clubId, JSON.stringify(normalizedAgenda)]);

  return res.json({
    message: `Agenda updated for ${club.name}.`,
    club: await getClubAgenda(clubId),
  });
});

const getClubFlag = async (clubId: string, flagName: string): Promise<string | null> => {
  const result = await pool.query(
    `SELECT flag_value FROM system_flags WHERE flag_key = $1`,
    [`${clubId}:${flagName}`],
  );
  return (result.rows[0]?.flag_value as string | null) ?? null;
};

const setClubFlag = async (clubId: string, flagName: string, value: string | null) => {
  if (value === null) {
    await pool.query(`DELETE FROM system_flags WHERE flag_key = $1`, [`${clubId}:${flagName}`]);
  } else {
    await pool.query(
      `INSERT INTO system_flags (flag_key, flag_value) VALUES ($1, $2)
       ON CONFLICT (flag_key) DO UPDATE SET flag_value = EXCLUDED.flag_value`,
      [`${clubId}:${flagName}`, value],
    );
  }
};

app.put('/api/clubs/:clubId/settings', async (req, res) => {
  const { clubId } = req.params;
  const { email, hideUnlockedAgendas } = req.body as { email?: string; hideUnlockedAgendas?: boolean };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  await setClubFlag(clubId, 'hide_unlocked_agendas', hideUnlockedAgendas ? 'true' : null);

  return res.json({ message: 'Club settings updated.', hideUnlockedAgendas: !!hideUnlockedAgendas });
});

app.get('/api/engine/schedule', async (req, res) => {
  const clubId = req.query.clubId as string | undefined;
  const email = req.query.email as string | undefined;
  const requestedWeeks = Number(req.query.weeks ?? 4);
  const numberOfWeeks = Number.isFinite(requestedWeeks)
    ? Math.max(1, Math.min(12, Math.floor(requestedWeeks)))
    : 4;

  if (!clubId) {
    return res.status(400).json({ error: 'Club ID is required to generate a schedule.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  if (members.length === 0) {
    return res.status(400).json({ error: 'Add club members before generating a schedule.' });
  }

  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, numberOfWeeks);
  const schedules = await generateSchedulesWithLocks(clubId, meetings, members);
  const roleConfirmations = await getRoleConfirmationMap(clubId, meetings.map((meeting) => meeting.date));

  const themesResult = await pool.query(
    `SELECT meeting_date, theme, pdf_style, pdf_color, notes FROM meeting_themes WHERE club_id = $1 AND meeting_date = ANY($2)`,
    [clubId, meetings.map((m) => m.date)],
  );
  const themeMap = new Map<string, { theme: string | null; pdfColor: string | null; notes: string | null }>(
    (
      themesResult.rows as Array<{ meeting_date: string; theme: string | null; pdf_style: string | null; pdf_color: string | null; notes: string | null }>
    ).map((row) => [
      row.meeting_date,
      {
        theme: row.theme,
        pdfColor: row.pdf_color,
        notes: row.notes,
      },
    ]),
  );

  const speechResult = await pool.query(
    `SELECT meeting_date, slot_id, speech_title, speech_time FROM speech_details
     WHERE club_id = $1 AND meeting_date = ANY($2)`,
    [clubId, meetings.map((m) => m.date)],
  );
  const speechMap = new Map<string, { speechTitle: string | null; speechTime: string | null }>(
    (speechResult.rows as Array<{ meeting_date: string; slot_id: string; speech_title: string | null; speech_time: string | null }>).map(
      (row) => [`${row.meeting_date}|${row.slot_id}`, { speechTitle: row.speech_title, speechTime: row.speech_time }],
    ),
  );

  const upcomingMeetings = meetings.map((meeting, index) => {
    const themeDetails = themeMap.get(meeting.date) ?? null;

    return {
      meetingId: meeting.id,
      meetingDate: meeting.date,
      theme: themeDetails?.theme ?? null,
      pdfColor: themeDetails?.pdfColor ?? null,
      notes: themeDetails?.notes ?? null,
      assignments: schedules[index].assignments.map((assignment, assignmentIndex) => {
      const slotId = assignment.slotId ?? `slot-${assignmentIndex + 1}`;
      const memberEmail = String(assignment.memberEmail ?? '').trim().toLowerCase();
      const confirmedAt = memberEmail
        ? roleConfirmations.get(`${meeting.date}|${slotId}|${memberEmail}`) ?? null
        : null;
      const speechDetail = speechMap.get(`${meeting.date}|${slotId}`) ?? null;
      return {
        ...assignment,
        confirmedAt,
        speechTitle: speechDetail?.speechTitle ?? null,
        speechTime: speechDetail?.speechTime ?? null,
      };
      }),
      fairness: schedules[index].fairness,
      locked: schedules[index].locked,
    };
  });
  const hideUnlockedFlag = await getClubFlag(clubId, 'hide_unlocked_agendas');
  const hideUnlockedAgendas = hideUnlockedFlag === 'true';
  const isAdmin = auth.membership.roles.includes('admin');

  const visibleMeetings = hideUnlockedAgendas && !isAdmin
    ? upcomingMeetings.filter((m) => m.locked)
    : upcomingMeetings;

  const firstMeeting = visibleMeetings[0] ?? upcomingMeetings[0];

  return res.json({
    clubId,
    clubName: auth.membership.clubName,
    meetingId: firstMeeting?.meetingId,
    meetingDate: firstMeeting?.meetingDate,
    assignments: firstMeeting?.assignments ?? [],
    fairness: firstMeeting?.fairness,
    meetings: visibleMeetings,
    hideUnlockedAgendas,
  });
});

app.post('/api/clubs/:clubId/schedule/confirm-role', async (req, res) => {
  const { clubId } = req.params;
  const {
    email,
    meetingDate,
    slotId,
    confirmed,
    targetEmail,
  } = req.body as {
    email?: string;
    meetingDate?: string;
    slotId?: string;
    confirmed?: boolean;
    targetEmail?: string;
  };

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const isAdmin = auth.membership.roles.includes('admin');

  if (!meetingDate || !slotId) {
    return res.status(400).json({ error: 'Meeting date and slot ID are required.' });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, 12);
  const schedules = await generateSchedulesWithLocks(clubId, meetings, members);
  const meetingIndex = meetings.findIndex((meeting) => meeting.date === meetingDate);

  if (meetingIndex < 0) {
    return res.status(404).json({ error: 'That meeting was not found in the upcoming schedule.' });
  }

  const assignment = schedules[meetingIndex].assignments.find((entry) => entry.slotId === slotId);
  if (!assignment || !assignment.memberEmail) {
    return res.status(404).json({ error: 'That role is not currently assigned.' });
  }

  const isOwnRole = assignment.memberEmail.toLowerCase() === auth.account.email.toLowerCase();
  if (!isOwnRole && !isAdmin) {
    return res.status(403).json({ error: 'You can only confirm your own assigned role.' });
  }

  if (targetEmail && !isAdmin) {
    return res.status(403).json({ error: 'Only admins can confirm roles on behalf of members.' });
  }

  if (confirmed === false) {
    await pool.query(
      `
        DELETE FROM meeting_role_confirmations
        WHERE club_id = $1
          AND meeting_date = $2
          AND slot_id = $3
      `,
      [clubId, meetingDate, slotId],
    );

    await logClubActivity(
      clubId,
      auth.account.email,
      assignment.memberEmail.toLowerCase(),
      'roleConfirmationRemoved',
      `${auth.account.name} removed role confirmation for ${assignment.role} on ${meetingDate}.`,
      {
        meetingDate,
        slotId,
        role: assignment.role,
        memberEmail: assignment.memberEmail.toLowerCase(),
        memberName: assignment.memberName ?? null,
        updatedByAdmin: !isOwnRole,
      },
    );

    return res.json({
      message: `Role confirmation removed for ${meetingDate}.`,
      meetingDate,
      slotId,
      confirmedAt: null,
    });
  }

  const confirmationResult = await pool.query(
    `
      INSERT INTO meeting_role_confirmations (club_id, meeting_date, slot_id, member_email)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (club_id, meeting_date, slot_id)
      DO UPDATE SET
        member_email = EXCLUDED.member_email,
        confirmed_at = NOW()
      RETURNING confirmed_at
    `,
    [clubId, meetingDate, slotId, assignment.memberEmail.toLowerCase()],
  );

  await logClubActivity(
    clubId,
    auth.account.email,
    assignment.memberEmail.toLowerCase(),
    'roleConfirmed',
    `${auth.account.name} confirmed ${assignment.role} for ${meetingDate}.`,
    {
      meetingDate,
      slotId,
      role: assignment.role,
      memberEmail: assignment.memberEmail.toLowerCase(),
      memberName: assignment.memberName ?? null,
      updatedByAdmin: !isOwnRole,
    },
  );

  return res.json({
    message: `Role confirmed for ${meetingDate}.`,
    meetingDate,
    slotId,
    confirmedAt: new Date(confirmationResult.rows[0].confirmed_at).toISOString(),
  });
});

app.put('/api/clubs/:clubId/schedule/speech-details', async (req, res) => {
  const { clubId } = req.params;
  const { email, meetingDate, slotId, speechTitle, speechTime } = req.body as {
    email?: string;
    meetingDate?: string;
    slotId?: string;
    speechTitle?: string;
    speechTime?: string;
  };

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate || !slotId) {
    return res.status(400).json({ error: 'Meeting date and slot ID are required.' });
  }

  const title = String(speechTitle ?? '').trim();
  const time = String(speechTime ?? '').trim();

  await pool.query(
    `INSERT INTO speech_details (club_id, meeting_date, slot_id, speech_title, speech_time, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (club_id, meeting_date, slot_id)
     DO UPDATE SET speech_title = EXCLUDED.speech_title, speech_time = EXCLUDED.speech_time, updated_at = NOW()`,
    [clubId, meetingDate, slotId, title || null, time || null],
  );

  return res.json({ message: 'Speech details saved.', speechTitle: title || null, speechTime: time || null });
});

app.put('/api/clubs/:clubId/schedule/theme', async (req, res) => {
  const { clubId } = req.params;
  const { email, meetingDate, theme, pdfColor, notes } = req.body as {
    email?: string;
    meetingDate?: string;
    theme?: string;
    pdfColor?: string;
    notes?: string;
  };

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate) {
    return res.status(400).json({ error: 'Meeting date is required.' });
  }

  const trimmedTheme = String(theme ?? '').trim();
  const trimmedNotes = String(notes ?? '').trim();
  const trimmedPdfColor = String(pdfColor ?? '').trim();
  const normalizedPdfColor = /^#[0-9a-fA-F]{6}$/.test(trimmedPdfColor) ? trimmedPdfColor.toLowerCase() : null;

  if (trimmedTheme || trimmedNotes || normalizedPdfColor) {
    await pool.query(
      `INSERT INTO meeting_themes (club_id, meeting_date, theme, pdf_style, pdf_color, notes, set_by_email, updated_at)
       VALUES ($1, $2, $3, 'classic', $4, $5, $6, NOW())
       ON CONFLICT (club_id, meeting_date)
       DO UPDATE SET
         theme = EXCLUDED.theme,
         pdf_style = EXCLUDED.pdf_style,
         pdf_color = EXCLUDED.pdf_color,
         notes = EXCLUDED.notes,
         set_by_email = EXCLUDED.set_by_email,
         updated_at = NOW()`,
      [clubId, meetingDate, trimmedTheme || null, normalizedPdfColor, trimmedNotes || null, auth.account.email],
    );
  } else {
    await pool.query(
      `DELETE FROM meeting_themes WHERE club_id = $1 AND meeting_date = $2`,
      [clubId, meetingDate],
    );
  }

  return res.json({
    message: 'Meeting agenda settings updated.',
    theme: trimmedTheme || null,
    pdfColor: normalizedPdfColor,
    notes: trimmedNotes || null,
  });
});


app.post('/api/clubs/:clubId/schedule/lock', async (req, res) => {
  const { clubId } = req.params;
  const { email, meetingDate } = req.body as { email?: string; meetingDate?: string };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate) {
    return res.status(400).json({ error: 'Meeting date is required.' });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, 4);
  const schedules = await generateSchedulesWithLocks(clubId, meetings, members);
  const meetingIndex = meetings.findIndex((meeting) => meeting.date === meetingDate);

  if (meetingIndex < 0) {
    return res.status(404).json({ error: 'That meeting was not found in the next four schedules.' });
  }

  const existingDraft = await pool.query(
    `
      SELECT 1
      FROM meeting_schedule_assignments
      WHERE club_id = $1 AND meeting_date = $2
      LIMIT 1
    `,
    [clubId, meetingDate],
  );

  if (existingDraft.rowCount === 0) {
    await persistLockedSchedule(clubId, meetings[meetingIndex], schedules[meetingIndex].assignments, auth.account.email);
  } else {
    await pool.query(
      `
        INSERT INTO meeting_schedule_locks (club_id, meeting_date, locked_by_email)
        VALUES ($1, $2, $3)
        ON CONFLICT (club_id, meeting_date)
        DO UPDATE SET
          locked_by_email = EXCLUDED.locked_by_email,
          locked_at = NOW()
      `,
      [clubId, meetingDate, auth.account.email],
    );
  }
  return res.json({ message: `Locked agenda for ${meetingDate}.` });
});

app.post('/api/clubs/:clubId/schedule/unlock', async (req, res) => {
  const { clubId } = req.params;
  const { email, meetingDate } = req.body as { email?: string; meetingDate?: string };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate) {
    return res.status(400).json({ error: 'Meeting date is required.' });
  }

  await unlockMeetingSchedule(clubId, meetingDate);
  return res.json({ message: `Unlocked agenda for ${meetingDate}.` });
});

app.post('/api/clubs/:clubId/schedule/offer-role', async (req, res) => {
  const { clubId } = req.params;
  const { email, meetingDate, slotId } = req.body as { email?: string; meetingDate?: string; slotId?: string };

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate || !slotId) {
    return res.status(400).json({ error: 'Meeting date and slot ID are required.' });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, 12);
  const schedules = await generateSchedulesWithLocks(clubId, meetings, members);
  const meetingIndex = meetings.findIndex((m) => m.date === meetingDate);

  if (meetingIndex < 0) {
    return res.status(404).json({ error: 'That meeting was not found in the upcoming schedule.' });
  }

  const assignment = schedules[meetingIndex].assignments.find((a) => a.slotId === slotId);
  if (!assignment || !assignment.memberEmail) {
    return res.status(404).json({ error: 'That role is not currently assigned.' });
  }

  if (assignment.memberEmail.toLowerCase() !== auth.account.email.toLowerCase()) {
    return res.status(403).json({ error: 'You can only offer your own assigned role.' });
  }

  const token = await createRoleOfferToken(clubId, meetingDate, slotId, assignment.role, auth.account.email);
  const offerUrl = buildRoleOfferLink(token);

  await logClubActivity(
    clubId,
    auth.account.email,
    auth.account.email,
    'roleOfferCreated',
    `${auth.account.name} created a replacement link for ${assignment.role} on ${meetingDate}.`,
    {
      meetingDate,
      slotId,
      role: assignment.role,
      offerUrl,
    },
  );

  return res.json({ offerUrl });
});

app.get('/api/clubs/:clubId/schedule/role-offer', async (req, res) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const offer = await getRoleOffer(String(token));

  if (!offer) {
    return res.status(404).json({ error: 'That offer link is invalid.' });
  }

  if (new Date(offer.expires_at) < new Date()) {
    return res.status(400).json({ error: 'That offer link has expired.' });
  }

  if (offer.accepted_at) {
    return res.status(409).json({ error: 'This role has already been claimed by someone else.' });
  }

  const offerer = await getAccountByEmail(offer.offered_by_email);

  return res.json({
    role: offer.role_label,
    meetingDate: offer.meeting_date,
    offeredByName: offerer?.name ?? offer.offered_by_email,
  });
});

app.post('/api/clubs/:clubId/schedule/accept-role-offer', async (req, res) => {
  const { clubId } = req.params;
  const { email, token } = req.body as { email?: string; token?: string };

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!token) {
    return res.status(400).json({ error: 'Offer token is required.' });
  }

  const offer = await getRoleOffer(String(token));

  if (!offer) {
    return res.status(404).json({ error: 'That offer link is invalid.' });
  }

  if (offer.club_id !== clubId) {
    return res.status(403).json({ error: 'This offer is not for this club.' });
  }

  if (new Date(offer.expires_at) < new Date()) {
    return res.status(400).json({ error: 'That offer link has expired.' });
  }

  if (offer.accepted_at) {
    return res.status(409).json({ error: 'This role has already been claimed by someone else.' });
  }

  if (offer.offered_by_email.toLowerCase() === auth.account.email.toLowerCase()) {
    return res.status(400).json({ error: 'You cannot accept your own role offer.' });
  }

  const club = await getClubRoster(clubId);
  const acceptingMember = club?.roster.find((m) => m.email.toLowerCase() === auth.account.email.toLowerCase());
  if (!acceptingMember) {
    return res.status(404).json({ error: 'Your account is not on this club roster.' });
  }

  const consumed = await consumeRoleOfferToken(String(token), auth.account.email);
  if (!consumed) {
    return res.status(409).json({ error: 'This role has already been claimed by someone else.' });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, 12);
  const schedules = await generateSchedulesWithLocks(clubId, meetings, members);
  const meetingIndex = meetings.findIndex((m) => m.date === offer.meeting_date);

  if (meetingIndex >= 0) {
    const existingDraft = await pool.query(
      `SELECT 1 FROM meeting_schedule_assignments WHERE club_id = $1 AND meeting_date = $2 LIMIT 1`,
      [clubId, offer.meeting_date],
    );
    if ((existingDraft.rowCount ?? 0) === 0) {
      await persistDraftScheduleAssignments(clubId, meetings[meetingIndex], schedules[meetingIndex].assignments);
    }
  }

  await pool.query(
    `INSERT INTO meeting_schedule_assignments
       (club_id, meeting_date, slot_id, slot_order, role_label, role_key, member_id, member_email, member_name, confidence, reason)
     VALUES ($1, $2, $3, 0, $4, NULL, $5, $6, $7, 1, 'Accepted via role swap link.')
     ON CONFLICT (club_id, meeting_date, slot_id)
     DO UPDATE SET
       member_id = EXCLUDED.member_id,
       member_email = EXCLUDED.member_email,
       member_name = EXCLUDED.member_name,
       confidence = EXCLUDED.confidence,
       reason = EXCLUDED.reason`,
    [clubId, offer.meeting_date, offer.slot_id, offer.role_label, acceptingMember.id, auth.account.email, acceptingMember.name],
  );

  await pool.query(
    `DELETE FROM meeting_role_confirmations
     WHERE club_id = $1 AND meeting_date = $2 AND slot_id = $3`,
    [clubId, offer.meeting_date, offer.slot_id],
  );

  const offeredRoleLabel = offer.role_label.toLowerCase();
  if (offeredRoleLabel === 'toastmaster') {
    await pool.query(
      `DELETE FROM meeting_themes WHERE club_id = $1 AND meeting_date = $2`,
      [clubId, offer.meeting_date],
    );
  } else if (offeredRoleLabel.includes('speaker')) {
    await pool.query(
      `DELETE FROM speech_details WHERE club_id = $1 AND meeting_date = $2 AND slot_id = $3`,
      [clubId, offer.meeting_date, offer.slot_id],
    );
  }

  await logClubActivity(
    clubId,
    auth.account.email,
    auth.account.email,
    'roleOfferAccepted',
    `${auth.account.name} accepted ${offer.role_label} on ${offer.meeting_date}.`,
    {
      meetingDate: offer.meeting_date,
      slotId: offer.slot_id,
      role: offer.role_label,
      offeredByEmail: offer.offered_by_email.toLowerCase(),
    },
  );

  return res.json({ message: `You are now scheduled as ${offer.role_label} on ${offer.meeting_date}.` });
});

app.put('/api/clubs/:clubId/schedule/assignment', async (req, res) => {
  const { clubId } = req.params;
  const {
    email,
    meetingDate,
    slotId,
    targetMemberEmail,
  } = req.body as {
    email?: string;
    meetingDate?: string;
    slotId?: string;
    targetMemberEmail?: string | null;
  };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate || !slotId) {
    return res.status(400).json({ error: 'Meeting date and slot are required.' });
  }

  const lockCheck = await pool.query(
    `
      SELECT 1
      FROM meeting_schedule_locks
      WHERE club_id = $1 AND meeting_date = $2
    `,
    [clubId, meetingDate],
  );

  if ((lockCheck.rowCount ?? 0) > 0) {
    return res.status(400).json({ error: 'Unlock the agenda before making manual adjustments.' });
  }

  const agenda = await getClubAgenda(clubId);
  const meeting = buildMeetingForClub(clubId, agenda?.agenda, meetingDate);
  const slot = meeting.roleSlots?.find((entry) => entry.id === slotId);
  if (!slot) {
    return res.status(404).json({ error: 'That agenda slot could not be found.' });
  }

  const members = await buildMembersForClub(clubId);
  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, 4);
  const schedules = await generateSchedulesWithLocks(clubId, meetings, members);
  const meetingIndex = meetings.findIndex((entry) => entry.date === meetingDate);
  if (meetingIndex < 0) {
    return res.status(404).json({ error: 'That meeting was not found in the next four schedules.' });
  }

  const existingDraft = await pool.query(
    `
      SELECT 1
      FROM meeting_schedule_assignments
      WHERE club_id = $1
        AND meeting_date = $2
      LIMIT 1
    `,
    [clubId, meetingDate],
  );

  if ((existingDraft.rowCount ?? 0) === 0) {
    await persistDraftScheduleAssignments(clubId, meetings[meetingIndex], schedules[meetingIndex].assignments);
  }

  let memberId: string | null = null;
  let memberName: string | null = null;
  let normalizedTargetEmail: string | null = null;

  if (targetMemberEmail) {
    normalizedTargetEmail = String(targetMemberEmail).trim().toLowerCase();
    const club = await getClubRoster(clubId);
    const targetMember = club?.roster.find((member) => member.email.toLowerCase() === normalizedTargetEmail) ?? null;
    if (!targetMember) {
      return res.status(404).json({ error: 'Selected member is not on this club roster.' });
    }

    memberId = targetMember.id;
    memberName = targetMember.name;
  }

  await pool.query(
    `
      INSERT INTO meeting_schedule_assignments (
        club_id,
        meeting_date,
        slot_id,
        slot_order,
        role_label,
        role_key,
        member_id,
        member_email,
        member_name,
        confidence,
        reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (club_id, meeting_date, slot_id)
      DO UPDATE SET
        member_id = EXCLUDED.member_id,
        member_email = EXCLUDED.member_email,
        member_name = EXCLUDED.member_name,
        confidence = EXCLUDED.confidence,
        reason = EXCLUDED.reason
    `,
    [
      clubId,
      meetingDate,
      slotId,
      slot.order,
      slot.label,
      slot.roleKey,
      memberId,
      normalizedTargetEmail,
      memberName,
      1,
      normalizedTargetEmail ? 'Manually assigned before agenda lock.' : 'Cleared manually before agenda lock.',
    ],
  );

  if (slot.roleKey === 'toastmaster') {
    await pool.query(
      `DELETE FROM meeting_themes WHERE club_id = $1 AND meeting_date = $2`,
      [clubId, meetingDate],
    );
  } else if (slot.roleKey === 'speaker') {
    await pool.query(
      `DELETE FROM speech_details WHERE club_id = $1 AND meeting_date = $2 AND slot_id = $3`,
      [clubId, meetingDate, slotId],
    );
  }

  return res.json({ message: 'Manual agenda assignment saved.' });
});

app.post('/api/clubs/:clubId/schedule/regenerate', async (req, res) => {
  const { clubId } = req.params;
  const { email, meetingDate } = req.body as { email?: string; meetingDate?: string };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate) {
    return res.status(400).json({ error: 'Meeting date is required.' });
  }

  const lockCheck = await pool.query(
    `
      SELECT 1
      FROM meeting_schedule_locks
      WHERE club_id = $1 AND meeting_date = $2
    `,
    [clubId, meetingDate],
  );

  if ((lockCheck.rowCount ?? 0) > 0) {
    return res.status(400).json({ error: 'Unlock the agenda before regenerating it.' });
  }

  await pool.query(
    `
      DELETE FROM meeting_schedule_assignments
      WHERE club_id = $1
        AND meeting_date = $2
    `,
    [clubId, meetingDate],
  );

  return res.json({ message: `Regenerated agenda draft for ${meetingDate}.` });
});

app.get('/api/clubs/:clubId/attendance', async (req, res) => {
  const { clubId } = req.params;
  const email = req.query.email as string | undefined;
  const requestedMeetingDate = req.query.meetingDate as string | undefined;

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const availableMeetingDates = buildPastMeetingDates(8);
  const meetingDate = requestedMeetingDate && availableMeetingDates.includes(requestedMeetingDate)
    ? requestedMeetingDate
    : availableMeetingDates[0];
  const meeting = buildMeetingForClub(clubId, agenda?.agenda, meetingDate);
  const schedule = generateSchedule(meeting, members);
  const verificationMap = await getAttendanceVerifications(clubId, meeting.date);

  return res.json({
    meetingDate: meeting.date,
    availableMeetingDates,
    assignments: schedule.assignments.map((assignment) => {
      const assignedMember = assignment.memberId
        ? members.find((member) => member.id === assignment.memberId) ?? null
        : null;

      return {
        ...assignment,
        memberEmail: assignedMember?.email ?? null,
        availabilityStatus:
          assignedMember?.availability[meeting.date]
          ?? assignedMember?.availabilityDefault
          ?? 'always',
        verification: verificationMap.get(assignment.role) ?? null,
      };
    }),
  });
});

app.post('/api/clubs/:clubId/attendance/seed', async (req, res) => {
  const { clubId } = req.params;
  const email = req.body?.email as string | undefined;

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const seededMeetingDates = await seedAttendanceHistoryForClub(clubId, 4);

  return res.json({
    message: `Created test attendance history for ${seededMeetingDates.length} past meetings.`,
    seededMeetingDates,
  });
});

app.put('/api/clubs/:clubId/attendance', async (req, res) => {
  const { clubId } = req.params;
  const {
    email,
    meetingDate,
    records,
  } = req.body as {
    email?: string;
    meetingDate?: string;
    records?: Array<AttendanceVerificationRecord & { availabilityStatus?: AvailabilityStatus }>;
  };

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!meetingDate || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Meeting date and attendance records are required.' });
  }

  await saveAttendanceRecords(clubId, meetingDate, records);

  return res.json({ message: `Attendance verified for ${meetingDate}.` });
});

app.get('/api/engine/explain', (_req, res) => {
  const member = sampleMembers[0];
  const explanation = explainAssignment(member, 'toastmaster', sampleMeeting);
  return res.json({ explanation });
});

app.get('/api/engine/swap-candidates', (_req, res) => {
  const candidates = suggestSwapCandidates('timer', sampleMembers, sampleMeeting.date);
  return res.json({ candidates });
});

app.get('/api/clubs/:clubId/swaps', async (req, res) => {
  const { clubId } = req.params;
  const email = req.query.email as string | undefined;
  const requestedWeeks = Number(req.query.weeks ?? 4);
  const numberOfWeeks = Number.isFinite(requestedWeeks)
    ? Math.max(1, Math.min(12, Math.floor(requestedWeeks)))
    : 4;

  const auth = await ensureAuthorizedMembership(email, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  const agenda = await getClubAgenda(clubId);
  const members = await buildMembersForClub(clubId);
  const currentMember = members.find(
    (member) => member.email.toLowerCase() === auth.account.email.toLowerCase(),
  );

  if (!currentMember) {
    return res.status(404).json({ error: 'No matching roster member was found for this account.' });
  }

  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, numberOfWeeks);
  const schedules = generateUpcomingSchedules(meetings, members);

  const swaps = meetings.flatMap((meeting, index) => {
    const schedule = schedules[index];
    const assignedMemberIds = new Set(
      schedule.assignments
        .map((assignment) => assignment.memberId)
        .filter((memberId): memberId is string => Boolean(memberId)),
    );

    return schedule.assignments
      .filter(
        (assignment) =>
          assignment.memberId === currentMember.id &&
          Boolean(assignment.roleKey),
      )
      .map((assignment) => {
        const roleKey = assignment.roleKey as RoleKey;
        const candidates = suggestSwapCandidates(roleKey, members, meeting.date)
          .filter(
            (candidate) =>
              candidate.id !== currentMember.id &&
              !assignedMemberIds.has(candidate.id),
          )
          .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            email: candidate.email,
            availabilityStatus:
              candidate.availability[meeting.date] ?? candidate.availabilityDefault ?? 'always',
          }));

        return {
          meetingId: meeting.id,
          meetingDate: meeting.date,
          role: assignment.role,
          roleKey,
          currentMember: {
            id: currentMember.id,
            name: currentMember.name,
            email: currentMember.email,
          },
          candidates,
        };
      });
  });

  return res.json({
    clubId,
    clubName: auth.membership.clubName,
    swaps,
  });
});

const start = async () => {
  await runMigrations();
  await seedInitialData();
  await runOneTimeLockedAgendaRefreshFromHistory(IDTT_CLUB_ID);

  app.listen(PORT, () => {
    console.log(`ToastBoss backend listening on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error('ToastBoss backend failed to start', error);
  process.exit(1);
});
