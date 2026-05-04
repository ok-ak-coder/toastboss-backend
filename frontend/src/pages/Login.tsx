import { apiClient } from '../api/client';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { UserSession } from '../types';

interface LoginPageProps {
  onLogin: (user: UserSession) => void;
}

const LoginPage = ({ onLogin }: LoginPageProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      onLogin(response.data.user);
      setMessage(`Welcome back, ${response.data.user.name}!`);
      navigate('/dashboard');
    } catch (error: any) {
      const redirectTo = error?.response?.data?.redirectTo;
      const account = error?.response?.data?.account;

      if (redirectTo && account) {
        navigate(redirectTo, { state: { pendingAccount: account } });
        return;
      }

      setMessage(error?.response?.data?.error ?? 'Unable to sign in. Please try again.');
    }
  };

  return (
    <section className="toastboss-panel toastboss-login-layout">
      <div className="toastboss-auth-section">
        <div className="toastboss-section-copy">
          <span className="toastboss-kicker">Member sign in</span>
          <h2>Welcome to ToastBoss</h2>
          <p>Sign in with your email. If you manage a club, the same email can also carry admin and member permissions across multiple clubs.</p>
        </div>

        <form className="toastboss-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@club.com"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />

          <button type="submit">Sign in</button>
        </form>

        {message && <p className="toastboss-note">{message}</p>}
      </div>

      <div className="toastboss-setup-section">
        <div className="toastboss-section-copy">
          <span className="toastboss-kicker">For club leaders</span>
          <h3>Set up ToastBoss for your club</h3>
          <p>See how ToastBoss helps your club schedule more smoothly, reduce admin scramble, and set up a clean admin workflow that scales.</p>
        </div>

        <Link className="toastboss-secondary-cta" to="/for-clubs">
          Use ToastBoss for your club
        </Link>
      </div>
    </section>
  );
};

export default LoginPage;
