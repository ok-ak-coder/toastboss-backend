import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { FormEvent } from 'react';
import type { UserSession } from '../types';

interface AccountSetupPageProps {
  onLogin: (user: UserSession) => void;
}

const AccountSetupPage = ({ onLogin }: AccountSetupPageProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const stateAccount = (location.state as { pendingAccount?: UserSession } | null)?.pendingAccount;
  const [pendingAccount, setPendingAccount] = useState<UserSession | null>(() => {
    if (stateAccount) {
      return stateAccount;
    }

    const stored = window.sessionStorage.getItem('toastboss-pending-account');
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as UserSession;
    } catch {
      return null;
    }
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailReminders, setEmailReminders] = useState(true);
  const [swapAlerts, setSwapAlerts] = useState(true);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (stateAccount) {
      setPendingAccount(stateAccount);
      window.sessionStorage.setItem('toastboss-pending-account', JSON.stringify(stateAccount));
    }
  }, [stateAccount]);

  const rolesSummary = useMemo(() => {
    return pendingAccount?.memberships
      .map((membership) => `${membership.clubName}: ${membership.roles.join(', ')}`)
      .join(' | ') ?? '';
  }, [pendingAccount]);

  if (!pendingAccount) {
    return <Navigate to="/setup-club" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.length < 8) {
      setMessage('Please choose a password with at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match yet.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await apiClient.post('/auth/complete-setup', {
        email: pendingAccount.email,
        name: pendingAccount.name,
        password,
        emailReminders,
        swapAlerts,
      });

      window.sessionStorage.removeItem('toastboss-pending-account');
      onLogin(response.data.user);
      navigate('/dashboard');
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to finish account setup right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="toastboss-panel toastboss-setup-page">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">Account setup</span>
        <h2>Finish your account setup</h2>
        <p>Create your password, choose notification preferences, and keep using the same email across your club permissions.</p>
      </div>

      <div className="toastboss-benefit-block">
        <h3>{pendingAccount.name}</h3>
        <p>{pendingAccount.email}</p>
        <p>{rolesSummary}</p>
      </div>

      <form className="toastboss-form" onSubmit={handleSubmit}>
        <label htmlFor="password">Create password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          required
        />

        <label htmlFor="confirmPassword">Confirm password</label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Retype your password"
          required
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

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Finishing account...' : 'Finish account setup'}
        </button>
      </form>

      {message && <p className="toastboss-note">{message}</p>}

      <Link className="toastboss-text-link" to="/login">
        Back to sign in
      </Link>
    </section>
  );
};

export default AccountSetupPage;
