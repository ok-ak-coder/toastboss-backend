import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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

const sampleMembers: Member[] = [
  {
    id: 'm1',
    name: 'Avery Silva',
    email: 'avery@example.com',
    clubId: 'club-1',
    bossScore: 108,
    availability: {},
    preferredRoles: ['toastmaster', 'speaker', 'timer'],
  },
  {
    id: 'm2',
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    clubId: 'club-1',
    bossScore: 92,
    availability: { '2026-05-08': 'tentative' },
    preferredRoles: ['grammarians', 'educationalMoment', 'timer'],
  },
  {
    id: 'm3',
    name: 'Taylor Park',
    email: 'taylor@example.com',
    clubId: 'club-1',
    bossScore: 110,
    availability: {},
    preferredRoles: ['speaker', 'generalEvaluator', 'topics'],
  },
];

const sampleMeeting: Meeting = {
  id: 'meeting-1',
  clubId: 'club-1',
  date: '2026-05-08',
  roles: ['toastmaster', 'speaker', 'generalEvaluator', 'topics', 'timer', 'grammarians', 'educationalMoment'],
};

const defaultAgenda = (): AgendaItem[] => [
  { id: 'agenda-1', title: 'Opening Toast', role: 'openingToast', durationMinutes: 5, notes: 'Welcome and introductions' },
  { id: 'agenda-2', title: 'Toastmaster', role: 'toastmaster', durationMinutes: 5, optional: false },
  { id: 'agenda-3', title: 'Educational Moment', role: 'educationalMoment', durationMinutes: 5 },
  { id: 'agenda-4', title: 'Grammarian', role: 'grammarian', durationMinutes: 3 },
  { id: 'agenda-5', title: 'Barroom Topics', role: 'barroomTopics', durationMinutes: 15 },
  { id: 'agenda-6', title: 'Speaker 1', role: 'speaker', durationMinutes: 12 },
  { id: 'agenda-7', title: 'General Evaluator', role: 'generalEvaluator', durationMinutes: 10 },
  { id: 'agenda-8', title: 'Speech Evaluator 1', role: 'speechEvaluator', durationMinutes: 8, evaluatorMode: 'individual' },
  { id: 'agenda-9', title: 'Timer', role: 'timer', durationMinutes: 3 },
];

const schedulableRoles: RoleKey[] = [
  'toastmaster',
  'speaker',
  'evaluators',
  'topics',
  'generalEvaluator',
  'timer',
  'grammarians',
  'educationalMoment',
];

const agendaRoleCatalog: Record<string, { label: string; scheduleRole: RoleKey | null }> = {
  openingToast: { label: 'Opening Toast', scheduleRole: null },
  toastmaster: { label: 'Toastmaster', scheduleRole: 'toastmaster' },
  educationalMoment: { label: 'Educational Moment', scheduleRole: 'educationalMoment' },
  grammarian: { label: 'Grammarian', scheduleRole: 'grammarians' },
  barroomTopics: { label: 'Barroom Topics', scheduleRole: 'topics' },
  speaker: { label: 'Speaker', scheduleRole: 'speaker' },
  speechEvaluator: { label: 'Speech Evaluator', scheduleRole: 'evaluators' },
  generalEvaluator: { label: 'General Evaluator', scheduleRole: 'generalEvaluator' },
  timer: { label: 'Timer', scheduleRole: 'timer' },
  other: { label: 'Other', scheduleRole: null },
};

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

  if (roleValue === 'educationalmoment' || titleValue === 'educational moment') {
    return 'educationalMoment';
  }

  if (roleValue === 'grammarian' || roleValue === 'grammarians' || titleValue === 'grammarian') {
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

  if (roleValue === 'timer' || titleValue === 'timer') {
    return 'timer';
  }

  if (roleValue === 'other' || roleValue === 'custom') {
    return 'other';
  }

  return legacyRole;
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const deriveDisplayNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Club Admin';

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

  if (looksLikeLegacyDefaultAgenda(value as Array<{ title?: string; role?: string }>)) {
    return defaultAgenda();
  }

  return value.map((item, index) => {
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
    };
  });
};

const parsePreferences = (value: unknown) => {
  const record = (value as { emailReminders?: boolean; swapAlerts?: boolean } | null) ?? {};
  return {
    emailReminders: record.emailReminders !== false,
    swapAlerts: record.swapAlerts !== false,
  };
};

const parseRosterEntries = (rosterText: string) => {
  return rosterText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const columns = line.split(',').map((column) => column.trim()).filter(Boolean);
      const email = columns.find((column) => /\S+@\S+\.\S+/.test(column)) ?? '';
      const nameColumns = columns.filter((column) => column !== email);
      const name = nameColumns.join(' ') || `Member ${index + 1}`;

      return {
        id: `roster-${index + 1}`,
        name,
        email,
      };
    })
    .filter((entry) => entry.email);
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

const formatDateOnly = (value: Date) => value.toISOString().slice(0, 10);

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const buildMeetingForClub = (clubId: string, agenda: AgendaItem[] | undefined, meetingDate?: string, meetingIndex = 0): Meeting => {
  const roleSlots = (agenda ?? []).reduce<MeetingRoleSlot[]>((acc, item) => {
    const roleMeta = agendaRoleCatalog[item.role];
    if (!roleMeta?.scheduleRole) {
      return acc;
    }

    acc.push({
      id: item.id,
      label: item.title || roleMeta.label,
      roleKey: roleMeta.scheduleRole,
      optional: Boolean(item.optional),
      evaluatorMode: item.evaluatorMode === 'roundRobin' ? 'roundRobin' : 'individual',
    });
    return acc;
  }, []);
  const rolesFromAgenda = roleSlots.map((item) => item.roleKey);
  const roleRequirements = (agenda ?? []).reduce<NonNullable<Meeting['roleRequirements']>>((acc, item) => {
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
    date: meetingDate ?? formatDateOnly(new Date()),
    roles: rolesFromAgenda.length > 0 ? rolesFromAgenda : sampleMeeting.roles,
    roleSlots,
    roleRequirements,
  };
};

const buildUpcomingMeetingsForClub = (clubId: string, agenda: AgendaItem[] | undefined, numberOfWeeks = 4): Meeting[] => {
  const startDate = new Date();
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
  const startDate = new Date();
  return Array.from({ length: numberOfWeeks }, (_value, index) =>
    formatDateOnly(addDays(startDate, -7 * (index + 1))),
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
  },
) => {
  const id = `acct-${slugify(email)}`;
  const bossScore = options?.bossScore ?? 100;
  const setupComplete = options?.setupComplete ?? false;
  const password = options?.password ?? null;
  const preferences = options?.notificationPreferences ?? {
    emailReminders: true,
    swapAlerts: true,
  };

  await pool.query(
    `
      INSERT INTO accounts (email, id, name, boss_score, setup_complete, password, notification_preferences)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        boss_score = COALESCE(accounts.boss_score, EXCLUDED.boss_score),
        setup_complete = accounts.setup_complete OR EXCLUDED.setup_complete,
        password = COALESCE(EXCLUDED.password, accounts.password),
        notification_preferences = CASE
          WHEN accounts.setup_complete AND NOT EXCLUDED.setup_complete THEN accounts.notification_preferences
          ELSE EXCLUDED.notification_preferences
        END
    `,
    [email, id, name, bossScore, setupComplete, password, JSON.stringify(preferences)],
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
  await pool.query(
    `
      INSERT INTO memberships (account_email, club_id, roles)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (account_email, club_id)
      DO UPDATE SET roles = EXCLUDED.roles
    `,
    [email, membership.clubId, JSON.stringify(membership.roles)],
  );
};

const replaceRoster = async (clubId: string, clubName: string, roster: ClubMemberRecord[]) => {
  await pool.query('DELETE FROM roster WHERE club_id = $1', [clubId]);

  for (const member of roster) {
    await pool.query(
      `
        INSERT INTO roster (club_id, member_email, member_id, name, roles)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [clubId, member.email, member.id, member.name, JSON.stringify(member.roles)],
    );

    await upsertAccount(member.email, member.name, {
      setupComplete: false,
      password: null,
      bossScore: Number(member.bossScore) || 100,
    });

    await upsertMembership(member.email, {
      clubId,
      clubName,
      roles: member.roles,
    });
  }
};

const getAccountByEmail = async (email: string): Promise<UserAccount | null> => {
  const accountResult = await pool.query(
    `
      SELECT email, id, name, boss_score, setup_complete, password, notification_preferences
      FROM accounts
      WHERE email = $1
    `,
    [email],
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
    [email],
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
    memberships,
    password: (accountRow.password as string | null) ?? undefined,
    notificationPreferences: parsePreferences(accountRow.notification_preferences),
  };
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
      SELECT roster.member_id, roster.name, roster.member_email, roster.roles, accounts.boss_score, COALESCE(meeting_callouts.called_out, FALSE) AS called_out
      FROM roster
      LEFT JOIN accounts ON accounts.email = roster.member_email
      LEFT JOIN meeting_callouts
        ON meeting_callouts.club_id = roster.club_id
        AND meeting_callouts.member_email = roster.member_email
        AND meeting_callouts.meeting_date = $2
      WHERE roster.club_id = $1
      ORDER BY roster.name ASC
    `,
    [clubId, meetingDate],
  );

  return {
    id: clubResult.rows[0].id as string,
    name: clubResult.rows[0].name as string,
    meetingDate,
    roster: rosterResult.rows.map((row: any) => ({
      id: row.member_id as string,
      name: row.name as string,
      email: row.member_email as string,
      roles: parseRoles(row.roles),
      bossScore: Number(row.boss_score ?? 100),
      calledOut: Boolean(row.called_out),
      availabilityDefault: availabilityDefaults.get(String(row.member_email).toLowerCase()) ?? 'always',
      availabilityOverrides: availabilityOverrides.get(String(row.member_email).toLowerCase()) ?? {},
    })),
  };
};

const getClubAgenda = async (clubId: string): Promise<{ id: string; name: string; agenda: AgendaItem[] } | null> => {
  const clubResult = await pool.query('SELECT id, name, agenda FROM clubs WHERE id = $1', [clubId]);
  if (clubResult.rowCount === 0) {
    return null;
  }

  return {
    id: clubResult.rows[0].id as string,
    name: clubResult.rows[0].name as string,
    agenda: parseAgenda(clubResult.rows[0].agenda),
  };
};

const majorRoleKeys = new Set<RoleKey>(['toastmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator']);
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
  memberships: account.memberships,
  notificationPreferences: account.notificationPreferences,
});

const ensureAuthorizedMembership = async (email: string | undefined, clubId: string, allowedRoles: UserRole[]) => {
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

  if (!allowedRoles.some((role) => membership.roles.includes(role))) {
    return { error: 'This account does not have permission for that action.', status: 403 as const };
  }

  return { account, membership };
};

const seedInitialData = async () => {
  await upsertClub(sampleMeeting.clubId, 'Sample Toastmasters Club', defaultAgenda());

  for (const member of sampleMembers) {
    await upsertAccount(member.email, member.name, {
      setupComplete: false,
      bossScore: member.bossScore,
      password: null,
    });

    await upsertMembership(member.email, {
      clubId: member.clubId,
      clubName: 'Sample Toastmasters Club',
      roles: ['member'],
    });
  }

  await replaceRoster(sampleMeeting.clubId, 'Sample Toastmasters Club', sampleMembers.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    roles: ['member'],
  })));
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ToastBoss backend' });
});

app.post('/api/auth/magic-link', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  return res.json({ message: `Magic link sent to ${email}`, email });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const account = await getAccountByEmail(email);
  if (account) {
    if (!account.setupComplete) {
      return res.status(409).json({
        error: 'This account still needs to finish setup before signing in.',
        redirectTo: '/activate-account',
        account: sanitizeUserForResponse(account),
      });
    }

    if (account.password && password !== account.password) {
      return res.status(401).json({ error: 'Incorrect password for this ToastBoss account.' });
    }

    return res.json({ user: sanitizeUserForResponse(account) });
  }

  return res.status(404).json({ error: 'No ToastBoss member was found for that email address.' });
});

app.post('/api/auth/complete-setup', async (req, res) => {
  const { email, password, name, emailReminders, swapAlerts } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required to finish account setup.' });
  }

  const account = await getAccountByEmail(email);
  if (!account) {
    return res.status(404).json({ error: 'No pending ToastBoss account was found for that email.' });
  }

  await upsertAccount(email, name || account.name, {
    setupComplete: true,
    bossScore: account.bossScore,
    password,
    notificationPreferences: {
      emailReminders: emailReminders !== false,
      swapAlerts: swapAlerts !== false,
    },
  });

  const updatedAccount = await getAccountByEmail(email);
  return res.json({
    message: `Account setup complete for ${updatedAccount?.name ?? account.name}.`,
    user: sanitizeUserForResponse(updatedAccount ?? account),
  });
});

app.post('/api/clubs/setup', async (req, res) => {
  const { clubName, adminEmail, password } = req.body;

  if (!clubName || !adminEmail || !password) {
    return res.status(400).json({ error: 'Club name, admin email, and password are required.' });
  }

  const clubId = `club-${slugify(clubName)}`;
  const adminName = deriveDisplayNameFromEmail(adminEmail);
  const adminRoles: UserRole[] = ['member', 'admin'];

  await upsertClub(clubId, clubName, defaultAgenda());
  await upsertAccount(adminEmail, adminName, {
    setupComplete: true,
    password,
  });
  await upsertMembership(adminEmail, {
    clubId,
    clubName,
    roles: adminRoles,
  });
  await replaceRoster(clubId, clubName, [
    {
      id: `acct-${slugify(adminEmail)}`,
      name: adminName,
      email: adminEmail,
      roles: adminRoles,
    },
  ]);

  const adminAccount = await getAccountByEmail(adminEmail);

  return res.json({
    message: `${clubName} is ready. Your admin account has been created and you can upload your roster from the dashboard.`,
    user: sanitizeUserForResponse(adminAccount as UserAccount),
    club: {
      id: clubId,
      name: clubName,
      admin: {
        name: adminName,
        email: adminEmail,
        roles: adminRoles,
      },
      rosterCount: 1,
    },
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

app.put('/api/clubs/:clubId/availability', async (req, res) => {
  const { clubId } = req.params;
  const {
    email,
    targetEmail,
    availabilityDefault,
    availabilityOverrides,
  } = req.body as {
    email?: string;
    targetEmail?: string;
    availabilityDefault?: AvailabilityStatus;
    availabilityOverrides?: Record<string, AvailabilityStatus>;
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

  await setMemberAvailability(
    clubId,
    normalizedTargetEmail,
    parseAvailabilityDefault(availabilityDefault),
    parseAvailabilityOverrides(availabilityOverrides),
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
    roles: parseRoles(member.roles),
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
      roles: existing?.roles ?? ['member'],
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
      roles: auth.membership.roles,
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
  const club = await getClubAgenda(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(req.query.email as string | undefined, clubId, ['member', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  return res.json({ club });
});

app.put('/api/clubs/:clubId/agenda', async (req, res) => {
  const { clubId } = req.params;
  const { email, agenda } = req.body as { email?: string; agenda?: AgendaItem[] };
  const club = await getClubAgenda(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
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
  }));

  await pool.query('UPDATE clubs SET agenda = $2::jsonb WHERE id = $1', [clubId, JSON.stringify(normalizedAgenda)]);

  return res.json({
    message: `Agenda updated for ${club.name}.`,
    club: await getClubAgenda(clubId),
  });
});

app.get('/api/engine/schedule', async (req, res) => {
  const clubId = req.query.clubId as string | undefined;
  const email = req.query.email as string | undefined;

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

  const meetings = buildUpcomingMeetingsForClub(clubId, agenda?.agenda, 4);
  const schedules = generateUpcomingSchedules(meetings, members);

  const upcomingMeetings = meetings.map((meeting, index) => ({
    meetingId: meeting.id,
    meetingDate: meeting.date,
    assignments: schedules[index].assignments,
    fairness: schedules[index].fairness,
  }));
  const firstMeeting = upcomingMeetings[0];

  return res.json({
    clubId,
    clubName: auth.membership.clubName,
    meetingId: firstMeeting.meetingId,
    meetingDate: firstMeeting.meetingDate,
    assignments: firstMeeting.assignments,
    fairness: firstMeeting.fairness,
    meetings: upcomingMeetings,
  });
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

const start = async () => {
  await runMigrations();
  await seedInitialData();

  app.listen(PORT, () => {
    console.log(`ToastBoss backend listening on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error('ToastBoss backend failed to start', error);
  process.exit(1);
});
