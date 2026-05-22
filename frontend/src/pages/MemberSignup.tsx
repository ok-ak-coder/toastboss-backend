import { apiClient } from '../api/client';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { FormEvent } from 'react';

const MemberSignupPage = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage('');

    try {
      const response = await apiClient.post('/auth/member-signup', { email });
      const pendingAccount = response.data.account;

      if (pendingAccount) {
        window.sessionStorage.setItem('toastboss-pending-account', JSON.stringify(pendingAccount));
      }

      navigate(response.data.redirectTo ?? '/activate-account', {
        state: pendingAccount ? { pendingAccount } : undefined,
      });
    } catch (error: any) {
      setMessage(
        error?.response?.data?.error ??
          'Unable to start member signup right now. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="toastboss-panel toastboss-setup-page">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">New member sign up</span>
        <h2>Create your member account</h2>
        <p>Use the email IDTT already has on file. If an admin added you to the roster, we will send you into first-time account setup.</p>
      </div>

      <form className="toastboss-form" onSubmit={handleSubmit}>
        <label htmlFor="memberSignupEmail">Email address</label>
        <input
          id="memberSignupEmail"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@club.com"
          required
        />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Checking member record...' : 'Continue as a new member'}
        </button>
      </form>

      {message && <p className="toastboss-note">{message}</p>}

      <Link className="toastboss-text-link" to="/login">
        Back to sign in
      </Link>
    </section>
  );
};

export default MemberSignupPage;
