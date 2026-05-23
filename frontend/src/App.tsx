import { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { IDTT_CLUB_ID, IDTT_CLUB_NAME } from './idtt';
import type { AvailabilityStatus, ClubMemberRecord, RoleKey, UserSession } from './types';

type ViewMode = 'login' | 'signup' | 'setup' | 'dashboard';
type PortalTab = 'dashboard' | 'availability' | 'admin';

interface ScheduleAssignment {
  meetingId: string;
  role: string;
  memberId: string | null;
  memberName?: string | null;
  confidence: number;
  reason: string;
}

interface ScheduledMeeting {
  meetingId: string;
  meetingDate: string;
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
  { value: 'toastmaster', label: 'Toastmaster' },
  { value: 'speaker', label: 'Speaker' },
  { value: 'evaluators', label: 'Speech Evaluator' },
  { value: 'topics', label: 'Barroom Topics' },
  { value: 'generalEvaluator', label: 'General Evaluator' },
  { value: 'timer', label: 'Timer' },
  { value: 'grammarians', label: 'Grammarian' },
  { value: 'educationalMoment', label: 'Educational Moment' },
] as const;

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

const formatMonthLabel = (value: Date) =>
  value.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
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
    weeks,
  };
};

function App() {
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
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [savingAdminAvailability, setSavingAdminAvailability] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
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
        const [scheduleResult, rosterResult] = await Promise.allSettled([
          apiClient.get<ScheduleResponse>('/engine/schedule', {
            params: {
              clubId: IDTT_CLUB_ID,
              email: session.email,
            },
          }),
          apiClient.get<ClubRosterResponse>(`/clubs/${IDTT_CLUB_ID}/roster`, {
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
    setRosterMember(selfMember);
    setAvailabilityDefault(normalizeAvailabilityStatus(selfMember?.availabilityDefault));
    setEligibleRoles(normalizeEligibleRoles(selfMember?.eligibleRoles));
    setAvailabilityOverrides(
      Object.fromEntries(
        Object.entries(selfMember?.availabilityOverrides ?? {}).map(([meetingDate, status]) => [
          meetingDate,
          normalizeAvailabilityStatus(status),
        ]),
      ),
    );
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
      applyRosterToState(response.data.club.roster);
      setMessage('Member availability has been updated.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save member availability right now.');
    } finally {
      setSavingAdminAvailability(false);
    }
  };

  const openAvailabilityModal = (meetingDate: string) => {
    setSelectedAvailabilityDate(meetingDate);
    setDraftAvailabilityStatus(getEffectiveAvailability(meetingDate));
    setAvailabilityModalOpen(true);
  };

  const closeAvailabilityModal = () => {
    setAvailabilityModalOpen(false);
  };

  const handleAvailabilityModalSave = () => {
    if (!selectedAvailabilityDate) {
      return;
    }

    handleAvailabilityOverrideChange(selectedAvailabilityDate, draftAvailabilityStatus);
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

  const handleAdminAvailabilityModalSave = () => {
    if (!selectedAdminAvailabilityDate) {
      return;
    }

    handleAdminAvailabilityOverrideChange(selectedAdminAvailabilityDate, draftAdminAvailabilityStatus);
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

  const renderAvailabilityManager = ({
    heading,
    description,
    defaultStatus,
    onDefaultChange,
    onSave,
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
    onSave: () => void;
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

      <div className="toastboss-availability-savebar">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Saving availability...' : 'Save availability'}
        </button>
      </div>

      <div className="toastboss-availability-stack">
        <article className="toastboss-schedule-week">
          <div className="toastboss-schedule-week-header">
            <span className="toastboss-kicker">Default</span>
            <p className="toastboss-meta">Used for most future meetings.</p>
          </div>

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
        </article>

        <article className="toastboss-schedule-week">
            <div className="toastboss-schedule-week-header">
              <span className="toastboss-kicker">Calendar</span>
              <p className="toastboss-meta">
                Tap a Thursday date to change that one meeting only.
              </p>
            </div>

          <div className="toastboss-availability-panel">
            <div className="toastboss-availability-legend">
              <span className="toastboss-availability-legend-item toastboss-availability-legend-always">Available</span>
              <span className="toastboss-availability-legend-item toastboss-availability-legend-tentative">Tentative</span>
              <span className="toastboss-availability-legend-item toastboss-availability-legend-never">Unavailable</span>
            </div>

            <article key={calendarMonth.monthKey} className="toastboss-availability-month">
              <div className="toastboss-availability-month-toolbar">
                <button type="button" className="toastboss-month-nav" onClick={onPreviousMonth}>
                  Previous
                </button>
                <div className="toastboss-availability-month-header">
                  <h4>{calendarMonth.label}</h4>
                </div>
                <button type="button" className="toastboss-month-nav" onClick={onNextMonth}>
                  Next
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

      <div className="toastboss-availability-savebar">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Saving availability...' : 'Save availability'}
        </button>
      </div>
    </div>
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
              <p>Login, onboarding, and your meeting schedule in one place.</p>
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
              <h2>{session.name}</h2>
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
                Availability
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
                <h3>Next two agendas</h3>
                <p className="toastboss-meta">A quick look at the next two club meetings.</p>
                <div className="toastboss-schedule-grid">
                  {agendaMeetings.map((meeting, index) => (
                    <article key={meeting.meetingId} className="toastboss-schedule-week">
                      <div className="toastboss-schedule-week-header">
                        <span className="toastboss-kicker">Week {index + 1}</span>
                        <p className="toastboss-meta">Meeting date: {formatMeetingDate(meeting.meetingDate)}</p>
                      </div>
                      <ul>
                        {meeting.assignments.map((assignment) => (
                          <li key={`${meeting.meetingId}-${assignment.role}`}>
                            <strong>{assignment.role}</strong>: {assignment.memberName ?? assignment.memberId ?? 'Unassigned'}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {portalTab === 'availability' && !loadingAvailability && renderAvailabilityManager({
              heading: 'Your availability',
              description: 'Set your normal availability, then tap a Thursday date when you need an exception.',
              defaultStatus: availabilityDefault,
              onDefaultChange: setAvailabilityDefault,
              onSave: handleAvailabilitySave,
              saving: savingAvailability,
              calendarMonth: availabilityCalendarMonth,
              onPreviousMonth: () => setCalendarMonthOffset((current) => current - 1),
              onNextMonth: () => setCalendarMonthOffset((current) => current + 1),
              getStatusForDate: getEffectiveAvailability,
              onDayClick: openAvailabilityModal,
            })}

            {portalTab === 'admin' && isOfficer && !loadingAvailability && adminTargetMember && (
              <div className="toastboss-admin-section">
                <div className="toastboss-section-copy">
                  <span className="toastboss-kicker">Admin tools</span>
                  <h3>Adjust member availability</h3>
                  <p>Choose a member, then use the same calendar to update their Thursday availability.</p>
                </div>

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
                        {member.name} ({member.email})
                      </option>
                    ))}
                  </select>
                </div>

                {adminTargetMember ? (
                  <>
                    {renderRoleEligibilityManager({
                      heading: 'Allowed roles',
                      description: 'Uncheck any roles this member should be excluded from before you adjust their calendar.',
                      selectedRoles: adminEligibleRoles,
                      onRoleToggle: (role) => toggleEligibleRole(adminEligibleRoles, setAdminEligibleRoles, role),
                    })}

                    {renderAvailabilityManager({
                      heading: `${adminTargetMember.name} availability`,
                      description: 'Change the member default or tap any Thursday date to create a one-date exception.',
                      defaultStatus: adminAvailabilityDefault,
                      onDefaultChange: setAdminAvailabilityDefault,
                      onSave: handleAdminAvailabilitySave,
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
                          onChange={() => setDraftAvailabilityStatus(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="toastboss-modal-actions">
                    <button type="button" onClick={handleAvailabilityModalSave}>
                      Save and update
                    </button>
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
                          onChange={() => setDraftAdminAvailabilityStatus(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="toastboss-modal-actions">
                    <button type="button" onClick={handleAdminAvailabilityModalSave}>
                      Save and update
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
    </div>
  );
}

export default App;
