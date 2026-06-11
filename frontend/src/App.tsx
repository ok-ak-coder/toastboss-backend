import { useEffect, useRef, useState } from 'react';
import { apiClient } from './api/client';
import copyIcon from './assets/copy-icon.png';
import idttLogoBlack from './assets/idtt-logo-black-1.png';
import invisEyeIcon from './assets/invis-eye.png';
import printIcon from './assets/print-icon.png';
import visEyeIcon from './assets/vis-eye.png';
import { IDTT_CLUB_ID, IDTT_CLUB_NAME } from './idtt';
import type { AgendaEvaluatorMode, AgendaItem, AvailabilityStatus, ClubMemberRecord, RoleKey, UserSession } from './types';

type ViewMode = 'login' | 'signup' | 'verifyEmail' | 'setup' | 'forgotPassword' | 'resetPassword' | 'dashboard';
type PortalTab = 'dashboard' | 'availability' | 'admin';
type AdminSection = 'members' | 'agenda' | 'schedule' | 'activity';
type MemberSettingsSection = 'menu' | 'profile' | 'availability';

interface ScheduleAssignment {
  meetingId: string;
  slotId?: string;
  role: string;
  roleKey?: string;
  memberId: string | null;
  memberEmail?: string | null;
  memberName?: string | null;
  confidence: number;
  reason: string;
  confirmedAt?: string | null;
  speechTitle?: string | null;
  speechTime?: string | null;
}

interface ScheduledMeeting {
  meetingId: string;
  meetingDate: string;
  locked?: boolean;
  theme?: string | null;
  pdfColor?: string | null;
  notes?: string | null;
  assignments: ScheduleAssignment[];
}

interface ScheduleResponse {
  clubName: string;
  meetingDate: string;
  assignments: ScheduleAssignment[];
  meetings?: ScheduledMeeting[];
  hideUnlockedAgendas?: boolean;
}

interface ClubRosterResponse {
  club: {
    id: string;
    name: string;
    meetingDate: string;
    roster: ClubMemberRecord[];
  };
}

interface ClubAgendaResponse {
  club: {
    id: string;
    name: string;
    agenda: AgendaItem[];
  };
}

interface MemberProfileResponse {
  user: UserSession;
  club: {
    id: string;
    name: string;
    meetingDate: string;
    roster: ClubMemberRecord[];
  };
}

interface ActivityEntry {
  id: number;
  memberEmail: string;
  memberName: string;
  actorEmail: string;
  actorName: string;
  activityType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ActivityMemberStatus {
  memberEmail: string;
  memberName: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface ActivityResponse {
  activities: ActivityEntry[];
  members: ActivityMemberStatus[];
}

interface MemberSetupLinkResponse {
  memberName: string;
  memberEmail: string;
  setupUrl: string;
}

const SESSION_STORAGE_KEY = 'idtt-member-session';
const PENDING_ACCOUNT_STORAGE_KEY = 'idtt-pending-account';
const IDTT_MEETING_WEEKDAY = 4;
const DEFAULT_AGENDA_PDF_COLOR = '#c08c66';
const DEFAULT_AGENDA_PDF_HUE = 26;
const getInitialUrlParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    email: params.get('email') ?? '',
    token: params.get('token') ?? '',
    isReset: params.get('reset') === '1',
    isVerify: params.get('verify') === '1',
    offerToken: params.get('offer') ?? '',
  };
};
const availabilityOptions = [
  { value: 'always', label: 'Always available' },
  { value: 'tentative', label: 'Always tentative' },
  { value: 'never', label: 'Never available' },
] as const;
const availabilityExceptionOptions: Array<{ value: EditableAvailabilityStatus; label: string }> = [
  { value: 'always', label: 'Available' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'never', label: 'Unavailable' },
];
const roleAvailabilityOptions: Array<{ value: RoleKey; label: string }> = [
  { value: 'openingToast', label: 'Opening Toast' },
  { value: 'educationalMoment', label: 'Educational Moment' },
  { value: 'grammarians', label: 'Grammarian' },
  { value: 'toastmaster', label: 'Toastmaster' },
  { value: 'improvmaster', label: 'Improvmaster' },
  { value: 'topics', label: 'Barroom Topics' },
  { value: 'speaker', label: 'Speaker(s)' },
  { value: 'generalEvaluator', label: 'General Evaluator' },
  { value: 'evaluators', label: 'Evaluator(s)' },
  { value: 'timer', label: 'Timer' },
] as const;
const agendaTemplateDefaults: Record<string, Partial<AgendaItem>> = {
  openingToast: { title: 'Opening Toast', durationMinutes: 5, notes: 'Welcome and introductions', meetingMode: 'all' },
  toastmaster: { title: 'Toastmaster', durationMinutes: 5, optional: false, meetingMode: 'all' },
  educationalMoment: { title: 'Educational Moment', durationMinutes: 5, meetingMode: 'all' },
  grammarian: { title: 'Grammarian', durationMinutes: 3, meetingMode: 'all' },
  barroomTopics: { title: 'Barroom Topics', durationMinutes: 15, meetingMode: 'standard' },
  speaker1: { title: 'Speaker 1', durationMinutes: 12, meetingMode: 'standard' },
  speaker2: { title: 'Speaker 2', durationMinutes: 12, meetingMode: 'standard' },
  generalEvaluator: { title: 'General Evaluator', durationMinutes: 10, meetingMode: 'all' },
  speechEvaluator1: { title: 'Speech Evaluator 1', durationMinutes: 8, evaluatorMode: 'individual', meetingMode: 'standard' },
  speechEvaluator2: { title: 'Speech Evaluator 2', durationMinutes: 8, evaluatorMode: 'individual', meetingMode: 'standard' },
  timer: { title: 'Timer', durationMinutes: 3, meetingMode: 'all' },
  improvmaster1: { title: 'Improvmaster 1', durationMinutes: 15, meetingMode: 'improv' },
  improvmaster2: { title: 'Improvmaster 2', durationMinutes: 15, meetingMode: 'improv' },
};

type EditableAvailabilityStatus = (typeof availabilityOptions)[number]['value'];
type EditableRoleKey = (typeof roleAvailabilityOptions)[number]['value'];

const getScheduledMeetings = (schedule: ScheduleResponse | null) => {
  if (!schedule) {
    return [];
  }

  if (Array.isArray(schedule.meetings) && schedule.meetings.length > 0) {
    return schedule.meetings;
  }

  return [
    {
      meetingId: 'current-meeting',
      meetingDate: schedule.meetingDate,
      assignments: schedule.assignments,
    },
  ];
};

const normalizeAvailabilityStatus = (value: AvailabilityStatus | undefined): EditableAvailabilityStatus =>
  value === 'tentative' || value === 'never' ? value : 'always';

const normalizeEligibleRoles = (value: RoleKey[] | undefined): EditableRoleKey[] => {
  const allowed = new Set<EditableRoleKey>(roleAvailabilityOptions.map((option) => option.value));
  const normalized = (value ?? []).filter((role): role is EditableRoleKey => allowed.has(role as EditableRoleKey));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : roleAvailabilityOptions.map((option) => option.value);
};

const createUtcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day, 12, 0, 0));

const parseDateKey = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return new Date(`${value}T12:00:00`);
  }

  return createUtcDate(year, month - 1, day);
};

const formatDateKey = (value: Date) => value.toISOString().slice(0, 10);

const formatMeetingDate = (value: string) => {
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

const formatMeetingMonthDay = (value: string) => {
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });
};

const formatMeetingMonthDayYear = (value: string) => {
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatActivityTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatMonthLabel = (value: Date) =>
  value.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

const formatMemberDisplayName = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token, index, tokens) => index === 0 || index === tokens.length - 1 || !/^[A-Za-z]\.?$/.test(token))
    .join(' ')
    .trim() || value;

const getMemberFirstName = (value: string) => {
  const displayName = formatMemberDisplayName(value).trim();
  return displayName.split(/\s+/)[0] ?? displayName;
};

const formatMemberPhoneNumber = (value: string | null | undefined) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) {
    return 'Not listed';
  }

  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
};

const formatMemberPhoneHref = (value: string | null | undefined) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) {
    return '';
  }

  return `tel:+1${normalized}`;
};

const formatMemberEmailHref = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  return `mailto:${normalized}`;
};

const getMemberAvailabilityForMeeting = (
  member: Pick<ClubMemberRecord, 'availabilityDefault' | 'availabilityOverrides'>,
  meetingDate: string,
): EditableAvailabilityStatus =>
  normalizeAvailabilityStatus(member.availabilityOverrides?.[meetingDate] ?? member.availabilityDefault);

const getAvailabilitySelectOptionStyle = (status: EditableAvailabilityStatus) => {
  if (status === 'tentative') {
    return {
      color: '#5a5550',
    };
  }

  if (status === 'never') {
    return {
      color: '#b8b1aa',
    };
  }

  return {
    color: '#1f1f1f',
  };
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildPrintableRosterDocument = (members: ClubMemberRecord[], printedDate: string) => {
  const rows = members
    .map(
      (member) => `
        <tr>
          <td>${escapeHtml(formatMemberDisplayName(member.name))}</td>
          <td>${escapeHtml(formatMemberPhoneNumber(member.phoneNumber))}</td>
          <td><a href="${escapeHtml(formatMemberEmailHref(member.email))}">${escapeHtml(member.email)}</a></td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(IDTT_CLUB_NAME)} Club Roster</title>
    <style>
      @page {
        size: letter;
        margin: 0.65in;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: #2f3642;
        background: #ffffff;
      }

      .page {
        width: 100%;
        min-height: calc(11in - 1.3in);
        display: flex;
        flex-direction: column;
      }

      .header {
        margin-bottom: 1.1rem;
      }

      .title {
        margin: 0;
        font-size: 2rem;
        line-height: 1.05;
        color: #7a2e1f;
        font-weight: 800;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      col.name-col {
        width: 34%;
      }

      col.phone-col {
        width: 20%;
      }

      col.email-col {
        width: 46%;
      }

      th,
      td {
        padding: 0.8rem 0.95rem;
        border: 1px solid #d9cdbf;
        text-align: left;
        vertical-align: top;
      }

      th {
        font-size: 0.9rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #9d5d39;
        background: #fbf3ea;
      }

      td {
        font-size: 1rem;
        word-break: break-word;
      }

      a {
        color: #9d4a2f;
        font-weight: 700;
        text-decoration: none;
      }

      tbody tr:nth-child(even) td {
        background: #fdf8f2;
      }

      .footer {
        margin-top: auto;
        padding-top: 1rem;
        font-size: 0.92rem;
        color: #8b5337;
        text-align: right;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <h1 class="title">${escapeHtml(IDTT_CLUB_NAME)}</h1>
      </header>
      <table>
        <colgroup>
          <col class="name-col" />
          <col class="phone-col" />
          <col class="email-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone Number</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="footer">${escapeHtml(printedDate)}</footer>
    </main>
  </body>
</html>`;
};

const formatPrintableAgendaDateTime = (meetingDate: string) => {
  const parsed = parseDateKey(meetingDate);
  if (Number.isNaN(parsed.getTime())) {
    return `${meetingDate} 6:30 PM`;
  }

  return `${parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })} 6:30 PM`;
};

const buildPrintableAgendaDocument = (meeting: ScheduledMeeting) => {
  const rows = meeting.assignments
    .map(
      (assignment) => `
        <tr>
          <td>${escapeHtml(assignment.role)}</td>
          <td>${escapeHtml(
            assignment.memberName
              ? formatMemberDisplayName(assignment.memberName)
              : assignment.memberId ?? 'Unassigned',
          )}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(IDTT_CLUB_NAME)} Agenda</title>
    <style>
      @page {
        size: letter;
        margin: 0.65in;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: #2f3642;
        background: #ffffff;
      }

      .page {
        width: 100%;
      }

      .header {
        margin-bottom: 1.25rem;
      }

      .title {
        margin: 0;
        font-size: 1.95rem;
        line-height: 1.05;
        color: #7a2e1f;
        font-weight: 800;
      }

      .subtitle {
        margin: 0.45rem 0 0;
        font-size: 1rem;
        color: #8b5337;
        font-weight: 700;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      col.role-col {
        width: 42%;
      }

      col.member-col {
        width: 58%;
      }

      th,
      td {
        padding: 0.8rem 0.95rem;
        border: 1px solid #d9cdbf;
        text-align: left;
        vertical-align: top;
      }

      th {
        font-size: 0.9rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #9d5d39;
        background: #fbf3ea;
      }

      td {
        font-size: 1rem;
        word-break: break-word;
      }

      tbody tr:nth-child(even) td {
        background: #fdf8f2;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <h1 class="title">${escapeHtml(IDTT_CLUB_NAME)}</h1>
        <p class="subtitle">${escapeHtml(formatPrintableAgendaDateTime(meeting.meetingDate))}</p>
      </header>
      <table>
        <colgroup>
          <col class="role-col" />
          <col class="member-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Role</th>
            <th>Member</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </main>
  </body>
</html>`;
};

const normalizePdfText = (value: string) =>
  value
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '');

const escapePdfText = (value: string) =>
  normalizePdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');

const splitPdfText = (value: string, maxLength: number) => {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
      return;
    }

    if (current) {
      lines.push(current);
    }

    if (word.length > maxLength) {
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      current = '';
      return;
    }

    current = word;
  });

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
};

const normalizeAgendaAssignmentRole = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const getAgendaAssignmentMemberName = (meeting: ScheduledMeeting, roles: string[]) => {
  const allowedRoles = new Set(roles.map((role) => normalizeAgendaAssignmentRole(role)));
  const assignment = meeting.assignments.find((entry) =>
    allowedRoles.has(normalizeAgendaAssignmentRole(entry.role)),
  );

  if (!assignment) {
    return 'TBD';
  }

  return assignment.memberName
    ? formatMemberDisplayName(assignment.memberName)
    : assignment.memberId ?? 'TBD';
};

const getAgendaAssignmentSpeechInfo = (meeting: ScheduledMeeting, roles: string[]) => {
  const allowedRoles = new Set(roles.map((role) => normalizeAgendaAssignmentRole(role)));
  const assignment = meeting.assignments.find((entry) =>
    allowedRoles.has(normalizeAgendaAssignmentRole(entry.role)),
  );
  if (!assignment?.speechTitle && !assignment?.speechTime) return null;
  const parts = [assignment.speechTitle, assignment.speechTime ? `(${assignment.speechTime})` : null].filter(Boolean);
  return parts.join(' ');
};

const hasAgendaAssignmentRole = (meeting: ScheduledMeeting, roles: string[]) => {
  const allowedRoles = new Set(roles.map((role) => normalizeAgendaAssignmentRole(role)));
  return meeting.assignments.some((entry) => allowedRoles.has(normalizeAgendaAssignmentRole(entry.role)));
};

const getMeetingToastmasterEmail = (meeting: ScheduledMeeting) =>
  meeting.assignments.find((entry) => normalizeAgendaAssignmentRole(entry.role) === 'toastmaster')?.memberEmail?.toLowerCase() ?? null;

const normalizeHexColor = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return DEFAULT_AGENDA_PDF_COLOR;
};

const hexToPdfRgb = (hex: string) => {
  const normalized = normalizeHexColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  return `${red.toFixed(2)} ${green.toFixed(2)} ${blue.toFixed(2)}`;
};

const hueToHex = (hue: number, saturation = 50, lightness = 58) => {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const huePrime = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma; green = x;
  } else if (huePrime < 2) {
    red = x; green = chroma;
  } else if (huePrime < 3) {
    green = chroma; blue = x;
  } else if (huePrime < 4) {
    green = x; blue = chroma;
  } else if (huePrime < 5) {
    red = x; blue = chroma;
  } else {
    red = chroma; blue = x;
  }

  const match = l - chroma / 2;
  const toHex = (value: number) => Math.round((value + match) * 255).toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
};

const hexToHue = (hex: string) => {
  const normalized = normalizeHexColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta === 0) return DEFAULT_AGENDA_PDF_HUE;

  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return Math.round((hue * 60 + 360) % 360);
};

const blendHexWithWhite = (hex: string, amount: number) => {
  const normalized = normalizeHexColor(hex);
  const blendChannel = (start: number) => Math.round(start + (255 - start) * amount);
  const red = blendChannel(Number.parseInt(normalized.slice(1, 3), 16));
  const green = blendChannel(Number.parseInt(normalized.slice(3, 5), 16));
  const blue = blendChannel(Number.parseInt(normalized.slice(5, 7), 16));
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const blendHexWithBlack = (hex: string, amount: number) => {
  const normalized = normalizeHexColor(hex);
  const blendChannel = (start: number) => Math.round(start * (1 - amount));
  const red = blendChannel(Number.parseInt(normalized.slice(1, 3), 16));
  const green = blendChannel(Number.parseInt(normalized.slice(3, 5), 16));
  const blue = blendChannel(Number.parseInt(normalized.slice(5, 7), 16));
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const getRosterOfficerName = (members: ClubMemberRecord[], matcher: RegExp) => {
  const match = members.find((member) => matcher.test(String(member.currentPosition ?? '')));
  if (match) {
    return formatMemberDisplayName(match.name);
  }

  const fallbackOfficerEmail =
    matcher.source === 'club president'
      ? 'liz.a.delsignore@gmail.com'
      : matcher.source === 'club sergeant at arms'
        ? 'butlerlife444@gmail.com'
        : '';
  const fallbackOfficer = members.find((member) => member.email.toLowerCase() === fallbackOfficerEmail);
  return fallbackOfficer ? formatMemberDisplayName(fallbackOfficer.name) : 'TBD';
};

type AgendaPdfRow = {
  label: string;
  memberName?: string;
  speechInfo?: string | null;
  sectionHeader?: string;
};

const buildAgendaPdfRows = (meeting: ScheduledMeeting, members: ClubMemberRecord[]): AgendaPdfRow[] => {
  const openingToast = getAgendaAssignmentMemberName(meeting, ['Opening Toast']);
  const educationalMoment = getAgendaAssignmentMemberName(meeting, ['Educational Moment']);
  const grammarian = getAgendaAssignmentMemberName(meeting, ['Grammarian']);
  const toastmaster = getAgendaAssignmentMemberName(meeting, ['Toastmaster']);
  const topicsmaster = getAgendaAssignmentMemberName(meeting, ['Barroom Topics', 'Topics']);
  const improvmaster1 = getAgendaAssignmentMemberName(meeting, ['Improvmaster 1', 'Improvmaster']);
  const improvmaster2 = getAgendaAssignmentMemberName(meeting, ['Improvmaster 2']);
  const timer = getAgendaAssignmentMemberName(meeting, ['Timer']);
  const speaker1 = getAgendaAssignmentMemberName(meeting, ['Speaker 1']);
  const speaker2 = getAgendaAssignmentMemberName(meeting, ['Speaker 2']);
  const generalEvaluator = getAgendaAssignmentMemberName(meeting, ['General Evaluator']);
  const speechEvaluator1 = getAgendaAssignmentMemberName(meeting, ['Speech Evaluator 1']);
  const speechEvaluator2 = getAgendaAssignmentMemberName(meeting, ['Speech Evaluator 2']);
  const hasSecondSpeaker = hasAgendaAssignmentRole(meeting, ['Speaker 2']);
  const hasSecondSpeechEvaluator = hasAgendaAssignmentRole(meeting, ['Speech Evaluator 2']);
  const president = getRosterOfficerName(members, /club president/i);
  const sargentAtArms = getRosterOfficerName(members, /club sergeant at arms/i);
  const isImprovMeeting = meeting.assignments.some((entry) => {
    const normalizedRole = normalizeAgendaAssignmentRole(entry.role);
    return normalizedRole.includes('improvmaster');
  });

  if (isImprovMeeting) {
    return [
      { label: 'Sargent at Arms calls the meeting to order', memberName: sargentAtArms },
      { label: 'Sargent at Arms introduces the President', memberName: president },
      { label: 'President introduces:' },
      { label: 'Opening Toast', memberName: openingToast },
      { label: 'Educational Moment', memberName: educationalMoment },
      { label: 'Grammarian', memberName: grammarian },
      { label: 'President turns the meeting over to Toastmaster', memberName: toastmaster },
      { label: 'Toastmaster introduces Improvmasters', memberName: improvmaster2 && improvmaster2 !== 'TBD' ? `${improvmaster1} & ${improvmaster2}` : improvmaster1 },
      { label: 'Improvmaster returns control to Toastmaster', memberName: toastmaster },
      { label: 'Toastmaster introduces General Evaluator', memberName: generalEvaluator },
      { label: "General Evaluator calls up Grammarian for Grammarian's Report", memberName: grammarian },
      { label: 'General Evaluator returns control to Toastmaster', memberName: toastmaster },
      { label: 'Toastmaster returns control to the President', memberName: president },
    ];
  }

  const rows: AgendaPdfRow[] = [
    { sectionHeader: 'Meeting Opening', label: 'Sargent at Arms calls the meeting to order', memberName: sargentAtArms },
    { label: 'Sargent at Arms introduces the President', memberName: president },
    { label: 'President introduces:' },
    { label: 'Opening Toast', memberName: openingToast },
    { label: 'Educational Moment', memberName: educationalMoment },
    { label: 'Grammarian', memberName: grammarian },
    { label: 'President turns the meeting over to Toastmaster', memberName: toastmaster },
    { label: 'Toastmaster introduces Barroom Topicsmaster', memberName: topicsmaster },
    { label: "Timer's Report", memberName: timer },
    { label: 'Barroom Topicsmaster returns control to Toastmaster', memberName: toastmaster },
    { label: 'Toastmaster introduces Speaker 1', memberName: speaker1, speechInfo: getAgendaAssignmentSpeechInfo(meeting, ['Speaker 1']) },
    { label: "Timer's Report", memberName: timer },
    { sectionHeader: 'Evaluations & Close', label: 'Toastmaster introduces General Evaluator', memberName: generalEvaluator },
    { label: 'General Evaluator will call on the' },
    { label: 'Speech Evaluator 1', memberName: speechEvaluator1 },
    { label: "Timer's Report", memberName: timer },
    { label: "General Evaluator calls up Grammarian for Grammarian's Report", memberName: grammarian },
    { label: 'General Evaluator returns control to Toastmaster', memberName: toastmaster },
    { label: 'Toastmaster returns control to the President', memberName: president },
  ];

  if (hasSecondSpeaker) {
    rows.splice(11, 0, {
      label: 'Toastmaster introduces Speaker 2',
      memberName: speaker2,
      speechInfo: getAgendaAssignmentSpeechInfo(meeting, ['Speaker 2']),
    });
  }

  if (hasSecondSpeechEvaluator) {
    rows.splice(15, 0, {
      label: 'Speech Evaluator 2',
      memberName: speechEvaluator2,
    });
  }

  return rows;
};

const buildAgendaPdfBlob = async (
  meeting: ScheduledMeeting,
  members: ClubMemberRecord[],
  options?: { theme?: string | null; pdfColor?: string | null; notes?: string | null },
): Promise<Blob> => {
  const pageWidth = 612;
  const pageHeight = 792;
  const left = 54;
  const right = 558;
  const memberColumnX = 366;
  const footerTop = 110;
  const footerBottomPadding = 16;
  let currentY = 742;
  const content: string[] = [];
  const theme = options?.theme ?? null;
  const notes = options?.notes?.trim() ?? '';
  const pdfColorHex = normalizeHexColor(options?.pdfColor);
  const accentColor = hexToPdfRgb(pdfColorHex);
  const paleRowColor = hexToPdfRgb(blendHexWithWhite(pdfColorHex, 0.86));
  const darkAccentColor = hexToPdfRgb(blendHexWithBlack(pdfColorHex, 0.72));
  const activeStyle = {
    primary: darkAccentColor,
    secondary: darkAccentColor,
    body: '0.14 0.16 0.20',
    accent: accentColor,
    rowA: paleRowColor,
    rowB: '1 1 1',
    open: '0.60 0.55 0.52',
    labelFont: 10,
    memberFont: 10,
    speechFont: 8.5,
    rowTopPadding: 10,
    rowBottomPadding: 0,
    rowLineHeight: 10.8,
    themeFont: 11,
  };
  // F1 = Helvetica, F2 = Helvetica-Bold, F3 = Helvetica-Oblique
  const addText = (text: string, x: number, y: number, fontSize: number, color = '0.18 0.21 0.26', font = 'F1') => {
    content.push(`BT /${font} ${fontSize} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`);
  };
  const addLine = (x1: number, y1: number, x2: number, y2: number, width = 0.5, color = '0.82 0.76 0.70') => {
    content.push(`${width} w ${color} RG ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const addFilledRect = (x: number, y: number, width: number, height: number, color: string) => {
    content.push(`${color} rg ${x} ${y} ${width} ${height} re f`);
  };

  // Load logo — render at 4× for sharpness, display at logoDisplayH pts
  let logoRgb: Uint8Array | null = null;
  let logoPixelW = 0;
  const logoDisplayH = 54;
  const logoRenderScale = 4;
  const logoPixelH = logoDisplayH * logoRenderScale;
  let logoDisplayW = 0;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = idttLogoBlack; });
    logoPixelW = Math.round(img.naturalWidth * (logoPixelH / img.naturalHeight));
    logoDisplayW = Math.round(logoPixelW / logoRenderScale);
    const canvas = document.createElement('canvas');
    canvas.width = logoPixelW; canvas.height = logoPixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, logoPixelW, logoPixelH);
    ctx.drawImage(img, 0, 0, logoPixelW, logoPixelH);
    const { data } = ctx.getImageData(0, 0, logoPixelW, logoPixelH);
    logoRgb = new Uint8Array(logoPixelW * logoPixelH * 3);
    for (let i = 0; i < logoPixelW * logoPixelH; i++) {
      const a = data[i * 4 + 3] / 255;
      logoRgb[i * 3] = Math.round(data[i * 4] * a + 255 * (1 - a));
      logoRgb[i * 3 + 1] = Math.round(data[i * 4 + 1] * a + 255 * (1 - a));
      logoRgb[i * 3 + 2] = Math.round(data[i * 4 + 2] * a + 255 * (1 - a));
    }
    // Draw at display size in top-right of header
    content.push(`q ${logoDisplayW} 0 0 ${logoDisplayH} ${right - logoDisplayW} ${currentY - logoDisplayH + 8} cm /Logo Do Q`);
  } catch { logoRgb = null; }

  // Header
  addText(IDTT_CLUB_NAME, left, currentY, 22, activeStyle.primary, 'F2');
  currentY -= 20;
  addText(formatPrintableAgendaDateTime(meeting.meetingDate), left, currentY, 11, activeStyle.secondary);
  currentY -= 12;
  addText('The Lombardi Room at Rum Runner Lounge', left, currentY, 8.5, activeStyle.secondary, 'F3');
  currentY -= 10;
  addText('1801 E Tropicana Ave, Las Vegas, NV', left, currentY, 8.5, activeStyle.secondary, 'F3');
  currentY -= 12;

  if (theme) {
    const themeText = `Theme: ${theme}`;
    const themeX = left + (right - left - themeText.length * 5.5) / 2;
    addText(themeText, Math.max(left, themeX), currentY, activeStyle.themeFont, activeStyle.primary, 'F3');
    currentY -= 12;
  }

  addLine(left, currentY, right, currentY, 1, activeStyle.accent);
  currentY -= 10;

  const agendaRows = buildAgendaPdfRows(meeting, members);
  const noteLines = notes ? splitPdfText(notes, 110).slice(0, 4) : [];
  const notesHeight = noteLines.length > 0 ? 22 + noteLines.length * 10 : 0;
  const agendaBottomY = footerTop + footerBottomPadding + notesHeight;
  agendaRows.forEach((row, rowIndex) => {
    const wrappedLabels = splitPdfText(row.label, row.memberName ? 54 : 96);
    const isTbd = !row.memberName || row.memberName === 'TBD';
    const printableMemberName = isTbd ? '- open' : row.memberName!;
    const wrappedMemberNames = row.memberName ? splitPdfText(printableMemberName, 24) : [];
    const rowLineCount = Math.max(wrappedLabels.length, wrappedMemberNames.length || 1);
    const rowHeight =
      activeStyle.rowTopPadding +
      rowLineCount * activeStyle.rowLineHeight +
      (row.speechInfo ? activeStyle.rowLineHeight : 0) +
      activeStyle.rowBottomPadding;
    const rowBottomY = currentY - rowHeight;
    if (rowBottomY < agendaBottomY) {
      return;
    }

    addFilledRect(left - 6, rowBottomY, right - left + 12, rowHeight, rowIndex % 2 === 0 ? activeStyle.rowA : activeStyle.rowB);
    currentY -= activeStyle.rowTopPadding;

    for (let index = 0; index < rowLineCount; index += 1) {
      const labelLine = wrappedLabels[index] ?? '';
      const memberLine = wrappedMemberNames[index] ?? '';
      if (labelLine) addText(labelLine, left, currentY, activeStyle.labelFont, activeStyle.body, 'F2');
      if (memberLine) addText(memberLine, memberColumnX, currentY, activeStyle.memberFont, isTbd ? activeStyle.open : '0.10 0.12 0.16', isTbd ? 'F3' : 'F1');
      currentY -= activeStyle.rowLineHeight;
    }

    if (row.speechInfo) {
      addText(row.speechInfo, memberColumnX, currentY, activeStyle.speechFont, activeStyle.secondary, 'F3');
      currentY -= activeStyle.rowLineHeight;
    }

    currentY -= activeStyle.rowBottomPadding;
  });

  // Officers — fixed footer near the bottom regardless of content height
  if (noteLines.length > 0) {
    const notesTop = footerTop + notesHeight;
    addLine(left, notesTop, right, notesTop, 0.5, activeStyle.accent);
    let notesY = notesTop - 16;
    noteLines.forEach((line) => {
      addText(line, left, notesY, 8.2, activeStyle.body, 'F1');
      notesY -= 10;
    });
  }

  const getOfficer = (regex: RegExp) => getRosterOfficerName(members, regex);
  const officerRows: Array<[string, string, string, string]> = [
    ['President', getOfficer(/club president/i), 'Secretary', getOfficer(/club secretary/i)],
    ['VP Education', getOfficer(/club vp education/i), 'Treasurer', getOfficer(/club treasurer/i)],
    ['VP Public Relations', getOfficer(/club vp pr/i), 'Sergeant at Arms', getOfficer(/club sergeant at arms/i)],
  ];
  addLine(left, footerTop, right, footerTop, 0.5, activeStyle.accent);
  addText('CLUB OFFICERS', left, footerTop - 12, 7.5, activeStyle.primary, 'F2');
  const col2X = 320;
  let footerY = footerTop - 26;
  officerRows.forEach(([role1, name1, role2, name2]) => {
    const ok1 = name1 && name1 !== 'TBD';
    const ok2 = name2 && name2 !== 'TBD';
    if (ok1 || ok2) {
      if (ok1) { addText(`${role1}:`, left, footerY, 8, activeStyle.secondary, 'F2'); addText(name1, left + 90, footerY, 8, activeStyle.body, 'F1'); }
      if (ok2) { addText(`${role2}:`, col2X, footerY, 8, activeStyle.secondary, 'F2'); addText(name2, col2X + 95, footerY, 8, activeStyle.body, 'F1'); }
      footerY -= 13;
    }
  });

  // Build PDF with TextEncoder for byte-accurate xref (needed for binary image data)
  const enc = new TextEncoder();
  const parts: ArrayBuffer[] = [];
  let byteOffset = 0;
  const objOffsets: number[] = [];

  const addStr = (s: string) => { const b = enc.encode(s); parts.push(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); byteOffset += b.byteLength; };
  const addBin = (b: Uint8Array) => { parts.push(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); byteOffset += b.byteLength; };
  const markObj = () => objOffsets.push(byteOffset);

  addStr('%PDF-1.4\n');

  markObj(); addStr('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  markObj(); addStr('2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n');

  markObj();
  const xobjRes = logoRgb ? ' /XObject << /Logo 8 0 R >>' : '';
  addStr(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >>${xobjRes} >> /Contents 4 0 R >> endobj\n`);

  markObj();
  const streamBytes = enc.encode(content.join('\n'));
  addStr(`4 0 obj << /Length ${streamBytes.byteLength} >> stream\n`);
  addBin(streamBytes);
  addStr('\nendstream endobj\n');

  markObj(); addStr('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');
  markObj(); addStr('6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n');
  markObj(); addStr('7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >> endobj\n');

  if (logoRgb) {
    markObj();
    addStr(`8 0 obj << /Type /XObject /Subtype /Image /Width ${logoPixelW} /Height ${logoPixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${logoRgb.byteLength} >> stream\n`);
    addBin(logoRgb);
    addStr('\nendstream endobj\n');
  }

  const xrefStart = byteOffset;
  const numObjs = logoRgb ? 9 : 8;
  let xref = `xref\n0 ${numObjs}\n0000000000 65535 f \n`;
  for (const off of objOffsets) xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  xref += `trailer << /Size ${numObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  addStr(xref);

  return new Blob(parts, { type: 'application/pdf' });
};

const buildAgendaClipboardText = (meeting: ScheduledMeeting) => {
  const lines = [
    formatMeetingMonthDayYear(meeting.meetingDate),
    ...(meeting.theme ? [`Theme: ${meeting.theme}`] : []),
    ...(meeting.notes ? [`Notes: ${meeting.notes}`] : []),
    ...meeting.assignments.flatMap((assignment) => {
      const memberName = assignment.memberName
        ? formatMemberDisplayName(assignment.memberName)
        : assignment.memberId ?? 'Unassigned';
      const row = [`${assignment.role}: ${memberName}`];
      if (assignment.speechTitle || assignment.speechTime) {
        const parts = [assignment.speechTitle, assignment.speechTime ? `(${assignment.speechTime})` : null].filter(Boolean);
        row.push(`  ${parts.join(' ')}`);
      }
      return row;
    }),
  ];

  return lines.join('\n');
};

const formatMonthName = (value: Date) =>
  value.toLocaleDateString(undefined, {
    month: 'long',
  });

const getNextMeetingDateKey = () => {
  const today = createUtcDate(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const daysUntilMeeting = (IDTT_MEETING_WEEKDAY - today.getUTCDay() + 7) % 7;
  return formatDateKey(new Date(today.getTime() + daysUntilMeeting * 24 * 60 * 60 * 1000));
};

type CalendarDay = {
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isMeetingDay: boolean;
  isPast: boolean;
};

type CalendarMonth = {
  monthKey: string;
  label: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  weeks: CalendarDay[][];
};

const buildAvailabilityCalendarMonth = (monthOffset: number): CalendarMonth => {
  const today = createUtcDate(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const todayKey = formatDateKey(today);
  const currentMonthStart = createUtcDate(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const monthStart = createUtcDate(
    currentMonthStart.getUTCFullYear(),
    currentMonthStart.getUTCMonth() + monthOffset,
    1,
  );
  const monthYear = monthStart.getUTCFullYear();
  const monthIndex = monthStart.getUTCMonth();
  const nextMonthStart = createUtcDate(monthYear, monthIndex + 1, 1);
  const monthEnd = new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000);
  const gridStart = new Date(monthStart.getTime() - monthStart.getUTCDay() * 24 * 60 * 60 * 1000);
  const gridEnd = new Date(monthEnd.getTime() + (6 - monthEnd.getUTCDay()) * 24 * 60 * 60 * 1000);
  const weeks: CalendarDay[][] = [];
  let cursor = gridStart;

  while (cursor <= gridEnd) {
    const week: CalendarDay[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dateKey = formatDateKey(cursor);
      week.push({
        dateKey,
        dayNumber: cursor.getUTCDate(),
        isCurrentMonth: cursor.getUTCMonth() === monthIndex,
        isMeetingDay: cursor.getUTCDay() === IDTT_MEETING_WEEKDAY && dateKey >= todayKey,
        isPast: dateKey < todayKey,
      });
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    weeks.push(week);
  }

  return {
    monthKey: `${monthYear}-${monthIndex + 1}`,
    label: formatMonthLabel(monthStart),
    previousMonthLabel: formatMonthName(createUtcDate(monthYear, monthIndex - 1, 1)),
    nextMonthLabel: formatMonthName(createUtcDate(monthYear, monthIndex + 1, 1)),
    weeks,
  };
};

function App() {
  const initialResetParams = getInitialUrlParams();
  const availabilityAutosaveTimeoutRef = useRef<number | null>(null);
  const adminAvailabilityAutosaveTimeoutRef = useRef<number | null>(null);
  const availabilityLoadedRef = useRef(false);
  const adminAvailabilityLoadedRef = useRef(false);
  const lastSavedAvailabilityRef = useRef('');
  const lastSavedAdminAvailabilityRef = useRef('');
  const [session, setSession] = useState<UserSession | null>(() => {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as UserSession;
    } catch {
      return null;
    }
  });
  const [pendingAccount, setPendingAccount] = useState<UserSession | null>(() => {
    const stored = window.sessionStorage.getItem(PENDING_ACCOUNT_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as UserSession;
    } catch {
      return null;
    }
  });
  const [view, setView] = useState<ViewMode>(() => {
    if (initialResetParams.isReset && initialResetParams.email && initialResetParams.token) {
      return 'resetPassword';
    }

    if (initialResetParams.isVerify && initialResetParams.email && initialResetParams.token) {
      return 'verifyEmail';
    }

    if (session) {
      return 'dashboard';
    }

    if (pendingAccount) {
      return 'setup';
    }

    return 'login';
  });
  const [email, setEmail] = useState(initialResetParams.email);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState(initialResetParams.token);
  const [verifyToken, setVerifyToken] = useState(initialResetParams.isVerify ? initialResetParams.token : '');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminProfileBio, setAdminProfileBio] = useState('');
  const [adminProfileImageUrl, setAdminProfileImageUrl] = useState<string | null>(null);
  const [savingAdminProfile, setSavingAdminProfile] = useState(false);
  const [generatingSetupLink, setGeneratingSetupLink] = useState(false);
  const [savingRosterImport, setSavingRosterImport] = useState(false);
  const [pendingRosterImportText, setPendingRosterImportText] = useState('');
  const [pendingRosterImportFileName, setPendingRosterImportFileName] = useState('');
  const [savingAdminAvailability, setSavingAdminAvailability] = useState(false);
  const [savingAgenda, setSavingAgenda] = useState(false);
  const [hideUnlockedAgendas, setHideUnlockedAgendas] = useState(false);
  const [savingHideUnlocked, setSavingHideUnlocked] = useState(false);
  const [scheduleActionMeeting, setScheduleActionMeeting] = useState<string | null>(null);
  const [savingScheduleSlot, setSavingScheduleSlot] = useState<string | null>(null);
  const [editingScheduleMeeting, setEditingScheduleMeeting] = useState<string | null>(null);
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [adminSection, setAdminSection] = useState<AdminSection>('members');
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [activityMembers, setActivityMembers] = useState<ActivityMemberStatus[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [rosterMember, setRosterMember] = useState<ClubMemberRecord | null>(null);
  const [clubRoster, setClubRoster] = useState<ClubMemberRecord[]>([]);
  const [availabilityDefault, setAvailabilityDefault] = useState<EditableAvailabilityStatus>('always');
  const [availabilityOverrides, setAvailabilityOverrides] = useState<Record<string, EditableAvailabilityStatus>>({});
  const [eligibleRoles, setEligibleRoles] = useState<EditableRoleKey[]>(roleAvailabilityOptions.map((option) => option.value));
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState<string | null>(null);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);
  const [draftAvailabilityStatus, setDraftAvailabilityStatus] = useState<EditableAvailabilityStatus>('always');
  const [portalTab, setPortalTab] = useState<PortalTab>('dashboard');
  const [memberSettingsSection, setMemberSettingsSection] = useState<MemberSettingsSection>('menu');
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [adminTargetEmail, setAdminTargetEmail] = useState('');
  const [adminAvailabilityDefault, setAdminAvailabilityDefault] = useState<EditableAvailabilityStatus>('always');
  const [adminAvailabilityOverrides, setAdminAvailabilityOverrides] = useState<Record<string, EditableAvailabilityStatus>>({});
  const [adminEligibleRoles, setAdminEligibleRoles] = useState<EditableRoleKey[]>(roleAvailabilityOptions.map((option) => option.value));
  const [adminCalendarMonthOffset, setAdminCalendarMonthOffset] = useState(0);
  const [selectedAdminAvailabilityDate, setSelectedAdminAvailabilityDate] = useState<string | null>(null);
  const [adminAvailabilityModalOpen, setAdminAvailabilityModalOpen] = useState(false);
  const [draftAdminAvailabilityStatus, setDraftAdminAvailabilityStatus] = useState<EditableAvailabilityStatus>('always');
  const [adminConfirmModal, setAdminConfirmModal] = useState<{ meetingDate: string; slotId: string; role: string; memberName: string; action: 'confirm' | 'undo' } | null>(null);
  const [themeModal, setThemeModal] = useState<{ meetingDate: string } | null>(null);
  const [themeInput, setThemeInput] = useState('');
  const [themePdfHueInput, setThemePdfHueInput] = useState(DEFAULT_AGENDA_PDF_HUE);
  const [themeNotesInput, setThemeNotesInput] = useState('');
  const [speechModal, setSpeechModal] = useState<{ meetingDate: string; slotId: string; role: string } | null>(null);
  const [speechTitleInput, setSpeechTitleInput] = useState('');
  const [speechTimeInput, setSpeechTimeInput] = useState('');
  const [offerRoleModal, setOfferRoleModal] = useState<{ meetingDate: string; slotId: string; role: string; offerUrl: string } | null>(null);
  const [memberSetupLinkModal, setMemberSetupLinkModal] = useState<{ memberName: string; memberEmail: string; setupUrl: string } | null>(null);
  const [pendingOfferToken, setPendingOfferToken] = useState(initialResetParams.offerToken);
  const [incomingOffer, setIncomingOffer] = useState<{ token: string; role: string; meetingDate: string; offeredByName: string } | null>(null);
  const [backExitWarning, setBackExitWarning] = useState(false);
  const backPressCountRef = useRef(0);

  const isOfficer = rosterMember?.roles.includes('admin')
    ?? session?.memberships.some(
      (membership) => membership.clubId === IDTT_CLUB_ID && membership.roles.includes('admin'),
    )
    ?? false;

  const refreshSchedule = async (memberEmail = session?.email) => {
    if (!memberEmail) {
      return;
    }

    const response = await apiClient.get<ScheduleResponse>('/engine/schedule', {
      params: {
        clubId: IDTT_CLUB_ID,
        email: memberEmail,
        weeks: 4,
      },
    });
    setSchedule(response.data);
    setHideUnlockedAgendas(response.data.hideUnlockedAgendas === true);
  };

  const closeThemeModal = () => {
    setThemeModal(null);
    setThemeInput('');
    setThemePdfHueInput(DEFAULT_AGENDA_PDF_HUE);
    setThemeNotesInput('');
  };

  const openThemeModalForMeeting = (meeting: ScheduledMeeting) => {
    setThemeInput(meeting.theme ?? '');
    setThemePdfHueInput(hexToHue(meeting.pdfColor ?? DEFAULT_AGENDA_PDF_COLOR));
    setThemeNotesInput(meeting.notes ?? '');
    setThemeModal({ meetingDate: meeting.meetingDate });
  };

  const loadAdminActivity = async (memberEmail = session?.email) => {
    if (!memberEmail) {
      setActivityEntries([]);
      setActivityMembers([]);
      return;
    }

    setLoadingActivity(true);
    try {
      const response = await apiClient.get<ActivityResponse>(`/clubs/${IDTT_CLUB_ID}/activity`, {
        params: {
          email: memberEmail,
          limit: 100,
        },
      });
      setActivityEntries(response.data.activities);
      setActivityMembers(response.data.members);
    } finally {
      setLoadingActivity(false);
    }
  };

  const getAgendaItemByTitle = (title: string) =>
    agendaItems.find((item) => item.title === title);

  const speakerCount = Math.max(1, Math.min(2, agendaItems.filter((item) => item.role === 'speaker').length || 2));
  const improvmasterCount = Math.max(1, Math.min(2, agendaItems.filter((item) => item.role === 'improvmaster').length || 1));

  const buildAgendaFromSettings = (
    nextSpeakerCount: number,
    nextImprovmasterCount: number,
    evaluatorModes: { speechEvaluator1: AgendaEvaluatorMode; speechEvaluator2: AgendaEvaluatorMode },
  ) => {
    const getItem = (key: keyof typeof agendaTemplateDefaults, role: string, fallbackId: string): AgendaItem => {
      const current =
        getAgendaItemByTitle(agendaTemplateDefaults[key].title ?? '') ??
        agendaItems.find((item) => item.id === fallbackId);
      return {
        id: current?.id ?? fallbackId,
        title: current?.title ?? agendaTemplateDefaults[key].title ?? fallbackId,
        role,
        durationMinutes: current?.durationMinutes ?? agendaTemplateDefaults[key].durationMinutes ?? 5,
        notes: current?.notes ?? agendaTemplateDefaults[key].notes ?? '',
        minBossScore: current?.minBossScore ?? 0,
        priority: current?.priority ?? 'standard',
        optional: current?.optional ?? false,
        meetingMode: current?.meetingMode ?? agendaTemplateDefaults[key].meetingMode ?? 'all',
        evaluatorMode:
          key === 'speechEvaluator1'
            ? evaluatorModes.speechEvaluator1
            : key === 'speechEvaluator2'
              ? evaluatorModes.speechEvaluator2
              : current?.evaluatorMode ?? agendaTemplateDefaults[key].evaluatorMode,
      };
    };

    const nextAgenda: AgendaItem[] = [
      getItem('openingToast', 'openingToast', 'agenda-1'),
      getItem('educationalMoment', 'educationalMoment', 'agenda-3'),
      getItem('grammarian', 'grammarian', 'agenda-4'),
      getItem('toastmaster', 'toastmaster', 'agenda-2'),
      getItem('barroomTopics', 'barroomTopics', 'agenda-5'),
      getItem('speaker1', 'speaker', 'agenda-6'),
    ];

    if (nextSpeakerCount === 2) {
      nextAgenda.push(getItem('speaker2', 'speaker', 'agenda-7'));
    }

    nextAgenda.push(getItem('generalEvaluator', 'generalEvaluator', 'agenda-8'));
    nextAgenda.push(getItem('speechEvaluator1', 'speechEvaluator', 'agenda-9'));

    if (nextSpeakerCount === 2) {
      nextAgenda.push(getItem('speechEvaluator2', 'speechEvaluator', 'agenda-10'));
    }

    nextAgenda.push(getItem('timer', 'timer', 'agenda-11'));

    nextAgenda.push(getItem('improvmaster1', 'improvmaster', 'agenda-12'));

    if (nextImprovmasterCount === 2) {
      nextAgenda.push(getItem('improvmaster2', 'improvmaster', 'agenda-13'));
    }

    return nextAgenda;
  };

  useEffect(() => {
    if (session) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      return;
    }

    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [session]);

  useEffect(() => {
    if (pendingAccount) {
      window.sessionStorage.setItem(PENDING_ACCOUNT_STORAGE_KEY, JSON.stringify(pendingAccount));
      return;
    }

    window.sessionStorage.removeItem(PENDING_ACCOUNT_STORAGE_KEY);
  }, [pendingAccount]);

  useEffect(() => {
    setDisplayName(session?.name ?? '');
    setProfileBio(session?.bio ?? '');
    setProfileImageUrl(session?.profileImageUrl ?? null);
  }, [session]);

  useEffect(() => {
    if (!initialResetParams.isVerify || !initialResetParams.email || !initialResetParams.token) {
      return;
    }

    const runVerify = async () => {
      setSubmitting(true);
      setMessage('');
      try {
        const response = await apiClient.post('/auth/member-signup/verify', {
          email: initialResetParams.email,
          token: initialResetParams.token,
        });
        const account = response.data.account as UserSession;
        setPendingAccount(account);
        setName(account.name ?? '');
        setVerifyToken(initialResetParams.token);
        clearVerifyQueryParams();
        setView('setup');
      } catch (error: any) {
        clearVerifyQueryParams();
        setVerifyToken('');
        setMessage(error?.response?.data?.error ?? 'That verification link is invalid or has expired.');
        setView('login');
      } finally {
        setSubmitting(false);
      }
    };

    runVerify();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initialResetParams.offerToken) return;
    clearOfferQueryParams();

    const loadOffer = async () => {
      try {
        const response = await apiClient.get(`/clubs/${IDTT_CLUB_ID}/schedule/role-offer`, {
          params: { token: initialResetParams.offerToken },
        });
        setIncomingOffer({
          token: initialResetParams.offerToken,
          role: response.data.role as string,
          meetingDate: response.data.meetingDate as string,
          offeredByName: response.data.offeredByName as string,
        });
        setPendingOfferToken('');
      } catch (error: any) {
        setMessage(error?.response?.data?.error ?? 'That role offer link is invalid or has expired.');
        setPendingOfferToken('');
      }
    };

    loadOffer();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadDashboardData = async () => {
      if (!session) {
        setSchedule(null);
        setRosterMember(null);
        return;
      }

      setLoadingSchedule(true);
      setLoadingAvailability(true);
      let nextMessage = '';

      try {
        const [scheduleResult, rosterResult, agendaResult] = await Promise.allSettled([
          apiClient.get<ScheduleResponse>('/engine/schedule', {
            params: {
              clubId: IDTT_CLUB_ID,
              email: session.email,
              weeks: 4,
            },
          }),
          apiClient.get<ClubRosterResponse>(`/clubs/${IDTT_CLUB_ID}/roster`, {
            params: {
              email: session.email,
            },
          }),
          apiClient.get<ClubAgendaResponse>(`/clubs/${IDTT_CLUB_ID}/agenda`, {
            params: {
              email: session.email,
            },
          }),
        ]);

        if (scheduleResult.status === 'fulfilled') {
          setSchedule(scheduleResult.value.data);
          setHideUnlockedAgendas(scheduleResult.value.data.hideUnlockedAgendas === true);
        } else {
          setSchedule(null);
          nextMessage =
            scheduleResult.reason?.response?.data?.error ??
            'Signed in successfully, but we could not load the schedule yet.';
        }

        if (rosterResult.status === 'fulfilled') {
          applyRosterToState(rosterResult.value.data.club.roster);
        } else {
          setClubRoster([]);
          setRosterMember(null);
          if (!nextMessage) {
            nextMessage =
              rosterResult.reason?.response?.data?.error ??
              'Signed in successfully, but we could not load your availability yet.';
          }
        }

        if (agendaResult.status === 'fulfilled') {
          setAgendaItems(agendaResult.value.data.club.agenda);
        } else if (!nextMessage) {
          nextMessage =
            agendaResult.reason?.response?.data?.error ??
            'Signed in successfully, but we could not load the agenda settings yet.';
        }
      } finally {
        setLoadingSchedule(false);
        setLoadingAvailability(false);
        setMessage(nextMessage);
      }
    };

    if (view === 'dashboard') {
      loadDashboardData();
    }
  }, [session, view]);

  useEffect(() => {
    if (!session || !isOfficer || portalTab !== 'admin' || adminSection !== 'activity') {
      if (!session) {
        setActivityEntries([]);
        setActivityMembers([]);
      }
      return;
    }

    loadAdminActivity(session.email).catch((error: any) => {
      setMessage(error?.response?.data?.error ?? 'Unable to load member activity right now.');
    });
  }, [adminSection, isOfficer, portalTab, session]);

  useEffect(() => {
    if (view !== 'dashboard') {
      setBackExitWarning(false);
      backPressCountRef.current = 0;
      return;
    }

    window.history.pushState({ portalGuard: true }, '');

    const handlePopState = () => {
      backPressCountRef.current += 1;
      if (backPressCountRef.current <= 2) {
        window.history.pushState({ portalGuard: true }, '');
      }
      if (backPressCountRef.current === 2) {
        setBackExitWarning(true);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [view]);

  useEffect(() => {
    if (!selectedAvailabilityDate) {
      setSelectedAvailabilityDate(getNextMeetingDateKey());
    }
  }, [selectedAvailabilityDate]);

  useEffect(() => {
    const targetMember = clubRoster.find((member) => member.email === adminTargetEmail);
    if (!targetMember) {
      setAdminAvailabilityDefault('always');
      setAdminEligibleRoles(roleAvailabilityOptions.map((option) => option.value));
      setAdminAvailabilityOverrides({});
      setSelectedAdminAvailabilityDate(getNextMeetingDateKey());
      return;
    }

    setAdminAvailabilityDefault(normalizeAvailabilityStatus(targetMember?.availabilityDefault));
    setAdminEligibleRoles(normalizeEligibleRoles(targetMember?.eligibleRoles));
    setAdminAvailabilityOverrides(
      Object.fromEntries(
        Object.entries(targetMember?.availabilityOverrides ?? {}).map(([meetingDate, status]) => [
          meetingDate,
          normalizeAvailabilityStatus(status),
        ]),
      ),
    );
    setSelectedAdminAvailabilityDate(getNextMeetingDateKey());
  }, [adminTargetEmail, clubRoster]);

  useEffect(() => {
    if (!selectedAvailabilityDate) {
      return;
    }

    setDraftAvailabilityStatus(getEffectiveAvailability(selectedAvailabilityDate));
  }, [selectedAvailabilityDate, availabilityDefault, availabilityOverrides]);

  useEffect(() => {
    if (!selectedAdminAvailabilityDate) {
      return;
    }

    setDraftAdminAvailabilityStatus(
      adminAvailabilityOverrides[selectedAdminAvailabilityDate] ?? adminAvailabilityDefault,
    );
  }, [selectedAdminAvailabilityDate, adminAvailabilityDefault, adminAvailabilityOverrides]);

  const handleAvailabilityOverrideChange = (
    meetingDate: string,
    value: EditableAvailabilityStatus,
  ) => {
    setAvailabilityOverrides((current) => {
      const next = { ...current };
      if (value === availabilityDefault) {
        delete next[meetingDate];
      } else {
        next[meetingDate] = value;
      }

      return next;
    });
  };

  const handleAdminAvailabilityOverrideChange = (
    meetingDate: string,
    value: EditableAvailabilityStatus,
  ) => {
    setAdminAvailabilityOverrides((current) => {
      const next = { ...current };
      if (value === adminAvailabilityDefault) {
        delete next[meetingDate];
      } else {
        next[meetingDate] = value;
      }

      return next;
    });
  };

  const toggleEligibleRole = (
    currentRoles: EditableRoleKey[],
    setRoles: (roles: EditableRoleKey[]) => void,
    role: EditableRoleKey,
  ) => {
    setRoles(
      currentRoles.includes(role)
        ? currentRoles.filter((entry) => entry !== role)
        : [...currentRoles, role],
    );
  };

  const applyRosterToState = (roster: ClubMemberRecord[]) => {
    setClubRoster(roster);

    const selfMember =
      roster.find((entry) => entry.email.toLowerCase() === session?.email.toLowerCase()) ?? null;
    if (selfMember && session && (
      selfMember.name !== session.name
      || (selfMember.bio ?? null) !== (session.bio ?? null)
      || (selfMember.profileImageUrl ?? null) !== (session.profileImageUrl ?? null)
    )) {
      setSession((current) => (current ? {
        ...current,
        name: selfMember.name,
        bio: selfMember.bio ?? null,
        profileImageUrl: selfMember.profileImageUrl ?? null,
      } : current));
    }
    setRosterMember(selfMember);
    const normalizedAvailabilityDefault = normalizeAvailabilityStatus(selfMember?.availabilityDefault);
    const normalizedEligibleRoles = normalizeEligibleRoles(selfMember?.eligibleRoles);
    const normalizedAvailabilityOverrides = Object.fromEntries(
      Object.entries(selfMember?.availabilityOverrides ?? {}).map(([meetingDate, status]) => [
        meetingDate,
        normalizeAvailabilityStatus(status),
      ]),
    );

    setAvailabilityDefault(normalizedAvailabilityDefault);
    setEligibleRoles(normalizedEligibleRoles);
    setAvailabilityOverrides(normalizedAvailabilityOverrides);
    lastSavedAvailabilityRef.current = JSON.stringify({
      availabilityDefault: normalizedAvailabilityDefault,
      availabilityOverrides: normalizedAvailabilityOverrides,
      eligibleRoles: normalizedEligibleRoles,
    });
    availabilityLoadedRef.current = Boolean(selfMember);
  };

  const handleAvailabilitySave = async () => {
    if (!session) {
      return;
    }

    setSavingAvailability(true);
    setMessage('');

    try {
      const response = await apiClient.put<ClubRosterResponse>(`/clubs/${IDTT_CLUB_ID}/availability`, {
        email: session.email,
        availabilityDefault,
        availabilityOverrides,
        eligibleRoles,
      });
      lastSavedAvailabilityRef.current = JSON.stringify({
        availabilityDefault,
        availabilityOverrides,
        eligibleRoles,
      });
      applyRosterToState(response.data.club.roster);
      setMessage('Your availability has been updated.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save your availability right now.');
    } finally {
      setSavingAvailability(false);
    }
  };

  const handleAdminAvailabilitySave = async () => {
    if (!session || !adminTargetEmail) {
      return;
    }

    setSavingAdminAvailability(true);
    setMessage('');

    try {
      const response = await apiClient.put<ClubRosterResponse>(`/clubs/${IDTT_CLUB_ID}/availability`, {
        email: session.email,
        targetEmail: adminTargetEmail,
        availabilityDefault: adminAvailabilityDefault,
        availabilityOverrides: adminAvailabilityOverrides,
        eligibleRoles: adminEligibleRoles,
      });
      lastSavedAdminAvailabilityRef.current = JSON.stringify({
        targetEmail: adminTargetEmail,
        availabilityDefault: adminAvailabilityDefault,
        availabilityOverrides: adminAvailabilityOverrides,
        eligibleRoles: adminEligibleRoles,
      });
      applyRosterToState(response.data.club.roster);
      setMessage('Member availability has been updated.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save member availability right now.');
    } finally {
      setSavingAdminAvailability(false);
    }
  };

  const handleProfileSave = async () => {
    if (!session) {
      return;
    }

    const trimmedName = displayName.trim();
    const trimmedBio = profileBio.trim();
    if (!trimmedName) {
      setMessage('Please enter the name you want other members to see.');
      return;
    }

    setSavingProfile(true);
    setMessage('');

    try {
      const response = await apiClient.put<MemberProfileResponse>(`/clubs/${IDTT_CLUB_ID}/profile`, {
        email: session.email,
        name: trimmedName,
        bio: trimmedBio || null,
        profileImageUrl,
      });
      const nextSession = {
        ...response.data.user,
        name: trimmedName,
        bio: trimmedBio || null,
        profileImageUrl: profileImageUrl ?? null,
      };
      setSession(nextSession);
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
      applyRosterToState(response.data.club.roster);
      setMessage('Your profile has been updated.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save your profile right now.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleProfileImageSelected = async (file: File | null) => {
    if (!file) {
      return;
    }

    const fileReader = new FileReader();
    fileReader.onload = () => {
      const result = typeof fileReader.result === 'string' ? fileReader.result : null;
      setProfileImageUrl(result);
    };
    fileReader.readAsDataURL(file);
  };

  const handleAdminProfileSave = async () => {
    if (!session || !adminTargetEmail) {
      return;
    }

    const trimmedName = adminDisplayName.trim();
    const trimmedBio = adminProfileBio.trim();
    if (!trimmedName) {
      setMessage('Please enter the member name you want others to see.');
      return;
    }

    setSavingAdminProfile(true);
    setMessage('');

    try {
      const response = await apiClient.put<MemberProfileResponse>(`/clubs/${IDTT_CLUB_ID}/profile`, {
        email: session.email,
        targetEmail: adminTargetEmail,
        name: trimmedName,
        bio: trimmedBio || null,
        profileImageUrl: adminProfileImageUrl,
      });
      applyRosterToState(response.data.club.roster);
      setMessage('Member profile has been updated.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save that member profile right now.');
    } finally {
      setSavingAdminProfile(false);
    }
  };

  const handleCreateMemberSetupLink = async () => {
    if (!session || !adminTargetMember) {
      return;
    }

    setGeneratingSetupLink(true);
    setMessage('');
    try {
      const response = await apiClient.post<MemberSetupLinkResponse>(`/clubs/${IDTT_CLUB_ID}/member-setup-link`, {
        email: session.email,
        targetEmail: adminTargetMember.email,
      });
      setMemberSetupLinkModal(response.data);
      setMessage(`Setup link created for ${formatMemberDisplayName(response.data.memberName)}.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to create a setup link right now.');
    } finally {
      setGeneratingSetupLink(false);
    }
  };

  const handleAdminProfileImageSelected = async (file: File | null) => {
    if (!file) {
      return;
    }

    const fileReader = new FileReader();
    fileReader.onload = () => {
      const result = typeof fileReader.result === 'string' ? fileReader.result : null;
      setAdminProfileImageUrl(result);
    };
    fileReader.readAsDataURL(file);
  };

  const handleRosterImportSelected = async (file: File | null) => {
    if (!file) {
      return;
    }

    const fileText = await file.text();
    setPendingRosterImportText(fileText);
    setPendingRosterImportFileName(file.name);
  };

  const handleRosterImport = async () => {
    if (!session || !pendingRosterImportText.trim()) {
      return;
    }

    setSavingRosterImport(true);
    setMessage('');

    try {
      const response = await apiClient.post<ClubRosterResponse>(`/clubs/${IDTT_CLUB_ID}/roster/import`, {
        email: session.email,
        rosterText: pendingRosterImportText,
      });
      applyRosterToState(response.data.club.roster);
      setPendingRosterImportText('');
      setPendingRosterImportFileName('');
      setMessage('Roster uploaded successfully.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to upload that roster right now.');
    } finally {
      setSavingRosterImport(false);
    }
  };

  const printableRosterMembers = [...clubRoster]
    .sort((left, right) => formatMemberDisplayName(left.name).localeCompare(formatMemberDisplayName(right.name)));
  const filteredRosterMembers = printableRosterMembers.filter((member) => {
    const query = rosterSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const haystack = [
      formatMemberDisplayName(member.name),
      formatMemberPhoneNumber(member.phoneNumber),
      member.email,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
  const printableRosterGeneratedOn = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const handleOpenPrintableRoster = () => {
    setRosterSearch('');
    setRosterModalOpen(true);
  };

  const handleClosePrintableRoster = () => {
    setRosterSearch('');
    setRosterModalOpen(false);
  };

  const handlePrintRoster = () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.opacity = '0';
    frame.style.border = '0';
    frame.style.pointerEvents = 'none';
    document.body.appendChild(frame);

    const printWindow = frame.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      frame.remove();
      return;
    }

    const cleanup = () => {
      window.setTimeout(() => {
        frame.remove();
      }, 250);
    };

    printDocument.open();
    printDocument.write(buildPrintableRosterDocument(printableRosterMembers, printableRosterGeneratedOn));
    printDocument.close();

    printWindow.onafterprint = cleanup;
    window.setTimeout(cleanup, 60_000);
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 200);
  };

  const handlePrintAgenda = async (meeting: ScheduledMeeting) => {
    const pdfBlob = await buildAgendaPdfBlob(meeting, clubRoster, {
      theme: meeting.theme,
      pdfColor: meeting.pdfColor ?? DEFAULT_AGENDA_PDF_COLOR,
      notes: meeting.notes,
    });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const opened = window.open(pdfUrl, '_blank', 'noopener,noreferrer');

    if (!opened) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = `${IDTT_CLUB_NAME.replace(/\s+/g, '-').toLowerCase()}-${meeting.meetingDate}-agenda.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    window.setTimeout(() => {
      URL.revokeObjectURL(pdfUrl);
    }, 60_000);
  };

  const handleCopyAgenda = async (meeting: ScheduledMeeting) => {
    const text = buildAgendaClipboardText(meeting);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }

      setMessage(`Agenda copied for ${formatMeetingDate(meeting.meetingDate)}.`);
    } catch {
      setMessage('Unable to copy that agenda right now.');
    }
  };

  const handleConfirmAgendaRole = async (meetingDate: string, assignment: ScheduleAssignment) => {
    if (!session || !assignment.slotId) {
      return;
    }

    const slotKey = `confirm:${meetingDate}:${assignment.slotId}`;
    setSavingScheduleSlot(slotKey);
    setMessage('');
    try {
      await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/confirm-role`, {
        email: session.email,
        meetingDate,
        slotId: assignment.slotId,
      });
      await refreshSchedule(session.email);
      setMessage(`Confirmed ${assignment.role} for ${formatMeetingDate(meetingDate)}.`);

      if (assignment.roleKey === 'toastmaster' || assignment.role.toLowerCase() === 'toastmaster') {
        const existingMeeting = getScheduledMeetings(schedule).find((m) => m.meetingDate === meetingDate) ?? null;
        if (existingMeeting) {
          openThemeModalForMeeting(existingMeeting);
        }
      } else if (assignment.roleKey === 'speaker' || assignment.role.toLowerCase().includes('speaker')) {
        setSpeechTitleInput(assignment.speechTitle ?? '');
        setSpeechTimeInput(assignment.speechTime ?? '');
        setSpeechModal({ meetingDate, slotId: assignment.slotId!, role: assignment.role });
      }
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to confirm that role right now.');
    } finally {
      setSavingScheduleSlot(null);
    }
  };

  const handleAdminConfirmRole = async () => {
    if (!session || !adminConfirmModal) return;
    setSubmitting(true);
    const isUndo = adminConfirmModal.action === 'undo';
    try {
      await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/confirm-role`, {
        email: session.email,
        meetingDate: adminConfirmModal.meetingDate,
        slotId: adminConfirmModal.slotId,
        ...(isUndo ? { confirmed: false } : {}),
      });
      await refreshSchedule(session.email);
      setMessage(isUndo
        ? `Removed confirmation for ${adminConfirmModal.role} (${adminConfirmModal.memberName}).`
        : `Confirmed ${adminConfirmModal.role} for ${adminConfirmModal.memberName}.`
      );
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to update that confirmation right now.');
    } finally {
      setAdminConfirmModal(null);
      setSubmitting(false);
    }
  };

  const handleSaveSpeechDetails = async () => {
    if (!session || !speechModal) return;
    try {
      await apiClient.put(`/clubs/${IDTT_CLUB_ID}/schedule/speech-details`, {
        email: session.email,
        meetingDate: speechModal.meetingDate,
        slotId: speechModal.slotId,
        speechTitle: speechTitleInput,
        speechTime: speechTimeInput,
      });
      await refreshSchedule(session.email);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save speech details right now.');
    } finally {
      setSpeechModal(null);
      setSpeechTitleInput('');
      setSpeechTimeInput('');
    }
  };

  const handleSaveTheme = async () => {
    if (!session || !themeModal) return;
    try {
      await apiClient.put(`/clubs/${IDTT_CLUB_ID}/schedule/theme`, {
        email: session.email,
        meetingDate: themeModal.meetingDate,
        theme: themeInput,
        pdfColor: hueToHex(themePdfHueInput),
        notes: themeNotesInput,
      });
      await refreshSchedule(session.email);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save the agenda settings right now.');
    } finally {
      closeThemeModal();
    }
  };

  const handleLockSchedule = async (meetingDate: string) => {
    if (!session) {
      return;
    }

    setScheduleActionMeeting(meetingDate);
    setMessage('');
    try {
      await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/lock`, {
        email: session.email,
        meetingDate,
      });
      await refreshSchedule(session.email);
      setEditingScheduleMeeting(null);
      setMessage(`Locked agenda for ${formatMeetingDate(meetingDate)}.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to lock that agenda right now.');
    } finally {
      setScheduleActionMeeting(null);
    }
  };

  const handleUnlockSchedule = async (meetingDate: string) => {
    if (!session) {
      return;
    }

    setScheduleActionMeeting(meetingDate);
    setMessage('');
    try {
      await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/unlock`, {
        email: session.email,
        meetingDate,
      });
      await refreshSchedule(session.email);
      setEditingScheduleMeeting(meetingDate);
      setMessage(`Unlocked agenda for ${formatMeetingDate(meetingDate)}.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to unlock that agenda right now.');
    } finally {
      setScheduleActionMeeting(null);
    }
  };

  const handleRegenerateSchedule = async (meetingDate: string) => {
    if (!session) {
      return;
    }

    setScheduleActionMeeting(meetingDate);
    setMessage('');
    try {
      await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/regenerate`, {
        email: session.email,
        meetingDate,
      });
      await refreshSchedule(session.email);
      setEditingScheduleMeeting(meetingDate);
      setMessage(`Regenerated agenda for ${formatMeetingDate(meetingDate)}.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to regenerate that agenda right now.');
    } finally {
      setScheduleActionMeeting(null);
    }
  };

  const handleManualAssignmentChange = async (
    meetingDate: string,
    assignment: ScheduleAssignment,
    targetMemberEmail: string,
    onSaved?: () => void,
  ) => {
    if (!session || !assignment.slotId) {
      return;
    }

    const slotKey = `${meetingDate}-${assignment.slotId}`;
    setSavingScheduleSlot(slotKey);
    setMessage('');
    try {
      await apiClient.put(`/clubs/${IDTT_CLUB_ID}/schedule/assignment`, {
        email: session.email,
        meetingDate,
        slotId: assignment.slotId,
        targetMemberEmail: targetMemberEmail || null,
      });
      await refreshSchedule(session.email);
      onSaved?.();
      setMessage(`Updated ${assignment.role} for ${formatMeetingDate(meetingDate)}.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save that manual assignment right now.');
    } finally {
      setSavingScheduleSlot(null);
    }
  };

  const saveAgendaSettings = async (nextAgenda: AgendaItem[], successMessage: string) => {
    if (!session) {
      return;
    }

    setSavingAgenda(true);
    setMessage('');
    try {
      await apiClient.put<ClubAgendaResponse>(`/clubs/${IDTT_CLUB_ID}/agenda`, {
        email: session.email,
        agenda: nextAgenda,
      });
      setAgendaItems(nextAgenda);
      await refreshSchedule(session.email);
      setMessage(successMessage);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to update the agenda settings right now.');
    } finally {
      setSavingAgenda(false);
    }
  };

  const handleSpeechEvaluatorModeChange = async (agendaItemId: string, evaluatorMode: AgendaEvaluatorMode) => {
    const nextAgenda = agendaItems.map((item) =>
      item.id === agendaItemId
        ? { ...item, evaluatorMode }
        : item,
    );
    await saveAgendaSettings(nextAgenda, 'Speech evaluator format updated.');
  };

  const handleSpeakerCountChange = async (nextSpeakerCount: number) => {
    const evaluatorModes = {
      speechEvaluator1: (getAgendaItemByTitle('Speech Evaluator 1')?.evaluatorMode ?? 'individual') as AgendaEvaluatorMode,
      speechEvaluator2: (getAgendaItemByTitle('Speech Evaluator 2')?.evaluatorMode ?? 'individual') as AgendaEvaluatorMode,
    };
    const nextAgenda = buildAgendaFromSettings(nextSpeakerCount, improvmasterCount, evaluatorModes);
    await saveAgendaSettings(nextAgenda, `Agenda updated to ${nextSpeakerCount} speaker${nextSpeakerCount === 1 ? '' : 's'}.`);
  };

  const handleImprovmasterCountChange = async (nextImprovmasterCount: number) => {
    const evaluatorModes = {
      speechEvaluator1: (getAgendaItemByTitle('Speech Evaluator 1')?.evaluatorMode ?? 'individual') as AgendaEvaluatorMode,
      speechEvaluator2: (getAgendaItemByTitle('Speech Evaluator 2')?.evaluatorMode ?? 'individual') as AgendaEvaluatorMode,
    };
    const nextAgenda = buildAgendaFromSettings(speakerCount, nextImprovmasterCount, evaluatorModes);
    await saveAgendaSettings(nextAgenda, `Improv night updated to ${nextImprovmasterCount} Improvmaster${nextImprovmasterCount === 1 ? '' : 's'}.`);
  };

  const openAvailabilityModal = (meetingDate: string) => {
    setSelectedAvailabilityDate(meetingDate);
    setDraftAvailabilityStatus(getEffectiveAvailability(meetingDate));
    setAvailabilityModalOpen(true);
  };

  const closeAvailabilityModal = () => {
    setAvailabilityModalOpen(false);
  };

  const openAdminAvailabilityModal = (meetingDate: string) => {
    setSelectedAdminAvailabilityDate(meetingDate);
    setDraftAdminAvailabilityStatus(adminAvailabilityOverrides[meetingDate] ?? adminAvailabilityDefault);
    setAdminAvailabilityModalOpen(true);
  };

  const closeAdminAvailabilityModal = () => {
    setAdminAvailabilityModalOpen(false);
  };

  const resetAuthForm = () => {
    setPassword('');
    setConfirmPassword('');
    setMessage('');
    setSubmitting(false);
  };

  const clearResetQueryParams = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    url.searchParams.delete('email');
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.toString());
  };

  const clearVerifyQueryParams = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('verify');
    url.searchParams.delete('email');
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.toString());
  };

  const clearOfferQueryParams = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('offer');
    window.history.replaceState({}, document.title, url.toString());
  };

  const handleOfferRole = async (meetingDate: string, slotId: string, role: string) => {
    if (!session) return;
    try {
      const response = await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/offer-role`, {
        email: session.email,
        meetingDate,
        slotId,
      });
      setOfferRoleModal({ meetingDate, slotId, role, offerUrl: response.data.offerUrl as string });
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to generate a swap link right now.');
    }
  };

  const handleAcceptOffer = async () => {
    if (!session || !incomingOffer) return;
    setSubmitting(true);
    try {
      await apiClient.post(`/clubs/${IDTT_CLUB_ID}/schedule/accept-role-offer`, {
        email: session.email,
        token: incomingOffer.token,
      });
      setIncomingOffer(null);
      setMessage(`You are now scheduled as ${incomingOffer.role} on ${formatMeetingDate(incomingOffer.meetingDate)}.`);
      await refreshSchedule();
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to accept that role right now.');
      setIncomingOffer(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async () => {
    setSubmitting(true);
    setMessage('');

    try {
      const response = await apiClient.post('/auth/login', {
        email,
        password,
      });
      setSession(response.data.user as UserSession);
      setPendingAccount(null);
      setView('dashboard');
      resetAuthForm();
    } catch (error: any) {
      const redirectAccount = error?.response?.data?.account as UserSession | undefined;

      if (error?.response?.data?.redirectTo === '/activate-account' && redirectAccount) {
        setPendingAccount(redirectAccount);
        setName(redirectAccount.name ?? '');
        setView('setup');
        setMessage('');
      } else {
        setMessage(error?.response?.data?.error ?? 'Unable to sign in right now.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    setSubmitting(true);
    setMessage('');

    try {
      await apiClient.post('/auth/member-signup', { email });
      setView('verifyEmail');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to start member signup right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPasswordRequest = async () => {
    if (!email) {
      setMessage('Enter your email address first.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      const response = await apiClient.post('/auth/password-reset/request', {
        email,
      });
      setMessage(response.data.message ?? 'If that email is on file, a password reset link has been sent.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to send a password reset email right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email || !resetToken) {
      setMessage('That password reset link is missing required details.');
      return;
    }

    if (password.length < 8) {
      setMessage('Please choose a password with at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match yet.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      await apiClient.post('/auth/password-reset/confirm', {
        email,
        token: resetToken,
        password,
      });
      clearResetQueryParams();
      setResetToken('');
      resetAuthForm();
      setView('login');
      setMessage('Your password has been reset. Sign in with your new password.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to reset your password right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteSetup = async () => {
    if (!pendingAccount) {
      setMessage('No pending account was found.');
      return;
    }

    if (password.length < 8) {
      setMessage('Please choose a password with at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match yet.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      const response = await apiClient.post('/auth/complete-setup', {
        email: pendingAccount.email,
        name: name || pendingAccount.name,
        password,
        ...(verifyToken ? { verifyToken } : {}),
      });
      setSession(response.data.user as UserSession);
      setPendingAccount(null);
      setView('dashboard');
      resetAuthForm();
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to finish account setup right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderPasswordField = ({
    id,
    label,
    value,
    onChange,
    placeholder,
    visible,
    onToggle,
  }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    visible: boolean;
    onToggle: () => void;
  }) => (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="toastboss-password-field">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="toastboss-password-toggle"
          onClick={onToggle}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          <img
            src={visible ? invisEyeIcon : visEyeIcon}
            alt=""
            aria-hidden="true"
            className="toastboss-password-toggle-icon"
          />
        </button>
      </div>
    </>
  );

  const handleLogout = () => {
    setSession(null);
    setSchedule(null);
    setRosterMember(null);
    setHeaderMenuOpen(false);
    setView('login');
    setEmail('');
    setPassword('');
    setMessage('');
  };

  const handleOpenSettings = () => {
    setPortalTab('availability');
    setMemberSettingsSection('availability');
    setHeaderMenuOpen(false);
  };

  const handleOpenProfile = () => {
    setPortalTab('availability');
    setMemberSettingsSection('profile');
    setHeaderMenuOpen(false);
  };

  const handleOpenAdmin = () => {
    setPortalTab('admin');
    setHeaderMenuOpen(false);
  };

  const upcomingMeetings = getScheduledMeetings(schedule);
  const agendaMeetings = (hideUnlockedAgendas ? upcomingMeetings.filter((m) => m.locked) : upcomingMeetings).slice(0, 2);
  const availabilityCalendarMonth = buildAvailabilityCalendarMonth(calendarMonthOffset);
  const adminAvailabilityCalendarMonth = buildAvailabilityCalendarMonth(adminCalendarMonthOffset);
  const adminTargetMember = clubRoster.find((member) => member.email === adminTargetEmail) ?? null;
  const getEffectiveAvailability = (meetingDate: string): EditableAvailabilityStatus =>
    availabilityOverrides[meetingDate] ?? availabilityDefault;
  const getAdminEffectiveAvailability = (meetingDate: string): EditableAvailabilityStatus =>
    adminAvailabilityOverrides[meetingDate] ?? adminAvailabilityDefault;

  useEffect(() => {
    if (!adminTargetMember) {
      setAdminDisplayName('');
      setAdminProfileBio('');
      setAdminProfileImageUrl(null);
      return;
    }

    setAdminDisplayName(adminTargetMember.name);
    setAdminProfileBio(adminTargetMember.bio ?? '');
    setAdminProfileImageUrl(adminTargetMember.profileImageUrl ?? null);
  }, [adminTargetMember]);

  useEffect(() => {
    if (!session || !availabilityLoadedRef.current) {
      return;
    }

    const snapshot = JSON.stringify({
      availabilityDefault,
      availabilityOverrides,
      eligibleRoles,
    });

    if (snapshot === lastSavedAvailabilityRef.current) {
      return;
    }

    if (availabilityAutosaveTimeoutRef.current) {
      window.clearTimeout(availabilityAutosaveTimeoutRef.current);
    }

    availabilityAutosaveTimeoutRef.current = window.setTimeout(() => {
      void handleAvailabilitySave();
    }, 450);

    return () => {
      if (availabilityAutosaveTimeoutRef.current) {
        window.clearTimeout(availabilityAutosaveTimeoutRef.current);
      }
    };
  }, [session, availabilityDefault, availabilityOverrides, eligibleRoles]);

  useEffect(() => {
    if (!adminTargetMember) {
      adminAvailabilityLoadedRef.current = false;
      lastSavedAdminAvailabilityRef.current = '';
      return;
    }

    lastSavedAdminAvailabilityRef.current = JSON.stringify({
      targetEmail: adminTargetMember.email,
      availabilityDefault: normalizeAvailabilityStatus(adminTargetMember.availabilityDefault),
      availabilityOverrides: Object.fromEntries(
        Object.entries(adminTargetMember.availabilityOverrides ?? {}).map(([meetingDate, status]) => [
          meetingDate,
          normalizeAvailabilityStatus(status),
        ]),
      ),
      eligibleRoles: normalizeEligibleRoles(adminTargetMember.eligibleRoles),
    });
    adminAvailabilityLoadedRef.current = true;
  }, [adminTargetMember]);

  useEffect(() => {
    if (!session || !adminTargetEmail || !adminAvailabilityLoadedRef.current) {
      return;
    }

    const snapshot = JSON.stringify({
      targetEmail: adminTargetEmail,
      availabilityDefault: adminAvailabilityDefault,
      availabilityOverrides: adminAvailabilityOverrides,
      eligibleRoles: adminEligibleRoles,
    });

    if (snapshot === lastSavedAdminAvailabilityRef.current) {
      return;
    }

    if (adminAvailabilityAutosaveTimeoutRef.current) {
      window.clearTimeout(adminAvailabilityAutosaveTimeoutRef.current);
    }

    adminAvailabilityAutosaveTimeoutRef.current = window.setTimeout(() => {
      void handleAdminAvailabilitySave();
    }, 450);

    return () => {
      if (adminAvailabilityAutosaveTimeoutRef.current) {
        window.clearTimeout(adminAvailabilityAutosaveTimeoutRef.current);
      }
    };
  }, [session, adminTargetEmail, adminAvailabilityDefault, adminAvailabilityOverrides, adminEligibleRoles]);

  const renderAvailabilityManager = ({
    heading,
    description,
    defaultStatus,
    onDefaultChange,
    saving,
    calendarMonth,
    onPreviousMonth,
    onNextMonth,
    getStatusForDate,
    onDayClick,
  }: {
    heading: string;
    description: string;
    defaultStatus: EditableAvailabilityStatus;
    onDefaultChange: (value: EditableAvailabilityStatus) => void;
    saving: boolean;
    calendarMonth: CalendarMonth;
    onPreviousMonth: () => void;
    onNextMonth: () => void;
    getStatusForDate: (meetingDate: string) => EditableAvailabilityStatus;
    onDayClick: (meetingDate: string) => void;
  }) => (
    <div className="toastboss-schedule">
      <h3>{heading}</h3>
      <p className="toastboss-meta">{description}</p>
      <p className="toastboss-availability-status" aria-live="polite">
        {saving ? 'Saving changes...' : 'Changes save automatically.'}
      </p>

      <div className="toastboss-availability-stack">
        <article className="toastboss-schedule-week">
          <div className="toastboss-form">
            <label htmlFor={`${heading}-availabilityDefault`}>Default availability</label>
            <select
              id={`${heading}-availabilityDefault`}
              value={defaultStatus}
              onChange={(event) => onDefaultChange(event.target.value as EditableAvailabilityStatus)}
            >
              {availabilityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <p className="toastboss-meta">
            Tap a Thursday date to change that one meeting only.
          </p>

          <div className="toastboss-availability-panel">
            <div className="toastboss-availability-legend">
              <span className="toastboss-availability-legend-item toastboss-availability-legend-always">Available</span>
              <span className="toastboss-availability-legend-item toastboss-availability-legend-tentative">Tentative</span>
              <span className="toastboss-availability-legend-item toastboss-availability-legend-never">Unavailable</span>
            </div>

            <article key={calendarMonth.monthKey} className="toastboss-availability-month">
              <div className="toastboss-availability-month-toolbar">
                <button type="button" className="toastboss-month-nav" onClick={onPreviousMonth} aria-label={`Show ${calendarMonth.previousMonthLabel}`}>
                  ←
                </button>
                <div className="toastboss-availability-month-header">
                  <h4>{calendarMonth.label}</h4>
                </div>
                <button type="button" className="toastboss-month-nav" onClick={onNextMonth} aria-label={`Show ${calendarMonth.nextMonthLabel}`}>
                  →
                </button>
              </div>
              <div className="toastboss-availability-weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
                  <span key={`${calendarMonth.monthKey}-${weekday}`}>{weekday}</span>
                ))}
              </div>
              <div className="toastboss-availability-month-grid">
                {calendarMonth.weeks.flat().map((day) => {
                  if (!day.isCurrentMonth) {
                    return (
                      <div
                        key={`${calendarMonth.monthKey}-${day.dateKey}`}
                        className="toastboss-calendar-day toastboss-calendar-day-outside"
                      />
                    );
                  }

                  const status = getStatusForDate(day.dateKey);

                  return (
                    <button
                      key={`${calendarMonth.monthKey}-${day.dateKey}`}
                      type="button"
                      className={
                        day.isMeetingDay
                          ? `toastboss-calendar-day toastboss-calendar-day-meeting toastboss-calendar-day-${status}`
                          : 'toastboss-calendar-day'
                      }
                      onClick={() => {
                        if (day.isMeetingDay) {
                          onDayClick(day.dateKey);
                        }
                      }}
                      disabled={!day.isMeetingDay}
                    >
                      <span className="toastboss-calendar-day-number">{day.dayNumber}</span>
                    </button>
                  );
                })}
              </div>
            </article>
          </div>
        </article>
      </div>
    </div>
  );

  const renderProfileSettings = () => (
    <article className="toastboss-schedule-week">
      <div className="toastboss-schedule-week-header">
        <h3>Edit Profile</h3>
        <p className="toastboss-meta">Update your photo, display name, and short introduction for other members.</p>
      </div>

      <div className="toastboss-profile-editor">
        <div className="toastboss-profile-photo-panel">
          <div className="toastboss-profile-avatar">
            {profileImageUrl ? (
              <img src={profileImageUrl} alt={`${formatMemberDisplayName(displayName || session?.name || 'Member')} profile`} />
            ) : (
              <span>{formatMemberDisplayName(displayName || session?.name || 'M').trim().charAt(0).toUpperCase()}</span>
            )}
          </div>
          <input
            id="memberProfilePhoto"
            className="toastboss-file-input"
            type="file"
            accept="image/*"
            onChange={(event) => void handleProfileImageSelected(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="memberProfilePhoto" className="toastboss-upload-label">
            Upload profile photo
          </label>
          {profileImageUrl && (
            <button
              type="button"
              className="toastboss-ghost-button"
              onClick={() => setProfileImageUrl(null)}
            >
              Remove photo
            </button>
          )}
        </div>

        <div className="toastboss-form">
        <label htmlFor="memberDisplayName">Display name</label>
        <input
          id="memberDisplayName"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Your full name"
        />
        <label htmlFor="memberProfileBio">Short bio</label>
        <textarea
          id="memberProfileBio"
          value={profileBio}
          onChange={(event) => setProfileBio(event.target.value)}
          placeholder="Tell the club a little about yourself."
        />
        <button
          type="button"
          onClick={handleProfileSave}
          disabled={
            savingProfile
            || displayName.trim() === ''
            || (
              displayName.trim() === (session?.name ?? '').trim()
              && profileBio.trim() === (session?.bio ?? '').trim()
              && (profileImageUrl ?? null) === (session?.profileImageUrl ?? null)
            )
          }
        >
          {savingProfile ? 'Saving changes...' : 'Save changes'}
        </button>
        </div>
      </div>
    </article>
  );

  const renderAdminProfileSettings = () => (
    <article className="toastboss-schedule-week">
      <div className="toastboss-schedule-week-header">
        <h3>Member Profile</h3>
        <p className="toastboss-meta">Update this member's photo, display name, and short introduction.</p>
      </div>

      <div className="toastboss-profile-editor">
        <div className="toastboss-profile-photo-panel">
          <div className="toastboss-profile-avatar">
            {adminProfileImageUrl ? (
              <img src={adminProfileImageUrl} alt={`${formatMemberDisplayName(adminDisplayName || adminTargetMember?.name || 'Member')} profile`} />
            ) : (
              <span>{formatMemberDisplayName(adminDisplayName || adminTargetMember?.name || 'M').trim().charAt(0).toUpperCase()}</span>
            )}
          </div>
          <input
            id="adminMemberProfilePhoto"
            className="toastboss-file-input"
            type="file"
            accept="image/*"
            onChange={(event) => void handleAdminProfileImageSelected(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="adminMemberProfilePhoto" className="toastboss-upload-label">
            Upload member photo
          </label>
          {adminProfileImageUrl && (
            <button
              type="button"
              className="toastboss-ghost-button"
              onClick={() => setAdminProfileImageUrl(null)}
            >
              Remove photo
            </button>
          )}
        </div>

        <div className="toastboss-form">
          <label htmlFor="adminMemberDisplayName">Display name</label>
          <input
            id="adminMemberDisplayName"
            type="text"
            value={adminDisplayName}
            onChange={(event) => setAdminDisplayName(event.target.value)}
            placeholder="Member full name"
          />
          <label htmlFor="adminMemberProfileBio">Short bio</label>
          <textarea
            id="adminMemberProfileBio"
            value={adminProfileBio}
            onChange={(event) => setAdminProfileBio(event.target.value)}
            placeholder="Introduce this member to the club."
          />
          <button
            type="button"
            onClick={handleAdminProfileSave}
            disabled={
              savingAdminProfile
              || adminDisplayName.trim() === ''
              || (
                adminDisplayName.trim() === (adminTargetMember?.name ?? '').trim()
                && adminProfileBio.trim() === (adminTargetMember?.bio ?? '').trim()
                && (adminProfileImageUrl ?? null) === (adminTargetMember?.profileImageUrl ?? null)
              )
            }
          >
            {savingAdminProfile ? 'Saving changes...' : 'Save changes'}
          </button>
          <button
            type="button"
            className="toastboss-ghost-button"
            onClick={handleCreateMemberSetupLink}
            disabled={generatingSetupLink}
          >
            {generatingSetupLink ? 'Creating setup link...' : 'Create password setup link'}
          </button>
        </div>
      </div>
    </article>
  );

  const renderRosterImportManager = () => (
    <article className="toastboss-schedule-week">
      <div className="toastboss-schedule-week-header">
        <h3>Roster Upload</h3>
        <p className="toastboss-meta">Upload a fresh club roster CSV without resetting member accounts or profile changes.</p>
      </div>

      <div className="toastboss-form">
        <input
          id="memberRosterUpload"
          className="toastboss-file-input"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void handleRosterImportSelected(event.target.files?.[0] ?? null)}
        />
        <label htmlFor="memberRosterUpload" className="toastboss-upload-label">
          {pendingRosterImportFileName || 'Choose roster CSV'}
        </label>
        <button
          type="button"
          onClick={handleRosterImport}
          disabled={savingRosterImport || !pendingRosterImportText.trim()}
        >
          {savingRosterImport ? 'Uploading roster...' : 'Upload roster'}
        </button>
      </div>
    </article>
  );

  const renderRoleEligibilityManager = ({
    heading,
    description,
    selectedRoles,
    onRoleToggle,
  }: {
    heading: string;
    description: string;
    selectedRoles: EditableRoleKey[];
    onRoleToggle: (role: EditableRoleKey) => void;
  }) => (
    <article className="toastboss-schedule-week">
      <div className="toastboss-schedule-week-header">
        <span className="toastboss-kicker">{heading}</span>
        <p className="toastboss-meta">{description}</p>
      </div>

      <div className="toastboss-role-grid">
        {roleAvailabilityOptions.map((option) => (
          <label key={`${heading}-${option.value}`} className="toastboss-role-checkbox">
            <input
              type="checkbox"
              checked={selectedRoles.includes(option.value)}
              onChange={() => onRoleToggle(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </article>
  );

  return (
    <div className="toastboss-shell">
      <header className="toastboss-header">
        <div className="toastboss-header-inner">
          <div className="toastboss-brand">
            <img className="toastboss-logo" src={idttLogoBlack} alt="I'll Drink to That Toastmasters logo" />
            <div>
              <h1>I'll Drink to That Member Portal</h1>
            </div>
          </div>
          {session && (
            <div className={headerMenuOpen ? 'toastboss-header-menu is-open' : 'toastboss-header-menu'}>
              <div className="toastboss-header-user">
                <span className="toastboss-header-greeting">{`Welcome, ${getMemberFirstName(session.name)}`}</span>
                <button
                  className="toastboss-header-action toastboss-header-hamburger"
                  type="button"
                  onClick={() => setHeaderMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={headerMenuOpen}
                  aria-label="Open member menu"
                >
                  <span />
                  <span />
                  <span />
                </button>
              </div>
              {headerMenuOpen && (
                <div className="toastboss-header-dropdown" role="menu" aria-label="Member options">
                  <button type="button" role="menuitem" onClick={handleOpenPrintableRoster}>
                    View Club Roster
                  </button>
                  <button type="button" role="menuitem" onClick={handleOpenSettings}>
                    Set Availability
                  </button>
                  <button type="button" role="menuitem" onClick={handleOpenProfile}>
                    Edit Profile
                  </button>
                  {isOfficer && (
                    <button type="button" role="menuitem" onClick={handleOpenAdmin}>
                      Admin
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={handleLogout}>
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="toastboss-main">
        {view !== 'dashboard' && (
          <section className="toastboss-panel toastboss-login-layout">
            <div className="toastboss-auth-section">
              {view === 'login' && (
                <>
                  <div className="toastboss-section-copy">
                    <span className="toastboss-kicker">Member Login</span>
                    <h2>Sign in</h2>
                    <p>Use the email on file for {IDTT_CLUB_NAME}.</p>
                  </div>

                  <div className="toastboss-form">
                    <label htmlFor="loginEmail">Email</label>
                    <input
                      id="loginEmail"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />

                    {renderPasswordField({
                      id: 'loginPassword',
                      label: 'Password',
                      value: password,
                      onChange: setPassword,
                      placeholder: 'Enter your password',
                      visible: showPassword,
                      onToggle: () => setShowPassword((current) => !current),
                    })}

                    <button type="button" onClick={handleLogin} disabled={submitting}>
                      {submitting ? 'Signing in...' : 'Sign in'}
                    </button>
                    <button
                      type="button"
                      className="toastboss-inline-link"
                      onClick={() => {
                        setPassword('');
                        setConfirmPassword('');
                        setMessage('');
                        setView('forgotPassword');
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              )}

              {view === 'signup' && (
                <>
                  <div className="toastboss-section-copy">
                    <span className="toastboss-kicker">First Time Here</span>
                    <h2>Create your account</h2>
                    <p>Your email must already be on the IDTT roster.</p>
                  </div>

                  <div className="toastboss-form">
                    <label htmlFor="signupEmail">Email</label>
                    <input
                      id="signupEmail"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />

                    <button type="button" onClick={handleSignup} disabled={submitting}>
                      {submitting ? 'Checking roster...' : 'Continue'}
                    </button>
                  </div>
                </>
              )}

              {view === 'verifyEmail' && (
                <>
                  <div className="toastboss-section-copy">
                    <span className="toastboss-kicker">Check Your Email</span>
                    <h2>Verify your email</h2>
                    <p>
                      We sent a setup link to <strong>{email}</strong>. Click the link in that email to continue
                      creating your account. The link expires in 24 hours.
                    </p>
                    <p>Don't see it? Check your spam or junk folder.</p>
                  </div>

                  <div className="toastboss-form">
                    <button
                      type="button"
                      onClick={handleSignup}
                      disabled={submitting}
                    >
                      {submitting ? 'Sending...' : 'Resend verification email'}
                    </button>
                  </div>
                </>
              )}

              {view === 'setup' && pendingAccount && (
                <>
                  <div className="toastboss-section-copy">
                    <span className="toastboss-kicker">Account Setup</span>
                    <h2>Finish your member account</h2>
                    <p>Set your password and notification preferences for {pendingAccount.email}.</p>
                  </div>

                  <div className="toastboss-benefit-block">
                    <h3>{pendingAccount.name}</h3>
                    <p>{pendingAccount.email}</p>
                  </div>

                  <div className="toastboss-form">
                    <label htmlFor="setupName">Name</label>
                    <input
                      id="setupName"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your full name"
                    />

                    {renderPasswordField({
                      id: 'setupPassword',
                      label: 'Create password',
                      value: password,
                      onChange: setPassword,
                      placeholder: 'At least 8 characters',
                      visible: showPassword,
                      onToggle: () => setShowPassword((current) => !current),
                    })}

                    {renderPasswordField({
                      id: 'setupConfirmPassword',
                      label: 'Confirm password',
                      value: confirmPassword,
                      onChange: setConfirmPassword,
                      placeholder: 'Retype your password',
                      visible: showConfirmPassword,
                      onToggle: () => setShowConfirmPassword((current) => !current),
                    })}

                    <button type="button" onClick={handleCompleteSetup} disabled={submitting}>
                      {submitting ? 'Finishing setup...' : 'Finish account setup'}
                    </button>
                  </div>
                </>
              )}

              {view === 'forgotPassword' && (
                <>
                  <div className="toastboss-section-copy">
                    <span className="toastboss-kicker">Password Reset</span>
                    <h2>Forgot password</h2>
                    <p>Enter the email on file for your member portal account.</p>
                  </div>

                  <div className="toastboss-form">
                    <label htmlFor="forgotPasswordEmail">Email</label>
                    <input
                      id="forgotPasswordEmail"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />

                    <button type="button" onClick={handleForgotPasswordRequest} disabled={submitting}>
                      {submitting ? 'Sending reset link...' : 'Email password reset'}
                    </button>
                  </div>
                </>
              )}

              {view === 'resetPassword' && (
                <>
                  <div className="toastboss-section-copy">
                    <span className="toastboss-kicker">Password Reset</span>
                    <h2>Choose a new password</h2>
                    <p>Set a new password for your member portal account.</p>
                  </div>

                  <div className="toastboss-form">
                    <label htmlFor="resetPasswordEmail">Email</label>
                    <input
                      id="resetPasswordEmail"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />

                    {renderPasswordField({
                      id: 'resetPassword',
                      label: 'New password',
                      value: password,
                      onChange: setPassword,
                      placeholder: 'At least 8 characters',
                      visible: showPassword,
                      onToggle: () => setShowPassword((current) => !current),
                    })}

                    {renderPasswordField({
                      id: 'resetPasswordConfirm',
                      label: 'Confirm new password',
                      value: confirmPassword,
                      onChange: setConfirmPassword,
                      placeholder: 'Retype your new password',
                      visible: showConfirmPassword,
                      onToggle: () => setShowConfirmPassword((current) => !current),
                    })}

                    <button type="button" onClick={handleResetPassword} disabled={submitting}>
                      {submitting ? 'Resetting password...' : 'Reset password'}
                    </button>
                  </div>
                </>
              )}

              {message && (
                view === 'signup' && message === 'This member account already exists. Please sign in instead.' ? (
                  <p className="toastboss-note">
                    This member account already exists. Please{' '}
                    <button
                      type="button"
                      className="toastboss-inline-link"
                      onClick={() => {
                        setView('login');
                        setMessage('');
                      }}
                    >
                      sign in
                    </button>{' '}
                    instead.
                  </p>
                ) : (
                  <p className="toastboss-note">{message}</p>
                )
              )}
            </div>

            <div className="toastboss-setup-section">
              <div className="toastboss-section-copy">
                <span className="toastboss-kicker">Portal Access</span>
                <h3>{view === 'signup' || view === 'verifyEmail' ? 'Already have an account?' : 'First time here?'}</h3>
                <p>
                  {view === 'signup'
                    ? 'Return to the sign-in screen if your member account is already set up.'
                    : view === 'verifyEmail'
                      ? 'Return to sign in if you already have a member account set up.'
                      : view === 'forgotPassword' || view === 'resetPassword'
                        ? 'Return to sign in after requesting or completing your password reset.'
                        : 'If your email is already on the roster, start your account setup here.'}
                </p>
              </div>

              {view === 'signup' || view === 'verifyEmail' || view === 'forgotPassword' || view === 'resetPassword' ? (
                <button
                  type="button"
                  className="toastboss-secondary-cta"
                  onClick={() => {
                    clearResetQueryParams();
                    setResetToken('');
                    resetAuthForm();
                    setView('login');
                    setMessage('');
                  }}
                >
                  Back to sign in
                </button>
              ) : view !== 'setup' ? (
                <button
                  type="button"
                  className="toastboss-secondary-cta"
                  onClick={() => {
                    setView('signup');
                    setMessage('');
                  }}
                >
                  Create member account
                </button>
              ) : (
                <button
                  type="button"
                  className="toastboss-secondary-cta"
                  onClick={() => {
                    setPendingAccount(null);
                    setView('login');
                    setMessage('');
                  }}
                >
                  Back to sign in
                </button>
              )}
            </div>
          </section>
        )}

        {view === 'dashboard' && session && (
          <section className="toastboss-panel">
            {message && <p className="toastboss-note">{message}</p>}
            {(loadingSchedule || loadingAvailability) && <p>Loading your portal details...</p>}

            {portalTab === 'dashboard' && !loadingSchedule && schedule && (
              <div className="toastboss-schedule">
                <h3>Upcoming Agendas</h3>
                <div className="toastboss-schedule-grid">
                  {agendaMeetings.map((meeting) => (
                    <article key={meeting.meetingId} className="toastboss-schedule-week">
                      {(() => {
                        const toastmasterEmail = getMeetingToastmasterEmail(meeting);
                        const canEditAgendaSettings = Boolean(
                          isOfficer || (session?.email && toastmasterEmail && session.email.toLowerCase() === toastmasterEmail),
                        );

                        return (
                      <div className="toastboss-schedule-week-header">
                        <h4 className="toastboss-schedule-date">{formatMeetingMonthDay(meeting.meetingDate)}</h4>
                        <div className="toastboss-lock-actions">
                          {canEditAgendaSettings && (
                            <button
                              type="button"
                              className="toastboss-lock-action toastboss-lock-action-secondary"
                              onClick={() => openThemeModalForMeeting(meeting)}
                              title="Edit agenda settings"
                            >
                              Settings
                            </button>
                          )}
                          <button
                            type="button"
                            className="toastboss-lock-action toastboss-lock-action-secondary toastboss-icon-action"
                            onClick={() => handleCopyAgenda(meeting)}
                            aria-label={`Copy agenda for ${formatMeetingMonthDay(meeting.meetingDate)} to clipboard`}
                            title="Copy agenda to clipboard"
                          >
                            <img src={copyIcon} alt="" aria-hidden="true" className="toastboss-icon-action-image" />
                          </button>
                          <button
                            type="button"
                            className="toastboss-lock-action toastboss-lock-action-secondary toastboss-icon-action"
                            onClick={() => handlePrintAgenda(meeting)}
                            aria-label={`View PDF for ${formatMeetingMonthDay(meeting.meetingDate)}`}
                            title="View as PDF"
                          >
                            <img src={printIcon} alt="" aria-hidden="true" className="toastboss-icon-action-image" />
                          </button>
                        </div>
                      </div>
                        );
                      })()}
                      {meeting.theme && (
                        <p className="toastboss-meeting-theme">Theme: {meeting.theme}</p>
                      )}
                      {meeting.notes && (
                        <p className="toastboss-meta">Notes: {meeting.notes}</p>
                      )}
                      <ul>
                        {meeting.assignments.map((assignment) => {
                          const assignedToCurrentMember = Boolean(
                            session?.email
                            && assignment.memberEmail
                            && assignment.memberEmail.toLowerCase() === session.email.toLowerCase(),
                          );
                          const confirmSlotKey = assignment.slotId ? `confirm:${meeting.meetingDate}:${assignment.slotId}` : null;
                          return (
                            <li
                              key={`${meeting.meetingId}-${assignment.role}`}
                              className={assignedToCurrentMember ? 'toastboss-schedule-assignment is-mine' : 'toastboss-schedule-assignment'}
                            >
                              <div className="toastboss-schedule-assignment-main">
                                <strong>{assignment.role}</strong>:{' '}
                                {assignment.memberName ? formatMemberDisplayName(assignment.memberName) : assignment.memberId ?? 'Unassigned'}
                                {assignment.confirmedAt && (
                                  <span className="toastboss-confirmed-inline" aria-label="Confirmed" title="This member has confirmed their role">✓</span>
                                )}
                                {(assignment.speechTitle || assignment.speechTime) && (
                                  <span className="toastboss-speech-info">
                                    {[assignment.speechTitle, assignment.speechTime ? `(${assignment.speechTime})` : null].filter(Boolean).join(' ')}
                                  </span>
                                )}
                              </div>
                              <div className="toastboss-schedule-assignment-actions">
                                {assignedToCurrentMember && !assignment.confirmedAt && assignment.slotId && (
                                  <button
                                    type="button"
                                    className="toastboss-role-confirm-button"
                                    onClick={() => handleConfirmAgendaRole(meeting.meetingDate, assignment)}
                                    disabled={savingScheduleSlot === confirmSlotKey}
                                    aria-label={`Confirm ${assignment.role}`}
                                    title="Confirm role"
                                  >
                                    ✓
                                  </button>
                                )}
                                {assignedToCurrentMember && assignment.slotId && (
                                  <button
                                    type="button"
                                    className="toastboss-role-decline-button"
                                    onClick={() => handleOfferRole(meeting.meetingDate, assignment.slotId!, assignment.role)}
                                    aria-label={`Step down from ${assignment.role}`}
                                    title="Can't make it? Get a replacement"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {portalTab === 'availability' && !loadingAvailability && (
              <div className="toastboss-member-settings-stack">
                <div className="toastboss-section-copy">
                  <button
                    type="button"
                    className="toastboss-inline-link"
                    onClick={() => {
                      setPortalTab('dashboard');
                      setMemberSettingsSection('availability');
                    }}
                  >
                    Return to Dashboard View
                  </button>
                </div>
                {memberSettingsSection === 'profile' ? (
                  <>
                    <div className="toastboss-inline-actions">
                      <button
                        type="button"
                        className="toastboss-ghost-button toastboss-back-arrow"
                        onClick={() => setMemberSettingsSection('availability')}
                        aria-label="Back to settings"
                      >
                        ←
                      </button>
                    </div>
                    {renderProfileSettings()}
                  </>
                ) : (
                  <>
                {false && memberSettingsSection === 'menu' && (
                  <div className="toastboss-settings-menu">
                    <button
                      type="button"
                      className="toastboss-settings-option"
                      onClick={() => setMemberSettingsSection('profile')}
                    >
                      <span className="toastboss-settings-option-title">Edit Profile</span>
                    </button>
                    <button
                      type="button"
                      className="toastboss-settings-option"
                      onClick={() => setMemberSettingsSection('availability')}
                    >
                      <span className="toastboss-settings-option-title">Set Availability</span>
                    </button>
                  </div>
                )}
                {false && memberSettingsSection === 'profile' && (
                  <>
                    <div className="toastboss-inline-actions">
                      <button
                        type="button"
                        className="toastboss-ghost-button toastboss-back-arrow"
                        onClick={() => setMemberSettingsSection('availability')}
                        aria-label="Back to settings"
                      >
                        ←
                      </button>
                    </div>
                    {renderProfileSettings()}
                  </>
                )}
                {false && memberSettingsSection === 'availability' && (
                  <>
                    <div className="toastboss-inline-actions">
                      <button
                        type="button"
                        className="toastboss-ghost-button toastboss-back-arrow"
                        onClick={() => setMemberSettingsSection('menu')}
                        aria-label="Back to member settings"
                      >
                        ←
                      </button>
                    </div>
                    {renderAvailabilityManager({
                      heading: 'Set Availability',
                      description: 'Choose your normal availability, then tap a Thursday date when you need an exception.',
                      defaultStatus: availabilityDefault,
                      onDefaultChange: setAvailabilityDefault,
                      saving: savingAvailability,
                      calendarMonth: availabilityCalendarMonth,
                      onPreviousMonth: () => setCalendarMonthOffset((current) => current - 1),
                      onNextMonth: () => setCalendarMonthOffset((current) => current + 1),
                      getStatusForDate: getEffectiveAvailability,
                      onDayClick: openAvailabilityModal,
                    })}
                  </>
                )}
                    {renderAvailabilityManager({
                      heading: 'Set Availability',
                      description: 'Choose your normal availability, then tap a Thursday date when you need an exception.',
                      defaultStatus: availabilityDefault,
                      onDefaultChange: setAvailabilityDefault,
                      saving: savingAvailability,
                      calendarMonth: availabilityCalendarMonth,
                      onPreviousMonth: () => setCalendarMonthOffset((current) => current - 1),
                      onNextMonth: () => setCalendarMonthOffset((current) => current + 1),
                      getStatusForDate: getEffectiveAvailability,
                      onDayClick: openAvailabilityModal,
                    })}
                  </>
                )}
              </div>
            )}

            {portalTab === 'admin' && isOfficer && !loadingAvailability && (
              <div className="toastboss-admin-section">
                <div className="toastboss-section-copy">
                  <button
                    type="button"
                    className="toastboss-inline-link"
                    onClick={() => setPortalTab('dashboard')}
                  >
                    Return to Dashboard View
                  </button>
                  <span className="toastboss-kicker">Admin tools</span>
                  <h3>Club controls</h3>
                  <p>Choose the area you want to manage.</p>
                </div>

                <div className="toastboss-tabbar toastboss-admin-subtabs" role="tablist" aria-label="Admin sections">
                  <button
                    type="button"
                    className={adminSection === 'members' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                    onClick={() => setAdminSection('members')}
                  >
                    Member settings
                  </button>
                  <button
                    type="button"
                    className={adminSection === 'agenda' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                    onClick={() => setAdminSection('agenda')}
                  >
                    Agenda settings
                  </button>
                  <button
                    type="button"
                    className={adminSection === 'schedule' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                    onClick={() => setAdminSection('schedule')}
                  >
                    Schedule
                  </button>
                  <button
                    type="button"
                    className={adminSection === 'activity' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                    onClick={() => setAdminSection('activity')}
                  >
                    Activity
                  </button>
                </div>

                {adminSection === 'members' && (
                  <>
                    {renderRosterImportManager()}

                    <div className="toastboss-form toastboss-admin-selector">
                      <label htmlFor="adminTargetEmail">Member</label>
                      <select
                        id="adminTargetEmail"
                        value={adminTargetEmail}
                        onChange={(event) => setAdminTargetEmail(event.target.value)}
                      >
                        <option value="">Select member</option>
                        {clubRoster.map((member) => (
                          <option key={member.email} value={member.email}>
                            {formatMemberDisplayName(member.name)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {adminTargetMember ? (
                      <>
                        {renderAdminProfileSettings()}

                        {renderRoleEligibilityManager({
                          heading: 'Allowed roles',
                          description: 'Uncheck any roles this member should be excluded from before you adjust their calendar.',
                          selectedRoles: adminEligibleRoles,
                          onRoleToggle: (role) => toggleEligibleRole(adminEligibleRoles, setAdminEligibleRoles, role),
                        })}

                        {renderAvailabilityManager({
                          heading: `${formatMemberDisplayName(adminTargetMember.name)} availability`,
                          description: 'Change the member default or tap any Thursday date to create a one-date exception.',
                          defaultStatus: adminAvailabilityDefault,
                          onDefaultChange: setAdminAvailabilityDefault,
                          saving: savingAdminAvailability,
                          calendarMonth: adminAvailabilityCalendarMonth,
                          onPreviousMonth: () => setAdminCalendarMonthOffset((current) => current - 1),
                          onNextMonth: () => setAdminCalendarMonthOffset((current) => current + 1),
                          getStatusForDate: getAdminEffectiveAvailability,
                          onDayClick: openAdminAvailabilityModal,
                        })}
                      </>
                    ) : (
                      <div className="toastboss-benefit-block">
                        <h3>Select a member</h3>
                        <p>Choose a member above to adjust their roles and Thursday availability.</p>
                      </div>
                    )}
                  </>
                )}

                {adminSection === 'agenda' && (
                  <div className="toastboss-schedule">
                    <h3>Agenda settings</h3>
                    <p className="toastboss-meta">Set the standard meeting speaker count, choose one or two Improvmasters for first-Thursday improv night, and choose assigned evaluator or round robin for each speech evaluator slot.</p>
                    <div className="toastboss-role-grid">
                      <label className="toastboss-role-checkbox toastboss-role-select">
                        <span>Number of speakers</span>
                        <select
                          value={speakerCount}
                          disabled={savingAgenda}
                          onChange={(event) => handleSpeakerCountChange(Number(event.target.value))}
                        >
                          <option value={1}>1 speaker</option>
                          <option value={2}>2 speakers</option>
                        </select>
                      </label>
                      <label className="toastboss-role-checkbox toastboss-role-select">
                        <span>Improvmaster slots</span>
                        <select
                          value={improvmasterCount}
                          disabled={savingAgenda}
                          onChange={(event) => handleImprovmasterCountChange(Number(event.target.value))}
                        >
                          <option value={1}>1 Improvmaster</option>
                          <option value={2}>2 Improvmasters</option>
                        </select>
                      </label>
                      {agendaItems
                        .filter((item) => item.role === 'speechEvaluator')
                        .map((item, index) => (
                          <label key={item.id} className="toastboss-role-checkbox toastboss-role-select">
                            <span>{item.title || `Speech Evaluator ${index + 1}`}</span>
                            <select
                              value={item.evaluatorMode === 'roundRobin' ? 'roundRobin' : 'individual'}
                              disabled={savingAgenda}
                              onChange={(event) =>
                                handleSpeechEvaluatorModeChange(
                                  item.id,
                                  event.target.value as AgendaEvaluatorMode,
                                )
                              }
                            >
                              <option value="individual">Assigned evaluator</option>
                              <option value="roundRobin">Round robin</option>
                            </select>
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                {adminSection === 'schedule' && (
                  <div className="toastboss-schedule">
                    <h3>Next four agendas</h3>
                    <p className="toastboss-meta">Use edit to make draft changes, then lock an agenda when it is finalized.</p>
                    <label className="toastboss-checkbox-row">
                      <input
                        type="checkbox"
                        checked={hideUnlockedAgendas}
                        disabled={savingHideUnlocked}
                        onChange={async (e) => {
                          const next = e.target.checked;
                          setSavingHideUnlocked(true);
                          try {
                            await apiClient.put(`/clubs/${IDTT_CLUB_ID}/settings`, {
                              email: session?.email,
                              hideUnlockedAgendas: next,
                            });
                            setHideUnlockedAgendas(next);
                          } catch (error: any) {
                            setMessage(error?.response?.data?.error ?? 'Unable to update that setting right now.');
                          } finally {
                            setSavingHideUnlocked(false);
                          }
                        }}
                      />
                      <span>Hide unlocked agendas from members</span>
                    </label>
                    <div className="toastboss-schedule-grid">
                      {upcomingMeetings.slice(0, 4).map((meeting) => (
                        <article key={`admin-${meeting.meetingId}`} className="toastboss-schedule-week">
                        <div className="toastboss-schedule-week-header">
                          <h4 className="toastboss-schedule-date">{formatMeetingMonthDay(meeting.meetingDate)}</h4>
                        </div>

                        <div className="toastboss-agenda-lockbar">
                          {meeting.locked ? (
                            <span className="toastboss-lock-badge is-locked">Locked</span>
                          ) : editingScheduleMeeting === meeting.meetingDate ? (
                            <span className="toastboss-lock-badge">Editing draft</span>
                          ) : null}
                          <div className="toastboss-lock-actions">
                            <button
                              type="button"
                              className="toastboss-lock-action toastboss-lock-action-secondary toastboss-icon-action"
                              onClick={() => handleCopyAgenda(meeting)}
                              aria-label={`Copy agenda for ${formatMeetingMonthDay(meeting.meetingDate)} to clipboard`}
                              title="Copy agenda to clipboard"
                            >
                              <img src={copyIcon} alt="" aria-hidden="true" className="toastboss-icon-action-image" />
                            </button>
                            {!meeting.locked && (
                              <>
                                <button
                                  type="button"
                                  className="toastboss-lock-action toastboss-lock-action-secondary"
                                  onClick={() =>
                                    setEditingScheduleMeeting((current) =>
                                      current === meeting.meetingDate ? null : meeting.meetingDate,
                                    )
                                  }
                                >
                                  {editingScheduleMeeting === meeting.meetingDate ? 'Done editing' : 'Edit agenda'}
                                </button>
                                <button
                                  type="button"
                                  className="toastboss-lock-action toastboss-lock-action-secondary"
                                  disabled={scheduleActionMeeting === meeting.meetingDate}
                                  onClick={() => handleRegenerateSchedule(meeting.meetingDate)}
                                >
                                  {scheduleActionMeeting === meeting.meetingDate ? 'Saving...' : 'Regenerate agenda'}
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              className="toastboss-lock-action"
                              disabled={scheduleActionMeeting === meeting.meetingDate}
                              onClick={() => (
                                meeting.locked
                                  ? handleUnlockSchedule(meeting.meetingDate)
                                  : handleLockSchedule(meeting.meetingDate)
                              )}
                            >
                              {scheduleActionMeeting === meeting.meetingDate
                                ? 'Saving...'
                                : meeting.locked
                                  ? 'Unlock agenda'
                                  : 'Lock agenda'}
                            </button>
                          </div>
                        </div>

                        <ul>
                          {meeting.assignments.map((assignment) => {
                            const slotKey = `${meeting.meetingDate}-${assignment.slotId ?? assignment.role}`;
                            const isSlotEditing = editingSlotKey === slotKey;
                            const isFullEditing = !meeting.locked && editingScheduleMeeting === meeting.meetingDate;
                            const showDropdown = isSlotEditing || isFullEditing;
                            const selectedMember = clubRoster.find((member) => member.email === assignment.memberEmail) ?? null;
                            const selectedAvailability = selectedMember
                              ? getMemberAvailabilityForMeeting(selectedMember, meeting.meetingDate)
                              : 'always';
                            return (
                              <li key={`${meeting.meetingId}-${assignment.slotId ?? assignment.role}`}>
                                <strong>{assignment.role}</strong>
                                {showDropdown ? (
                                  <span className="toastboss-inline-slot-edit">
                                    <select
                                      className={`toastboss-agenda-member-select toastboss-agenda-member-select-${selectedAvailability}`}
                                      value={assignment.memberEmail ?? ''}
                                      disabled={savingScheduleSlot === slotKey}
                                      onChange={(event) =>
                                        handleManualAssignmentChange(
                                          meeting.meetingDate,
                                          assignment,
                                          event.target.value,
                                          isSlotEditing ? () => setEditingSlotKey(null) : undefined,
                                        )
                                      }
                                    >
                                      <option value="">Unassigned</option>
                                      {clubRoster.map((member) => {
                                        const memberAvailability = getMemberAvailabilityForMeeting(member, meeting.meetingDate);
                                        return (
                                          <option
                                            key={`${slotKey}-${member.email}`}
                                            value={member.email}
                                            style={getAvailabilitySelectOptionStyle(memberAvailability)}
                                          >
                                            {formatMemberDisplayName(member.name)}
                                          </option>
                                        );
                                      })}
                                    </select>
                                    {isSlotEditing && (
                                      <button
                                        type="button"
                                        className="toastboss-inline-slot-cancel"
                                        onClick={() => setEditingSlotKey(null)}
                                      >
                                        Cancel
                                      </button>
                                    )}
                                  </span>
                                ) : (
                                  <span className="toastboss-slot-display">
                                    {': '}
                                    {assignment.memberName ? formatMemberDisplayName(assignment.memberName) : assignment.memberId ?? 'Unassigned'}
                                    {assignment.memberName && assignment.slotId && (
                                      <button
                                        type="button"
                                        className={assignment.confirmedAt ? 'toastboss-admin-confirm-button is-confirmed' : 'toastboss-admin-confirm-button'}
                                        onClick={() => setAdminConfirmModal({
                                          meetingDate: meeting.meetingDate,
                                          slotId: assignment.slotId!,
                                          role: assignment.role,
                                          memberName: formatMemberDisplayName(assignment.memberName!),
                                          action: assignment.confirmedAt ? 'undo' : 'confirm',
                                        })}
                                      >
                                        {assignment.confirmedAt ? '✓ Confirmed' : 'Confirm'}
                                      </button>
                                    )}
                                    {!meeting.locked && assignment.slotId && (
                                      <button
                                        type="button"
                                        className="toastboss-reassign-button"
                                        title="Reassign this role"
                                        onClick={() => setEditingSlotKey(slotKey)}
                                      >
                                        ✎
                                      </button>
                                    )}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {adminSection === 'activity' && (
                  <div className="toastboss-schedule">
                    <div className="toastboss-manager-header">
                      <div>
                        <h3>Member activity</h3>
                        <p className="toastboss-meta">Recent member portal sign-ins, role confirmations, availability changes, and role-swap activity.</p>
                      </div>
                      <button
                        type="button"
                        className="toastboss-ghost-button"
                        onClick={() => {
                          if (!session) {
                            return;
                          }
                          loadAdminActivity(session.email).catch((error: any) => {
                            setMessage(error?.response?.data?.error ?? 'Unable to refresh member activity right now.');
                          });
                        }}
                        disabled={loadingActivity}
                      >
                        {loadingActivity ? 'Refreshing...' : 'Refresh activity'}
                      </button>
                    </div>

                    {loadingActivity && activityEntries.length === 0 ? (
                      <p>Loading member activity...</p>
                    ) : activityEntries.length > 0 ? (
                      <div className="toastboss-activity-table-wrap">
                        <table className="toastboss-activity-table">
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>Member</th>
                              <th>When</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activityEntries.map((entry) => (
                              <tr key={entry.id}>
                                <td>{entry.summary}</td>
                                <td>{entry.memberName}</td>
                                <td className="toastboss-activity-table-time">{formatActivityTimestamp(entry.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="toastboss-benefit-block">
                        <h3>No activity yet</h3>
                        <p>Member portal logins and member scheduling actions will appear here for admins.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {availabilityModalOpen && selectedAvailabilityDate && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={closeAvailabilityModal}>
                <div
                  className="toastboss-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="availability-modal-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="availability-modal-title">Change availability for {formatMeetingDate(selectedAvailabilityDate)}</h3>
                    </div>
                    <button type="button" className="toastboss-modal-close" onClick={closeAvailabilityModal}>
                      Close
                    </button>
                  </div>

                  <div className="toastboss-availability-editor-options">
                    {availabilityExceptionOptions.map((option) => (
                      <label key={`selected-${option.value}`} className="toastboss-availability-radio-card">
                        <input
                          type="radio"
                          name="selectedAvailabilityDate"
                          checked={draftAvailabilityStatus === option.value}
                          onChange={() => {
                            if (!selectedAvailabilityDate) {
                              return;
                            }
                            setDraftAvailabilityStatus(option.value);
                            handleAvailabilityOverrideChange(selectedAvailabilityDate, option.value);
                            setAvailabilityModalOpen(false);
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {rosterModalOpen && (
              <div className="toastboss-modal-backdrop toastboss-print-backdrop" role="presentation" onClick={handleClosePrintableRoster}>
                <div
                  className="toastboss-modal toastboss-roster-print-shell"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="club-roster-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="toastboss-modal-header toastboss-print-toolbar">
                    <div>
                      <h3 id="club-roster-title">Club Roster</h3>
                    </div>
                    <div className="toastboss-print-actions">
                      <button
                        type="button"
                        className="toastboss-modal-icon-button"
                        onClick={handlePrintRoster}
                        aria-label="Print roster"
                        title="Print"
                      >
                        <img src={printIcon} alt="" aria-hidden="true" className="toastboss-modal-icon-image" />
                      </button>
                      <button
                        type="button"
                        className="toastboss-modal-icon-button toastboss-modal-close-icon"
                        onClick={handleClosePrintableRoster}
                        aria-label="Close roster"
                        title="Close"
                      >
                        <span aria-hidden="true">&times;</span>
                      </button>
                    </div>
                  </div>

                  <div className="toastboss-roster-print-sheet">
                    <div className="toastboss-form toastboss-roster-search">
                      <label htmlFor="rosterSearch">Search members</label>
                      <input
                        id="rosterSearch"
                        type="text"
                        value={rosterSearch}
                        onChange={(event) => setRosterSearch(event.target.value)}
                        placeholder="Search by name, phone, or email"
                      />
                    </div>
                    <div className="toastboss-roster-table-wrap toastboss-roster-print-table-wrap">
                      <table className="toastboss-roster-table toastboss-roster-print-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Phone Number</th>
                            <th>Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRosterMembers.map((member) => (
                            <tr key={`roster-print-${member.email}`}>
                              <td data-label="Name">{formatMemberDisplayName(member.name)}</td>
                              <td data-label="Phone Number">
                                {formatMemberPhoneHref(member.phoneNumber) ? (
                                  <a className="toastboss-phone-link" href={formatMemberPhoneHref(member.phoneNumber)}>
                                    {formatMemberPhoneNumber(member.phoneNumber)}
                                  </a>
                                ) : (
                                  formatMemberPhoneNumber(member.phoneNumber)
                                )}
                              </td>
                              <td data-label="Email">
                                <a className="toastboss-phone-link" href={formatMemberEmailHref(member.email)}>
                                  {member.email}
                                </a>
                              </td>
                            </tr>
                          ))}
                          {filteredRosterMembers.length === 0 && (
                            <tr>
                              <td data-label="Name">No members match your search.</td>
                              <td data-label="Phone Number" />
                              <td data-label="Email" />
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {adminAvailabilityModalOpen && selectedAdminAvailabilityDate && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={closeAdminAvailabilityModal}>
                <div
                  className="toastboss-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="admin-availability-modal-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="admin-availability-modal-title">
                        Change availability for {formatMeetingDate(selectedAdminAvailabilityDate)}
                      </h3>
                    </div>
                    <button type="button" className="toastboss-modal-close" onClick={closeAdminAvailabilityModal}>
                      Close
                    </button>
                  </div>

                  <div className="toastboss-availability-editor-options">
                    {availabilityExceptionOptions.map((option) => (
                      <label key={`admin-selected-${option.value}`} className="toastboss-availability-radio-card">
                        <input
                          type="radio"
                          name="selectedAdminAvailabilityDate"
                          checked={draftAdminAvailabilityStatus === option.value}
                          onChange={() => {
                            if (!selectedAdminAvailabilityDate) {
                              return;
                            }
                            setDraftAdminAvailabilityStatus(option.value);
                            handleAdminAvailabilityOverrideChange(selectedAdminAvailabilityDate, option.value);
                            setAdminAvailabilityModalOpen(false);
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {adminConfirmModal && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={() => setAdminConfirmModal(null)}>
                <div className="toastboss-modal" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title" onClick={(e) => e.stopPropagation()}>
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="admin-confirm-title">
                        {adminConfirmModal.action === 'undo' ? 'Remove confirmation' : 'Confirm role'}
                      </h3>
                    </div>
                    <button type="button" className="toastboss-modal-close" onClick={() => setAdminConfirmModal(null)}>Close</button>
                  </div>
                  <p>
                    {adminConfirmModal.action === 'undo'
                      ? <>Remove the confirmation for <strong>{adminConfirmModal.memberName}</strong> as <strong>{adminConfirmModal.role}</strong> on {formatMeetingDate(adminConfirmModal.meetingDate)}?</>
                      : <>Confirm <strong>{adminConfirmModal.memberName}</strong> as <strong>{adminConfirmModal.role}</strong> on {formatMeetingDate(adminConfirmModal.meetingDate)}?</>
                    }
                  </p>
                  <div className="toastboss-form">
                    <button type="button" onClick={handleAdminConfirmRole} disabled={submitting}>
                      {submitting ? 'Saving...' : adminConfirmModal.action === 'undo' ? 'Remove confirmation' : 'Yes, confirm'}
                    </button>
                    <button type="button" className="toastboss-ghost-button" onClick={() => setAdminConfirmModal(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {themeModal && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={closeThemeModal}>
                <div className="toastboss-modal" role="dialog" aria-modal="true" aria-labelledby="theme-modal-title" onClick={(e) => e.stopPropagation()}>
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="theme-modal-title">Agenda settings for {formatMeetingMonthDay(themeModal.meetingDate)}</h3>
                    </div>
                    <button type="button" className="toastboss-modal-close" onClick={closeThemeModal}>Close</button>
                  </div>
                  <p className="toastboss-meta">The toastmaster can set the top theme, pick a PDF accent color, and add optional text at the bottom of the page.</p>
                  <div className="toastboss-form">
                    <label htmlFor="meetingThemeInput">Meeting theme</label>
                    <input
                      id="meetingThemeInput"
                      type="text"
                      value={themeInput}
                      onChange={(e) => setThemeInput(e.target.value)}
                      placeholder="e.g. Superheroes, Travel, Music..."
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTheme(); }}
                    />
                    <label htmlFor="meetingPdfHueInput">PDF accent hue</label>
                    <input
                      id="meetingPdfHueInput"
                      type="range"
                      className="toastboss-hue-range"
                      min={0}
                      max={360}
                      step={1}
                      value={themePdfHueInput}
                      onChange={(e) => setThemePdfHueInput(Number(e.target.value))}
                      style={{
                        background:
                          'linear-gradient(90deg, #ff4d4d 0%, #ffb84d 16%, #f7f769 32%, #53d769 48%, #44c7f4 64%, #7b61ff 80%, #ff4fd8 100%)',
                      }}
                    />
                    <p className="toastboss-meta">Hue: {themePdfHueInput}°</p>
                    <label htmlFor="meetingNotesInput">Bottom text (optional)</label>
                    <textarea
                      id="meetingNotesInput"
                      value={themeNotesInput}
                      onChange={(e) => setThemeNotesInput(e.target.value)}
                      placeholder="Any reminders, announcements, or special instructions for the agenda PDF..."
                      rows={4}
                    />
                    <button type="button" onClick={handleSaveTheme}>
                      Save agenda settings
                    </button>
                    <button type="button" className="toastboss-ghost-button" onClick={closeThemeModal}>
                      Skip for now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {speechModal && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={() => { setSpeechModal(null); setSpeechTitleInput(''); setSpeechTimeInput(''); }}>
                <div className="toastboss-modal" role="dialog" aria-modal="true" aria-labelledby="speech-modal-title" onClick={(e) => e.stopPropagation()}>
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="speech-modal-title">{speechModal.role} — {formatMeetingMonthDay(speechModal.meetingDate)}</h3>
                    </div>
                    <button type="button" className="toastboss-modal-close" onClick={() => { setSpeechModal(null); setSpeechTitleInput(''); setSpeechTimeInput(''); }}>Close</button>
                  </div>
                  <p className="toastboss-meta">Your speech details will appear on the agenda for all members.</p>
                  <div className="toastboss-form">
                    <label htmlFor="speechTitleInput">Speech title</label>
                    <input
                      id="speechTitleInput"
                      type="text"
                      value={speechTitleInput}
                      onChange={(e) => setSpeechTitleInput(e.target.value)}
                      placeholder="Enter your speech title"
                      autoFocus
                    />
                    <label htmlFor="speechTimeInput">Time</label>
                    <input
                      id="speechTimeInput"
                      type="text"
                      value={speechTimeInput}
                      onChange={(e) => setSpeechTimeInput(e.target.value)}
                      placeholder="e.g. 5-7 minutes"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSpeechDetails(); }}
                    />
                    <button type="button" onClick={handleSaveSpeechDetails}>
                      Save speech details
                    </button>
                    <button type="button" className="toastboss-ghost-button" onClick={() => { setSpeechModal(null); setSpeechTitleInput(''); setSpeechTimeInput(''); }}>
                      Skip for now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {offerRoleModal && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={() => setOfferRoleModal(null)}>
                <div className="toastboss-modal toastboss-offer-modal" role="dialog" aria-modal="true" aria-labelledby="offer-role-title" onClick={(e) => e.stopPropagation()}>
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="offer-role-title">Find a replacement for {offerRoleModal.role}</h3>
                    </div>
                    <button
                      type="button"
                      className="toastboss-modal-close"
                      onClick={() => setOfferRoleModal(null)}
                      aria-label="Close replacement dialog"
                      title="Close"
                    >
                      <span aria-hidden="true">&times;</span>
                    </button>
                  </div>
                  <p className="toastboss-meta">
                    It is your responsibility as a member to find your own replacement. Share this with another member —
                    when they click the link and accept, they will be added to the agenda in your place.
                  </p>
                  <div className="toastboss-form toastboss-offer-form">
                    <label htmlFor="offerRoleMessage">Ready-to-send message</label>
                    <textarea
                      className="toastboss-offer-message"
                      id="offerRoleMessage"
                      rows={4}
                      defaultValue={`I am requesting a replacement for my role as ${offerRoleModal.role} for the meeting on ${formatMeetingDate(offerRoleModal.meetingDate)}. To accept this role, please use this link: ${offerRoleModal.offerUrl}`}
                    />
                    <div className="toastboss-modal-actions toastboss-offer-actions">
                      <button
                        type="button"
                        onClick={async () => {
                        const msg = (document.getElementById('offerRoleMessage') as HTMLTextAreaElement | null)?.value
                          ?? `I am requesting a replacement for my role as ${offerRoleModal.role} for the meeting on ${formatMeetingDate(offerRoleModal.meetingDate)}. To accept this role, please use this link: ${offerRoleModal.offerUrl}`;
                        try {
                          if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(msg);
                          } else {
                            const el = document.createElement('textarea');
                            el.value = msg;
                            el.setAttribute('readonly', '');
                            el.style.position = 'fixed';
                            el.style.opacity = '0';
                            document.body.appendChild(el);
                            el.focus();
                            el.select();
                            document.execCommand('copy');
                            el.remove();
                          }
                          setMessage('Message copied to clipboard.');
                        } catch {
                          setMessage('Unable to copy — select and copy the message manually.');
                        }
                        setOfferRoleModal(null);
                        }}
                      >
                        Copy message
                      </button>
                      <button
                        type="button"
                        className="toastboss-ghost-button"
                        onClick={async () => {
                        try {
                          if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(offerRoleModal.offerUrl);
                          } else {
                            const el = document.createElement('textarea');
                            el.value = offerRoleModal.offerUrl;
                            el.setAttribute('readonly', '');
                            el.style.position = 'fixed';
                            el.style.opacity = '0';
                            document.body.appendChild(el);
                            el.focus();
                            el.select();
                            document.execCommand('copy');
                            el.remove();
                          }
                          setMessage('Link copied to clipboard.');
                        } catch {
                          setMessage('Unable to copy — select and copy the link manually.');
                        }
                        setOfferRoleModal(null);
                        }}
                      >
                        Copy link only
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {memberSetupLinkModal && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={() => setMemberSetupLinkModal(null)}>
                <div className="toastboss-modal toastboss-offer-modal" role="dialog" aria-modal="true" aria-labelledby="member-setup-link-title" onClick={(e) => e.stopPropagation()}>
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="member-setup-link-title">Create a password for {formatMemberDisplayName(memberSetupLinkModal.memberName)}</h3>
                    </div>
                    <button
                      type="button"
                      className="toastboss-modal-close"
                      onClick={() => setMemberSetupLinkModal(null)}
                      aria-label="Close setup link dialog"
                      title="Close"
                    >
                      <span aria-hidden="true">&times;</span>
                    </button>
                  </div>
                  <p className="toastboss-meta">
                    Send this direct setup link to the member. It skips the signup page and takes them straight to password setup.
                  </p>
                  <div className="toastboss-form toastboss-offer-form">
                    <label htmlFor="memberSetupLinkMessage">Ready-to-send message</label>
                    <textarea
                      className="toastboss-offer-message"
                      id="memberSetupLinkMessage"
                      rows={4}
                      defaultValue={`Hi ${getMemberFirstName(memberSetupLinkModal.memberName)}, this is the direct link to set up your IDTT member portal password: ${memberSetupLinkModal.setupUrl} Let me know if you have any issues signing in.`}
                    />
                    <div className="toastboss-modal-actions toastboss-offer-actions">
                      <button
                        type="button"
                        onClick={async () => {
                          const msg = (document.getElementById('memberSetupLinkMessage') as HTMLTextAreaElement | null)?.value
                            ?? `Hi ${getMemberFirstName(memberSetupLinkModal.memberName)}, this is the direct link to set up your IDTT member portal password: ${memberSetupLinkModal.setupUrl} Let me know if you have any issues signing in.`;
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(msg);
                            } else {
                              const el = document.createElement('textarea');
                              el.value = msg;
                              el.setAttribute('readonly', '');
                              el.style.position = 'fixed';
                              el.style.opacity = '0';
                              document.body.appendChild(el);
                              el.focus();
                              el.select();
                              document.execCommand('copy');
                              el.remove();
                            }
                            setMessage('Setup message copied to clipboard.');
                          } catch {
                            setMessage('Unable to copy — select and copy the setup message manually.');
                          }
                          setMemberSetupLinkModal(null);
                        }}
                      >
                        Copy message
                      </button>
                      <button
                        type="button"
                        className="toastboss-ghost-button"
                        onClick={async () => {
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(memberSetupLinkModal.setupUrl);
                            } else {
                              const el = document.createElement('textarea');
                              el.value = memberSetupLinkModal.setupUrl;
                              el.setAttribute('readonly', '');
                              el.style.position = 'fixed';
                              el.style.opacity = '0';
                              document.body.appendChild(el);
                              el.focus();
                              el.select();
                              document.execCommand('copy');
                              el.remove();
                            }
                            setMessage('Setup link copied to clipboard.');
                          } catch {
                            setMessage('Unable to copy — select and copy the setup link manually.');
                          }
                          setMemberSetupLinkModal(null);
                        }}
                      >
                        Copy link only
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {incomingOffer && (
              <div className="toastboss-modal-backdrop" role="presentation" onClick={() => setIncomingOffer(null)}>
                <div className="toastboss-modal" role="dialog" aria-modal="true" aria-labelledby="accept-offer-title" onClick={(e) => e.stopPropagation()}>
                  <div className="toastboss-modal-header">
                    <div>
                      <h3 id="accept-offer-title">Role offer from {incomingOffer.offeredByName}</h3>
                    </div>
                    <button type="button" className="toastboss-modal-close" onClick={() => setIncomingOffer(null)}>Close</button>
                  </div>
                  <p>
                    <strong>{incomingOffer.offeredByName}</strong> is offering you the{' '}
                    <strong>{incomingOffer.role}</strong> role on{' '}
                    <strong>{formatMeetingDate(incomingOffer.meetingDate)}</strong>.
                    Do you want to take this role?
                  </p>
                  <div className="toastboss-form">
                    {session ? (
                      <button type="button" onClick={handleAcceptOffer} disabled={submitting}>
                        {submitting ? 'Accepting...' : 'Accept this role'}
                      </button>
                    ) : (
                      <p className="toastboss-note">Sign in first to accept this role offer.</p>
                    )}
                    <button type="button" className="toastboss-ghost-button" onClick={() => setIncomingOffer(null)}>
                      No thanks
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!loadingSchedule && portalTab === 'dashboard' && !schedule && (
              <div className="toastboss-benefit-block">
                <h3>Your portal is ready</h3>
                <p>You are signed in. Once roster and schedule data are available, your upcoming meetings will show here.</p>
              </div>
            )}
          </section>
        )}
      </main>

      {backExitWarning && (
        <div className="toastboss-back-warning" role="alert">
          <span>Press back one more time to exit the member portal.</span>
          <button
            type="button"
            className="toastboss-back-warning-dismiss"
            onClick={() => {
              setBackExitWarning(false);
              backPressCountRef.current = 0;
              window.history.pushState({ portalGuard: true }, '');
            }}
          >
            Stay in portal
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
