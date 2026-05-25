import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
const BUNDLED_ROSTER_PATH = path.resolve(__dirname, '../src/data/Club-Membership20260522.csv');
const BUNDLED_HISTORY_PATH = path.resolve(__dirname, '../src/data/idtt-schedule-history.json');

const sampleMembers: Member[] = [
  {
    id: 'm1',
    name: 'Avery Silva',
    email: 'avery@example.com',
    clubId: IDTT_CLUB_ID,
    bossScore: 108,
    eligibleRoles: ['toastmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator', 'timer', 'grammarians', 'educationalMoment'],
    availability: {},
    preferredRoles: ['toastmaster', 'speaker', 'timer'],
  },
  {
    id: 'm2',
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    clubId: IDTT_CLUB_ID,
    bossScore: 92,
    eligibleRoles: ['toastmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator', 'timer', 'grammarians', 'educationalMoment'],
    availability: { '2026-05-08': 'tentative' },
    preferredRoles: ['grammarians', 'educationalMoment', 'timer'],
  },
  {
    id: 'm3',
    name: 'Taylor Park',
    email: 'taylor@example.com',
    clubId: IDTT_CLUB_ID,
    bossScore: 110,
    eligibleRoles: ['toastmaster', 'speaker', 'evaluators', 'topics', 'generalEvaluator', 'timer', 'grammarians', 'educationalMoment'],
    availability: {},
    preferredRoles: ['speaker', 'generalEvaluator', 'topics'],
  },
];

const sampleMeeting: Meeting = {
  id: 'meeting-1',
  clubId: IDTT_CLUB_ID,
  date: '2026-05-08',
  roles: ['toastmaster', 'speaker', 'speaker', 'evaluators', 'evaluators', 'generalEvaluator', 'topics', 'timer', 'grammarians', 'educationalMoment'],
};

const defaultAgenda = (): AgendaItem[] => [
  { id: 'agenda-1', title: 'Opening Toast', role: 'openingToast', durationMinutes: 5, notes: 'Welcome and introductions' },
  { id: 'agenda-3', title: 'Educational Moment', role: 'educationalMoment', durationMinutes: 5 },
  { id: 'agenda-4', title: 'Grammarian', role: 'grammarian', durationMinutes: 3 },
  { id: 'agenda-2', title: 'Toastmaster', role: 'toastmaster', durationMinutes: 5, optional: false },
  { id: 'agenda-5', title: 'Barroom Topics', role: 'barroomTopics', durationMinutes: 15 },
  { id: 'agenda-6', title: 'Speaker 1', role: 'speaker', durationMinutes: 12 },
  { id: 'agenda-7', title: 'Speaker 2', role: 'speaker', durationMinutes: 12 },
  { id: 'agenda-8', title: 'General Evaluator', role: 'generalEvaluator', durationMinutes: 10 },
  { id: 'agenda-9', title: 'Speech Evaluator 1', role: 'speechEvaluator', durationMinutes: 8, evaluatorMode: 'individual' },
  { id: 'agenda-10', title: 'Speech Evaluator 2', role: 'speechEvaluator', durationMinutes: 8, evaluatorMode: 'individual' },
  { id: 'agenda-11', title: 'Timer', role: 'timer', durationMinutes: 3 },
];

const schedulableRoles: RoleKey[] = [
  'openingToast',
  'educationalMoment',
  'grammarians',
  'toastmaster',
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

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const deriveDisplayNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Club Admin';

const filterToSupportedMemberships = (memberships: ClubMembership[]) =>
  memberships.filter((membership) => membership.clubId === IDTT_CLUB_ID);

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

const parseOfficerRoles = (currentPosition: string): UserRole[] => {
  const normalizedPosition = currentPosition.trim().toLowerCase();
  return normalizedPosition ? ['admin', 'member'] : ['member'];
};

const parseEligibleRoles = (value: unknown): RoleKey[] => {
  if (!Array.isArray(value)) {
    return [...allEligibleRoles];
  }

  const normalized = value.filter((role): role is RoleKey => typeof role === 'string' && isRoleKey(role));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...allEligibleRoles];
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

      return {
        id: `roster-${index + 1}`,
        name,
        email,
        memberStatus,
        roles: parseOfficerRoles(currentPosition),
      };
    })
    .filter((entry) => /\S+@\S+\.\S+/.test(entry.email))
    .filter((entry) => !hasToastmastersHeader || statusIndex < 0 || entry.memberStatus === 'PaidMember')
    .map(({ id, name, email, roles }) => ({ id, name, email, roles }));
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
  const roleSlots = (agenda ?? []).reduce<MeetingRoleSlot[]>((acc, item) => {
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
  const startDate = alignToMeetingWeekday(new Date(), 'future');
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
  const startDate = alignToMeetingWeekday(new Date(), 'past');
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

  return looksLikeLegacyDefaultAgenda(items) || speakerCount === 0 || evaluatorCount === 0;
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
};

const unlockMeetingSchedule = async (clubId: string, meetingDate: string) => {
  await pool.query('DELETE FROM meeting_schedule_locks WHERE club_id = $1 AND meeting_date = $2', [clubId, meetingDate]);
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
  const normalizedEmail = String(email).trim().toLowerCase();
  const id = `acct-${slugify(normalizedEmail)}`;
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
    [normalizedEmail, id, name, bossScore, setupComplete, password, JSON.stringify(preferences)],
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
        INSERT INTO roster (club_id, member_email, member_id, name, roles, eligible_roles)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      `,
      [
        clubId,
        normalizedEmail,
        member.id,
        member.name,
        JSON.stringify(member.roles),
        JSON.stringify(parseEligibleRoles(member.eligibleRoles)),
      ],
    );

    await upsertAccount(normalizedEmail, member.name, {
      setupComplete: false,
      password: null,
      bossScore: Number(member.bossScore) || 100,
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
    notificationPreferences: parsePreferences(accountRow.notification_preferences),
  };
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

  if (result.rowCount === 0) {
    return null;
  }

  return getAccountByEmail(String(result.rows[0].email));
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
      SELECT roster.member_id, roster.name, roster.member_email, roster.roles, roster.eligible_roles, accounts.boss_score, COALESCE(meeting_callouts.called_out, FALSE) AS called_out
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
      eligibleRoles: parseEligibleRoles(row.eligible_roles),
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

const getAdminMemberList = async (clubId: string) => {
  const rosterResult = await pool.query(
    `
      SELECT roster.member_id, roster.name, roster.member_email, roster.roles, roster.eligible_roles, accounts.setup_complete
      FROM roster
      LEFT JOIN accounts ON accounts.email = roster.member_email
      WHERE roster.club_id = $1
      ORDER BY roster.name ASC
    `,
    [clubId],
  );

  return rosterResult.rows.map((row: any) => ({
    id: String(row.member_id),
    name: String(row.name),
    email: String(row.member_email),
    roles: parseRoles(row.roles),
    eligibleRoles: parseEligibleRoles(row.eligible_roles),
    setupComplete: Boolean(row.setup_complete),
    status: Boolean(row.setup_complete) ? 'active' : 'pending',
  }));
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
  memberships: filterToSupportedMemberships(account.memberships),
  notificationPreferences: account.notificationPreferences,
});

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

  if (!allowedRoles.some((role) => membership.roles.includes(role))) {
    return { error: 'This account does not have permission for that action.', status: 403 as const };
  }

  return { account, membership };
};

const seedInitialData = async () => {
  await upsertClub(sampleMeeting.clubId, IDTT_CLUB_NAME, defaultAgenda());

  const existingClub = await getClubRoster(sampleMeeting.clubId);
  if (existingClub && existingClub.roster.length > 0) {
    const bundledRoster = loadBundledRosterEntries();
    if (bundledRoster.length > 0) {
      await syncRosterRoles(sampleMeeting.clubId, IDTT_CLUB_NAME, bundledRoster);
    }
    return;
  }

  const bundledRoster = loadBundledRosterEntries();
  if (bundledRoster.length > 0) {
    await replaceRoster(sampleMeeting.clubId, IDTT_CLUB_NAME, bundledRoster.map((member, index) => ({
      id: member.id || `roster-${index + 1}`,
      name: member.name,
      email: member.email,
      roles: member.roles,
      eligibleRoles: [...allEligibleRoles],
    })));
    return;
  }

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

  const membership = account.memberships.find(
    (entry) => entry.clubId === IDTT_CLUB_ID && entry.roles.includes('admin'),
  );

  if (!membership) {
    return res.status(403).json({ error: 'This account does not have admin access.' });
  }

  if (!account.setupComplete) {
    return res.status(409).json({ error: 'This admin account still needs setup.' });
  }

  if (account.password && password !== account.password) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

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

    if (account.password && password !== account.password) {
      return res.status(401).json({ error: 'Incorrect password for this ToastBoss account.' });
    }

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

    return res.json({
      message: 'Member record found. Continue setting up your account.',
      redirectTo: '/activate-account',
      account: sanitizeUserForResponse(account),
    });
  }

  const rosterResult = await pool.query(
    `
      SELECT roster.name, roster.member_email, accounts.boss_score
      FROM roster
      LEFT JOIN accounts ON accounts.email = roster.member_email
      WHERE LOWER(roster.member_email) = $1
        AND roster.club_id = $2
      ORDER BY roster.name ASC
      LIMIT 1
    `,
    [normalizedEmail, IDTT_CLUB_ID],
  );

  if (rosterResult.rowCount === 0) {
    return res.status(404).json({
      error: 'We could not find that email on the IDTT roster yet. Ask an IDTT admin to add you first.',
    });
  }

  const rosterMember = rosterResult.rows[0];
  const memberName =
    ((rosterMember.name as string | null) ?? '').trim() || deriveDisplayNameFromEmail(normalizedEmail);
  const memberships = await getPendingMembershipsByEmail(normalizedEmail);

  await upsertAccount(normalizedEmail, memberName, {
    setupComplete: false,
    password: null,
    bossScore: Number(rosterMember.boss_score) || 100,
  });

  const pendingAccount = await getAccountByEmail(normalizedEmail);

  if (!pendingAccount || memberships.length === 0) {
    return res.status(500).json({ error: 'Unable to start member signup right now.' });
  }

  return res.json({
    message: 'Member record found. Continue setting up your account.',
    redirectTo: '/activate-account',
    account: sanitizeUserForResponse(pendingAccount),
  });
});

app.post('/api/auth/complete-setup', async (req, res) => {
  const { email, password, name, emailReminders, swapAlerts } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required to finish account setup.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
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
  return res.json({
    message: `Account setup complete for ${updatedAccount?.name ?? account.name}.`,
    user: sanitizeUserForResponse(updatedAccount ?? account),
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

  await setMemberAvailability(
    clubId,
    normalizedTargetEmail,
    parseAvailabilityDefault(availabilityDefault),
    parseAvailabilityOverrides(availabilityOverrides),
  );
  if (eligibleRoles) {
    await setMemberEligibleRoles(clubId, normalizedTargetEmail, parseEligibleRoles(eligibleRoles));
  }

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

  const upcomingMeetings = meetings.map((meeting, index) => ({
    meetingId: meeting.id,
    meetingDate: meeting.date,
    assignments: schedules[index].assignments,
    fairness: schedules[index].fairness,
    locked: schedules[index].locked,
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

  return res.json({ message: 'Manual agenda assignment saved.' });
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

  app.listen(PORT, () => {
    console.log(`ToastBoss backend listening on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error('ToastBoss backend failed to start', error);
  process.exit(1);
});
