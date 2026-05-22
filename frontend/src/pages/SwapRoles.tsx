import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { IDTT_CLUB_ID } from '../idtt';
import type { UserSession } from '../types';

interface SwapRolesProps {
  user: UserSession;
}

interface SwapCandidate {
  id: string;
  name: string;
  email: string;
  availabilityStatus: string;
  bossScore: number;
  preferred: boolean;
}

interface SwapOption {
  meetingId: string;
  meetingDate: string;
  role: string;
  roleKey: string;
  currentMember: {
    id: string;
    name: string;
    email: string;
  };
  candidates: SwapCandidate[];
}

interface SwapResponse {
  clubId: string;
  clubName: string;
  swaps: SwapOption[];
}

const SwapRolesPage = ({ user }: SwapRolesProps) => {
  const [swapData, setSwapData] = useState<SwapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const membership = useMemo(
    () => user.memberships.find((entry) => entry.clubId === IDTT_CLUB_ID) ?? null,
    [user.memberships],
  );

  useEffect(() => {
    const fetchSwaps = async () => {
      if (!membership) {
        setLoading(false);
        setMessage('This account is not set up for the member portal yet.');
        return;
      }

      setLoading(true);
      setMessage('');

      try {
        const response = await apiClient.get<SwapResponse>(`/clubs/${IDTT_CLUB_ID}/swaps`, {
          params: { email: user.email },
        });
        setSwapData(response.data);
      } catch (error: any) {
        setMessage(error?.response?.data?.error ?? 'Unable to load swap options right now.');
      } finally {
        setLoading(false);
      }
    };

    fetchSwaps();
  }, [membership, user.email]);

  return (
    <section className="toastboss-panel">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">Role swaps</span>
        <h2>Swap options for your assigned roles</h2>
        <p>These are suggested members who appear available and are not already assigned in that meeting.</p>
      </div>

      {loading && <p>Loading swap options...</p>}
      {message && <p className="toastboss-note">{message}</p>}

      {!loading && !message && swapData && swapData.swaps.length === 0 && (
        <div className="toastboss-benefit-block">
          <h3>No assigned roles to swap right now</h3>
          <p>Once you are scheduled for an upcoming meeting, suggested swap candidates will show up here.</p>
        </div>
      )}

      {!loading && swapData && swapData.swaps.length > 0 && (
        <div className="toastboss-admin-grid">
          {swapData.swaps.map((swap) => (
            <article key={`${swap.meetingId}-${swap.roleKey}`} className="toastboss-admin-card">
              <div className="toastboss-admin-card-header">
                <h3>{swap.role}</h3>
                <span>{swap.meetingDate}</span>
              </div>
              {swap.candidates.length === 0 ? (
                <p>No unassigned candidates were found for this role yet.</p>
              ) : (
                <div className="toastboss-inline-edit-stack">
                  {swap.candidates.map((candidate) => (
                    <div key={`${swap.meetingId}-${candidate.id}`} className="toastboss-benefit-block">
                      <h3>{candidate.name}</h3>
                      <p>{candidate.email}</p>
                      <p>Availability: {candidate.availabilityStatus}</p>
                      <p>BossScore: {candidate.bossScore}</p>
                      <p>{candidate.preferred ? 'Prefers this role' : 'General candidate'}</p>
                      <a
                        className="toastboss-text-link"
                        href={`mailto:${candidate.email}?subject=${encodeURIComponent(`IDTT role swap for ${swap.role} on ${swap.meetingDate}`)}`}
                      >
                        Contact about this swap
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Link className="toastboss-text-link" to="/dashboard">
        Back to member portal
      </Link>
    </section>
  );
};

export default SwapRolesPage;
