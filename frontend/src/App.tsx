import { useEffect, useRef, useState } from 'react';
import { apiClient } from './api/client';
import { IDTT_CLUB_ID, IDTT_CLUB_NAME } from './idtt';
import type { AgendaEvaluatorMode, AgendaItem, AvailabilityStatus, ClubMemberRecord, RoleKey, UserSession } from './types';

type ViewMode = 'login' | 'signup' | 'setup' | 'dashboard';
type PortalTab = 'dashboard' | 'availability' | 'admin';
type AdminSection = 'members' | 'agenda' | 'schedule';

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
}

interface ScheduledMeeting {
  meetingId: string;
  meetingDate: string;
  locked?: boolean;
  assignments: ScheduleAssignment[];
}

interface ScheduleResponse {
  clubName: string;
  meetingDate: string;
  assignments: ScheduleAssignment[];
  meetings?: ScheduledMeeting[];
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

const SESSION_STORAGE_KEY = 'idtt-member-session';
const PENDING_ACCOUNT_STORAGE_KEY = 'idtt-pending-account';
const IDTT_MEETING_WEEKDAY = 4;
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
  { value: 'topics', label: 'Barroom Topics' },
  { value: 'speaker', label: 'Speaker(s)' },
  { value: 'generalEvaluator', label: 'General Evaluator' },
  { value: 'evaluators', label: 'Evaluator(s)' },
  { value: 'timer', label: 'Timer' },
] as const;
const agendaTemplateDefaults: Record<string, Partial<AgendaItem>> = {
  openingToast: { title: 'Opening Toast', durationMinutes: 5, notes: 'Welcome and introductions' },
  toastmaster: { title: 'Toastmaster', durationMinutes: 5, optional: false },
  educationalMoment: { title: 'Educational Moment', durationMinutes: 5 },
  grammarian: { title: 'Grammarian', durationMinutes: 3 },
  barroomTopics: { title: 'Barroom Topics', durationMinutes: 15 },
  speaker1: { title: 'Speaker 1', durationMinutes: 12 },
  speaker2: { title: 'Speaker 2', durationMinutes: 12 },
  generalEvaluator: { title: 'General Evaluator', durationMinutes: 10 },
  speechEvaluator1: { title: 'Speech Evaluator 1', durationMinutes: 8, evaluatorMode: 'individual' },
  speechEvaluator2: { title: 'Speech Evaluator 2', durationMinutes: 8, evaluatorMode: 'individual' },
  timer: { title: 'Timer', durationMinutes: 3 },
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

const formatMemberPhoneNumber = (value: string | null | undefined) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) {
    return 'Not listed';
  }

  return `(${normalized.slice(0, 3)})${normalized.slice(3, 6)}-${normalized.slice(6)}`;
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
    if (session) {
      return 'dashboard';
    }

    if (pendingAccount) {
      return 'setup';
    }

    return 'login';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailReminders, setEmailReminders] = useState(true);
  const [swapAlerts, setSwapAlerts] = useState(true);
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
  const [savingRosterImport, setSavingRosterImport] = useState(false);
  const [pendingRosterImportText, setPendingRosterImportText] = useState('');
  const [pendingRosterImportFileName, setPendingRosterImportFileName] = useState('');
  const [savingAdminAvailability, setSavingAdminAvailability] = useState(false);
  const [savingAgenda, setSavingAgenda] = useState(false);
  const [scheduleActionMeeting, setScheduleActionMeeting] = useState<string | null>(null);
  const [savingScheduleSlot, setSavingScheduleSlot] = useState<string | null>(null);
  const [editingScheduleMeeting, setEditingScheduleMeeting] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [adminSection, setAdminSection] = useState<AdminSection>('members');
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
  const [adminTargetEmail, setAdminTargetEmail] = useState('');
  const [adminAvailabilityDefault, setAdminAvailabilityDefault] = useState<EditableAvailabilityStatus>('always');
  const [adminAvailabilityOverrides, setAdminAvailabilityOverrides] = useState<Record<string, EditableAvailabilityStatus>>({});
  const [adminEligibleRoles, setAdminEligibleRoles] = useState<EditableRoleKey[]>(roleAvailabilityOptions.map((option) => option.value));
  const [adminCalendarMonthOffset, setAdminCalendarMonthOffset] = useState(0);
  const [selectedAdminAvailabilityDate, setSelectedAdminAvailabilityDate] = useState<string | null>(null);
  const [adminAvailabilityModalOpen, setAdminAvailabilityModalOpen] = useState(false);
  const [draftAdminAvailabilityStatus, setDraftAdminAvailabilityStatus] = useState<EditableAvailabilityStatus>('always');
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
  };

  const getAgendaItemByTitle = (title: string) =>
    agendaItems.find((item) => item.title === title);

  const speakerCount = Math.max(1, Math.min(2, agendaItems.filter((item) => item.role === 'speaker').length || 2));

  const buildAgendaFromSettings = (
    nextSpeakerCount: number,
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

  const handleOpenPrintableRoster = () => {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!printWindow) {
      setMessage('Please allow pop-ups so the printable roster can open.');
      return;
    }

    const printableRows = [...clubRoster]
      .sort((left, right) => formatMemberDisplayName(left.name).localeCompare(formatMemberDisplayName(right.name)))
      .map((member) => `
        <tr>
          <td>${formatMemberDisplayName(member.name)}</td>
          <td>${formatMemberPhoneNumber(member.phoneNumber)}</td>
        </tr>
      `)
      .join('');

    const printableHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${IDTT_CLUB_NAME} Roster</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; margin: 0; background: #f7f1e7; color: #2f241c; }
      .sheet { max-width: 900px; margin: 0 auto; padding: 32px 28px 40px; }
      .toolbar { display: flex; gap: 12px; margin-bottom: 24px; }
      .toolbar button { border: 0; border-radius: 999px; padding: 12px 18px; font-size: 15px; font-weight: 700; cursor: pointer; color: #fffaf3; background: linear-gradient(135deg, #b9472b, #df8f4b); }
      .toolbar button.secondary { color: #8b3d27; background: #fff8ef; border: 1px solid rgba(188, 141, 94, 0.35); }
      h1 { margin: 0; font-size: 34px; line-height: 1; color: #7a2e1f; }
      p { margin: 10px 0 0; color: #5c4a3d; }
      .card { margin-top: 28px; background: rgba(255,255,255,0.88); border: 1px solid rgba(188, 141, 94, 0.24); border-radius: 22px; padding: 18px; box-shadow: 0 18px 36px rgba(93, 67, 42, 0.08); }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 14px 12px; text-align: left; border-bottom: 1px solid rgba(188, 141, 94, 0.2); }
      th { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #8b5337; }
      td { font-size: 18px; }
      tbody tr:last-child td { border-bottom: 0; }
      @media print {
        body { background: #fff; }
        .sheet { max-width: none; padding: 0; }
        .toolbar { display: none; }
        .card { margin-top: 18px; box-shadow: none; border-color: #d7cab9; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="toolbar">
        <button onclick="window.print()">Print roster</button>
        <button class="secondary" onclick="window.close()">Close</button>
      </div>
      <h1>${IDTT_CLUB_NAME}</h1>
      <p>Club roster generated ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone number</th>
            </tr>
          </thead>
          <tbody>
            ${printableRows}
          </tbody>
        </table>
      </div>
    </div>
  </body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(printableHtml);
    printWindow.document.close();
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
      setEditingScheduleMeeting(meetingDate);
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
    const nextAgenda = buildAgendaFromSettings(nextSpeakerCount, evaluatorModes);
    await saveAgendaSettings(nextAgenda, `Agenda updated to ${nextSpeakerCount} speaker${nextSpeakerCount === 1 ? '' : 's'}.`);
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
      const response = await apiClient.post('/auth/member-signup', {
        email,
      });
      const account = response.data.account as UserSession | undefined;
      if (account) {
        setPendingAccount(account);
        setName(account.name ?? '');
      }
      setView('setup');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to start member signup right now.');
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
        emailReminders,
        swapAlerts,
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

  const handleLogout = () => {
    setSession(null);
    setSchedule(null);
    setRosterMember(null);
    setView('login');
    setEmail('');
    setPassword('');
    setMessage('');
  };

  const upcomingMeetings = getScheduledMeetings(schedule);
  const agendaMeetings = upcomingMeetings.slice(0, 2);
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
        <h3>Profile</h3>
        <p className="toastboss-meta">Update your profile photo, name, and short introduction for other members.</p>
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
        <button
          type="button"
          className="toastboss-ghost-button"
          onClick={handleOpenPrintableRoster}
        >
          Open printable club roster
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
            <span className="toastboss-logo">ID</span>
            <div>
              <h1>IDTT Member Portal</h1>
            </div>
          </div>
          {session && (
            <button className="toastboss-header-action" type="button" onClick={handleLogout}>
              Log out
            </button>
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

                    <label htmlFor="loginPassword">Password</label>
                    <input
                      id="loginPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                    />
                    <label className="toastboss-checkbox-row" htmlFor="showLoginPassword">
                      <input
                        id="showLoginPassword"
                        type="checkbox"
                        checked={showPassword}
                        onChange={(event) => setShowPassword(event.target.checked)}
                      />
                      <span>Show password</span>
                    </label>

                    <button type="button" onClick={handleLogin} disabled={submitting}>
                      {submitting ? 'Signing in...' : 'Sign in'}
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

                    <label htmlFor="setupPassword">Create password</label>
                    <input
                      id="setupPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                    />
                    <label className="toastboss-checkbox-row" htmlFor="showSetupPassword">
                      <input
                        id="showSetupPassword"
                        type="checkbox"
                        checked={showPassword}
                        onChange={(event) => setShowPassword(event.target.checked)}
                      />
                      <span>Show password</span>
                    </label>

                    <label htmlFor="setupConfirmPassword">Confirm password</label>
                    <input
                      id="setupConfirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Retype your password"
                    />
                    <label className="toastboss-checkbox-row" htmlFor="showConfirmPassword">
                      <input
                        id="showConfirmPassword"
                        type="checkbox"
                        checked={showConfirmPassword}
                        onChange={(event) => setShowConfirmPassword(event.target.checked)}
                      />
                      <span>Show confirm password</span>
                    </label>

                    <label className="toastboss-checkbox-row" htmlFor="emailReminders">
                      <input
                        id="emailReminders"
                        type="checkbox"
                        checked={emailReminders}
                        onChange={(event) => setEmailReminders(event.target.checked)}
                      />
                      <span>Email me assignment reminders</span>
                    </label>

                    <label className="toastboss-checkbox-row" htmlFor="swapAlerts">
                      <input
                        id="swapAlerts"
                        type="checkbox"
                        checked={swapAlerts}
                        onChange={(event) => setSwapAlerts(event.target.checked)}
                      />
                      <span>Email me swap alerts and scheduling updates</span>
                    </label>

                    <button type="button" onClick={handleCompleteSetup} disabled={submitting}>
                      {submitting ? 'Finishing setup...' : 'Finish account setup'}
                    </button>
                  </div>
                </>
              )}

              {message && <p className="toastboss-note">{message}</p>}
            </div>

            <div className="toastboss-setup-section">
              <div className="toastboss-section-copy">
                <span className="toastboss-kicker">Portal Access</span>
                <h3>{view === 'signup' ? 'Already have an account?' : 'First time here?'}</h3>
                <p>
                  {view === 'signup'
                    ? 'Return to the sign-in screen if your member account is already set up.'
                    : 'If your email is already on the roster, start your account setup here.'}
                </p>
              </div>

              {view === 'signup' ? (
                <button
                  type="button"
                  className="toastboss-secondary-cta"
                  onClick={() => {
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
            <div className="toastboss-section-copy">
              <span className="toastboss-kicker">Welcome</span>
              <h2>{formatMemberDisplayName(session.name)}</h2>
              <p>Signed in as {session.email} for {IDTT_CLUB_NAME}.</p>
            </div>

            <div className="toastboss-tabbar" role="tablist" aria-label="Member portal sections">
              <button
                type="button"
                className={portalTab === 'dashboard' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                onClick={() => setPortalTab('dashboard')}
              >
                Dashboard
              </button>
                <button
                  type="button"
                  className={portalTab === 'availability' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                onClick={() => setPortalTab('availability')}
              >
                Member Settings
              </button>
              {isOfficer && (
                <button
                  type="button"
                  className={portalTab === 'admin' ? 'toastboss-tab is-active' : 'toastboss-tab'}
                  onClick={() => setPortalTab('admin')}
                >
                  Admin
                </button>
              )}
            </div>

            {message && <p className="toastboss-note">{message}</p>}
            {(loadingSchedule || loadingAvailability) && <p>Loading your portal details...</p>}

            {portalTab === 'dashboard' && !loadingSchedule && schedule && (
              <div className="toastboss-schedule">
                <h3>Upcoming Agendas</h3>
                <div className="toastboss-schedule-grid">
                  {agendaMeetings.map((meeting) => (
                    <article key={meeting.meetingId} className="toastboss-schedule-week">
                      <div className="toastboss-schedule-week-header">
                        <h4 className="toastboss-schedule-date">{formatMeetingMonthDay(meeting.meetingDate)}</h4>
                      </div>
                      <ul>
                        {meeting.assignments.map((assignment) => (
                          <li key={`${meeting.meetingId}-${assignment.role}`}>
                            <strong>{assignment.role}</strong>: {assignment.memberName ? formatMemberDisplayName(assignment.memberName) : assignment.memberId ?? 'Unassigned'}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {portalTab === 'availability' && !loadingAvailability && (
              <div className="toastboss-member-settings-stack">
                {renderProfileSettings()}
                {renderAvailabilityManager({
                  heading: 'Availability Settings',
                  description: 'Set your normal availability, then tap a Thursday date when you need an exception.',
                  defaultStatus: availabilityDefault,
                  onDefaultChange: setAvailabilityDefault,
                  saving: savingAvailability,
                  calendarMonth: availabilityCalendarMonth,
                  onPreviousMonth: () => setCalendarMonthOffset((current) => current - 1),
                  onNextMonth: () => setCalendarMonthOffset((current) => current + 1),
                  getStatusForDate: getEffectiveAvailability,
                  onDayClick: openAvailabilityModal,
                })}
              </div>
            )}

            {portalTab === 'admin' && isOfficer && !loadingAvailability && (
              <div className="toastboss-admin-section">
                <div className="toastboss-section-copy">
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
                    <p className="toastboss-meta">Set the number of speakers and choose assigned evaluator or round robin for each speech evaluator slot.</p>
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
                    <div className="toastboss-schedule-grid">
                      {upcomingMeetings.slice(0, 4).map((meeting) => (
                        <article key={`admin-${meeting.meetingId}`} className="toastboss-schedule-week">
                        <div className="toastboss-schedule-week-header">
                          <h4 className="toastboss-schedule-date">{formatMeetingMonthDay(meeting.meetingDate)}</h4>
                        </div>

                        <div className="toastboss-agenda-lockbar">
                          <span className={meeting.locked ? 'toastboss-lock-badge is-locked' : 'toastboss-lock-badge'}>
                            {meeting.locked ? 'Locked' : editingScheduleMeeting === meeting.meetingDate ? 'Editing draft' : 'Auto-generated'}
                          </span>
                          <div className="toastboss-lock-actions">
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
                            return (
                              <li key={`${meeting.meetingId}-${assignment.slotId ?? assignment.role}`}>
                                <strong>{assignment.role}</strong>
                                {!meeting.locked && editingScheduleMeeting === meeting.meetingDate ? (
                                  <select
                                    value={assignment.memberEmail ?? ''}
                                    disabled={savingScheduleSlot === slotKey}
                                    onChange={(event) =>
                                      handleManualAssignmentChange(
                                        meeting.meetingDate,
                                        assignment,
                                        event.target.value,
                                      )
                                    }
                                  >
                                    <option value="">Unassigned</option>
                                    {clubRoster.map((member) => (
                                      <option key={`${slotKey}-${member.email}`} value={member.email}>
                                        {formatMemberDisplayName(member.name)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span>: {assignment.memberName ? formatMemberDisplayName(assignment.memberName) : assignment.memberId ?? 'Unassigned'}</span>
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

            {!loadingSchedule && portalTab === 'dashboard' && !schedule && (
              <div className="toastboss-benefit-block">
                <h3>Your portal is ready</h3>
                <p>You are signed in. Once roster and schedule data are available, your upcoming meetings will show here.</p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
