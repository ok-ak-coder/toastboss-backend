import { useState } from 'react';
import { apiClient } from '../api/client';
import { Link, useNavigate } from 'react-router-dom';
import type { FormEvent } from 'react';
import type { UserSession } from '../types';

interface ClubSetupProps {
  onLogin: (user: UserSession) => void;
}

const ClubSetupPage = ({ onLogin }: ClubSetupProps) => {
  const [clubName, setClubName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupMessage, setSetupMessage] = useState('');
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);
  const navigate = useNavigate();

  const handleSetupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmittingSetup(true);
    setSetupMessage('');

    try {
      const response = await apiClient.post('/clubs/setup', {
        clubName,
        adminEmail,
        password,
      });

      const user = response.data.user as UserSession;
      onLogin(user);
      navigate('/dashboard');
    } catch (error: any) {
      setSetupMessage(error?.response?.data?.error ?? 'Unable to create the club admin account right now.');
    } finally {
      setIsSubmittingSetup(false);
    }
  };

  return (
    <section className="toastboss-panel toastboss-setup-page">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">New club setup</span>
        <h2>Create your admin account</h2>
        <p>Start by creating the club admin account. Once you land in the dashboard, you can upload the CSV roster for your club.</p>
      </div>

      <form className="toastboss-form" onSubmit={handleSetupSubmit}>
        <label htmlFor="clubName">Club name</label>
        <input
          id="clubName"
          type="text"
          value={clubName}
          onChange={(event) => setClubName(event.target.value)}
          placeholder="I'll Drink to That Toastmasters"
          required
        />

        <label htmlFor="adminEmail">Admin email</label>
        <input
          id="adminEmail"
          type="email"
          value={adminEmail}
          onChange={(event) => setAdminEmail(event.target.value)}
          placeholder="admin@club.com"
          required
        />

        <label htmlFor="adminRole">Role</label>
        <input id="adminRole" type="text" value="Admin" readOnly />

        <label htmlFor="password">Create password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Create a secure password"
          minLength={8}
          required
        />

        <button type="submit" disabled={isSubmittingSetup}>
          {isSubmittingSetup ? 'Creating admin account...' : 'Create admin account'}
        </button>
      </form>

      {setupMessage && <p className="toastboss-note">{setupMessage}</p>}

      <Link className="toastboss-text-link" to="/for-clubs">
        Back to ToastBoss for clubs
      </Link>
    </section>
  );
};

export default ClubSetupPage;
