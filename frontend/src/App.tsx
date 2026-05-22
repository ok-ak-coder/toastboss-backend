import { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { IDTT_CLUB_ID, IDTT_CLUB_NAME } from './idtt';
import type { AvailabilityStatus, ClubMemberRecord, UserSession } from './types';

type ViewMode = 'login' | 'signup' | 'setup' | 'dashboard';

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

type EditableAvailabilityStatus = (typeof availabilityOptions)[number]['value'];

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
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [rosterMember, setRosterMember] = useState<ClubMemberRecord | null>(null);
  const [availabilityDefault, setAvailabilityDefault] = useState<EditableAvailabilityStatus>('always');
  const [availabilityOverrides, setAvailabilityOverrides] = useState<Record<string, EditableAvailabilityStatus>>({});
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState<string | null>(null);

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
          const member =
            rosterResult.value.data.club.roster.find(
              (entry) => entry.email.toLowerCase() === session.email.toLowerCase(),
            ) ?? null;
          setRosterMember(member);
          setAvailabilityDefault(normalizeAvailabilityStatus(member?.availabilityDefault));
          setAvailabilityOverrides(
            Object.fromEntries(
              Object.entries(member?.availabilityOverrides ?? {}).map(([meetingDate, status]) => [
                meetingDate,
                normalizeAvailabilityStatus(status),
              ]),
            ),
          );
        } else {
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
      });

      const member =
        response.data.club.roster.find(
          (entry) => entry.email.toLowerCase() === session.email.toLowerCase(),
        ) ?? null;
      setRosterMember(member);
      setAvailabilityDefault(normalizeAvailabilityStatus(member?.availabilityDefault));
      setAvailabilityOverrides(
        Object.fromEntries(
          Object.entries(member?.availabilityOverrides ?? {}).map(([meetingDate, status]) => [
            meetingDate,
            normalizeAvailabilityStatus(status),
          ]),
        ),
      );
      setMessage('Your availability has been updated.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save your availability right now.');
    } finally {
      setSavingAvailability(false);
    }
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
  const scheduleMeetings = upcomingMeetings.slice(0, 4);
  const availabilityCalendarMonth = buildAvailabilityCalendarMonth(calendarMonthOffset);
  const isOfficer = rosterMember?.roles.includes('admin')
    ?? session?.memberships.some(
      (membership) => membership.clubId === IDTT_CLUB_ID && membership.roles.includes('admin'),
    )
    ?? false;
  const getEffectiveAvailability = (meetingDate: string): EditableAvailabilityStatus =>
    availabilityOverrides[meetingDate] ?? availabilityDefault;
  const selectedAvailabilityStatus = selectedAvailabilityDate
    ? getEffectiveAvailability(selectedAvailabilityDate)
    : availabilityDefault;
  const selectedIsOverride = selectedAvailabilityDate
    ? Boolean(availabilityOverrides[selectedAvailabilityDate])
    : false;

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

            <div className="toastboss-benefit-block">
              <h3>{isOfficer ? 'Officer access is active' : 'Member access is active'}</h3>
              <p>
                {isOfficer
                  ? 'You can manage your own availability now, and officer-only tools can build on this access next.'
                  : 'You can set your availability defaults now and adjust specific upcoming meetings as needed.'}
              </p>
            </div>

            {message && <p className="toastboss-note">{message}</p>}
            {(loadingSchedule || loadingAvailability) && <p>Loading your portal details...</p>}

            {!loadingAvailability && (
              <div className="toastboss-schedule">
                <h3>Your availability</h3>
                <p className="toastboss-meta">
                  Pick your usual status first. Then change any specific meeting date below if needed.
                </p>

                <div className="toastboss-availability-savebar">
                  <button type="button" onClick={handleAvailabilitySave} disabled={savingAvailability}>
                    {savingAvailability ? 'Saving availability...' : 'Save availability'}
                  </button>
                </div>

                <div className="toastboss-schedule-grid">
                  <article className="toastboss-schedule-week">
                    <div className="toastboss-schedule-week-header">
                      <span className="toastboss-kicker">Default</span>
                      <p className="toastboss-meta">Used for most future meetings.</p>
                    </div>

                    <div className="toastboss-form">
                      <label htmlFor="availabilityDefault">Default availability</label>
                      <select
                        id="availabilityDefault"
                        value={availabilityDefault}
                        onChange={(event) => setAvailabilityDefault(event.target.value as EditableAvailabilityStatus)}
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
                        Your Thursday meeting calendar. Load more months anytime and click a date to customize it.
                      </p>
                    </div>

                    {availabilityCalendarMonth ? (
                      <div className="toastboss-availability-panel">
                        <div className="toastboss-availability-legend">
                          <span className="toastboss-availability-legend-item toastboss-availability-legend-always">Available</span>
                          <span className="toastboss-availability-legend-item toastboss-availability-legend-tentative">Tentative</span>
                          <span className="toastboss-availability-legend-item toastboss-availability-legend-never">Unavailable</span>
                        </div>

                        <article key={availabilityCalendarMonth.monthKey} className="toastboss-availability-month">
                          <div className="toastboss-availability-month-toolbar">
                            <button
                              type="button"
                              className="toastboss-month-nav"
                              onClick={() => setCalendarMonthOffset((current) => current - 1)}
                            >
                              Previous
                            </button>
                            <div className="toastboss-availability-month-header">
                              <h4>{availabilityCalendarMonth.label}</h4>
                            </div>
                            <button
                              type="button"
                              className="toastboss-month-nav"
                              onClick={() => setCalendarMonthOffset((current) => current + 1)}
                            >
                              Next
                            </button>
                          </div>
                          <div className="toastboss-availability-weekdays">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
                              <span key={`${availabilityCalendarMonth.monthKey}-${weekday}`}>{weekday}</span>
                            ))}
                          </div>
                          <div className="toastboss-availability-month-grid">
                            {availabilityCalendarMonth.weeks.flat().map((day) => {
                              if (!day.isCurrentMonth) {
                                return (
                                  <div
                                    key={`${availabilityCalendarMonth.monthKey}-${day.dateKey}`}
                                    className="toastboss-calendar-day toastboss-calendar-day-outside"
                                  />
                                );
                              }

                              const status = getEffectiveAvailability(day.dateKey);
                              const isSelected = selectedAvailabilityDate === day.dateKey;
                              const isOverride = Boolean(availabilityOverrides[day.dateKey]);

                              return (
                                <button
                                  key={`${availabilityCalendarMonth.monthKey}-${day.dateKey}`}
                                  type="button"
                                  className={
                                    day.isMeetingDay
                                      ? `toastboss-calendar-day toastboss-calendar-day-meeting toastboss-calendar-day-${status}${isSelected ? ' is-selected' : ''}`
                                      : 'toastboss-calendar-day'
                                  }
                                  onClick={() => {
                                    if (day.isMeetingDay) {
                                      setSelectedAvailabilityDate(day.dateKey);
                                    }
                                  }}
                                  disabled={!day.isMeetingDay}
                                >
                                  <span className="toastboss-calendar-day-number">{day.dayNumber}</span>
                                  {day.isMeetingDay ? (
                                    <>
                                      <span className="toastboss-calendar-day-label">
                                        {status === 'always'
                                          ? 'Available'
                                          : status === 'tentative'
                                            ? 'Tentative'
                                            : 'Unavailable'}
                                      </span>
                                      <span className="toastboss-calendar-day-note">
                                        {isOverride ? 'Custom' : 'Default'}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="toastboss-calendar-day-note">
                                      {day.isPast ? 'Past' : ''}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </article>

                        {selectedAvailabilityDate && (
                          <div className="toastboss-availability-editor">
                            <div className="toastboss-availability-editor-copy">
                              <h4>{formatMeetingDate(selectedAvailabilityDate)}</h4>
                              <p>
                                {selectedIsOverride
                                  ? 'This date has its own custom availability.'
                                  : 'This date is currently following your default availability.'}
                              </p>
                            </div>

                            <div className="toastboss-availability-editor-options">
                              {availabilityOptions.map((option) => (
                                <label key={`selected-${option.value}`} className="toastboss-availability-radio-card">
                                  <input
                                    type="radio"
                                    name="selectedAvailabilityDate"
                                    checked={selectedAvailabilityStatus === option.value}
                                    onChange={() =>
                                      handleAvailabilityOverrideChange(selectedAvailabilityDate, option.value)
                                    }
                                  />
                                  <span>{option.label}</span>
                                </label>
                              ))}
                            </div>

                            <button
                              type="button"
                              className="toastboss-secondary-cta"
                              onClick={() => {
                                setAvailabilityOverrides((current) => {
                                  const next = { ...current };
                                  delete next[selectedAvailabilityDate];
                                  return next;
                                });
                              }}
                            >
                              Use default for this date
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="toastboss-meta">
                        Your meeting schedule will appear here as soon as upcoming dates are available.
                      </p>
                  )}
                  </article>
                </div>

                <div className="toastboss-availability-savebar">
                  <button type="button" onClick={handleAvailabilitySave} disabled={savingAvailability}>
                    {savingAvailability ? 'Saving availability...' : 'Save availability'}
                  </button>
                </div>
              </div>
            )}

            {!loadingSchedule && schedule && (
              <div className="toastboss-schedule">
                <h3>Upcoming schedule</h3>
                <p className="toastboss-meta">
                  {schedule.clubName} {schedule.meetings?.length ? 'next 4 meetings' : `meeting date: ${schedule.meetingDate}`}
                </p>
                <div className="toastboss-schedule-grid">
                  {scheduleMeetings.map((meeting, index) => (
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

            {!loadingSchedule && !schedule && (
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
