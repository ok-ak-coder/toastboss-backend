import { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { IDTT_CLUB_ID, IDTT_CLUB_NAME } from './idtt';
import type { UserSession } from './types';

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

const SESSION_STORAGE_KEY = 'idtt-member-session';
const PENDING_ACCOUNT_STORAGE_KEY = 'idtt-pending-account';

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
  const [emailReminders, setEmailReminders] = useState(true);
  const [swapAlerts, setSwapAlerts] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);

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
    const loadSchedule = async () => {
      if (!session) {
        setSchedule(null);
        return;
      }

      setLoadingSchedule(true);
      try {
        const response = await apiClient.get<ScheduleResponse>('/engine/schedule', {
          params: {
            clubId: IDTT_CLUB_ID,
            email: session.email,
          },
        });
        setSchedule(response.data);
      } catch (error: any) {
        setMessage(
          error?.response?.data?.error ??
            'Signed in successfully, but we could not load the schedule yet.',
        );
      } finally {
        setLoadingSchedule(false);
      }
    };

    if (view === 'dashboard') {
      loadSchedule();
    }
  }, [session, view]);

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
    setView('login');
    setEmail('');
    setPassword('');
    setMessage('');
  };

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
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                    />

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
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                    />

                    <label htmlFor="setupConfirmPassword">Confirm password</label>
                    <input
                      id="setupConfirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Retype your password"
                    />

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

            {message && <p className="toastboss-note">{message}</p>}
            {loadingSchedule && <p>Loading schedule...</p>}

            {!loadingSchedule && schedule && (
              <div className="toastboss-schedule">
                <h3>Upcoming schedule</h3>
                <p className="toastboss-meta">
                  {schedule.clubName} {schedule.meetings?.length ? 'next meetings' : `meeting date: ${schedule.meetingDate}`}
                </p>
                <div className="toastboss-schedule-grid">
                  {getScheduledMeetings(schedule).map((meeting, index) => (
                    <article key={meeting.meetingId} className="toastboss-schedule-week">
                      <div className="toastboss-schedule-week-header">
                        <span className="toastboss-kicker">Week {index + 1}</span>
                        <p className="toastboss-meta">Meeting date: {meeting.meetingDate}</p>
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
