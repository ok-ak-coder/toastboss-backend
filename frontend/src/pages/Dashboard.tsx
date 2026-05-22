import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { IDTT_CLUB_ID, IDTT_CLUB_NAME } from '../idtt';
import type { ClubMembership, UserRole, UserSession } from '../types';

interface DashboardProps {
  user: UserSession;
}

interface AssignmentItem {
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
  assignments: AssignmentItem[];
}

interface ScheduleResponse {
  clubId: string;
  clubName: string;
  meetingId: string;
  meetingDate: string;
  assignments: AssignmentItem[];
  meetings?: ScheduledMeeting[];
}

const getRoleOptions = (membership: ClubMembership): UserRole[] =>
  membership.roles.includes('admin') ? ['admin', 'member'] : ['member'];

const formatRoleLabel = (role: UserRole) => (role === 'admin' ? 'Admin' : 'Member');

const getScheduledMeetings = (schedule: ScheduleResponse): ScheduledMeeting[] => {
  if (Array.isArray(schedule.meetings) && schedule.meetings.length > 0) {
    return schedule.meetings;
  }

  return [
    {
      meetingId: schedule.meetingId,
      meetingDate: schedule.meetingDate,
      assignments: schedule.assignments,
    },
  ];
};

const DashboardPage = ({ user }: DashboardProps) => {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('Boss made the call - your next meeting lineup is ready.');
  const activeMembership = useMemo(
    () => user.memberships.find((membership) => membership.clubId === IDTT_CLUB_ID) ?? user.memberships[0] ?? null,
    [user.memberships],
  );
  const [activeRole, setActiveRole] = useState<UserRole>(() =>
    activeMembership?.roles.includes('admin') ? 'admin' : 'member',
  );
  const canManageClub = (activeMembership?.roles.includes('admin') ?? false) && activeRole === 'admin';

  useEffect(() => {
    const fetchSchedule = async () => {
      if (!activeMembership) {
        setSchedule(null);
        setLoading(false);
        setNote('This account is not set up for IDTT yet.');
        return;
      }

      setLoading(true);
      try {
        const response = await apiClient.get<ScheduleResponse>('/engine/schedule', {
          params: {
            clubId: IDTT_CLUB_ID,
            email: user.email,
          },
        });
        setSchedule(response.data);
        setNote(`Generated from the current ${response.data.clubName || IDTT_CLUB_NAME} roster.`);
      } catch (error) {
        setNote('Unable to load schedule. Please check connectivity.');
      } finally {
        setLoading(false);
      }
    };

    fetchSchedule();
  }, [activeMembership, user.email]);

  return (
    <section className="toastboss-panel">
      <div className="toastboss-intro">
        <h2>IDTT Member Portal</h2>
        <p>{note}</p>
        <div className="toastboss-meta">
          <span>Signed in as {user.name} ({user.email})</span>
        </div>
        {activeMembership && (
          <div className="toastboss-meta">
            <span>{activeMembership.clubName || IDTT_CLUB_NAME}</span>
          </div>
        )}
      </div>

      {activeMembership && (
        <section className="toastboss-admin-section">
          <div className="toastboss-section-copy">
            <span className="toastboss-kicker">Member tools</span>
            <h3>Your next steps</h3>
            <p>Check upcoming roles, update your availability, and review possible swap options.</p>
          </div>

          <div className="toastboss-admin-grid">
            <article className="toastboss-admin-card">
              <div className="toastboss-admin-card-header">
                <h3>Availability</h3>
                <span>Keep your dates current</span>
              </div>
              <div className="toastboss-admin-links">
                <Link className="toastboss-secondary-cta" to="/roster">
                  Update my availability
                </Link>
              </div>
            </article>

            <article className="toastboss-admin-card">
              <div className="toastboss-admin-card-header">
                <h3>Role swaps</h3>
                <span>See who could cover your role</span>
              </div>
              <div className="toastboss-admin-links">
                <Link className="toastboss-secondary-cta toastboss-secondary-cta-alt" to="/swap-roles">
                  Explore swap options
                </Link>
              </div>
            </article>
          </div>
        </section>
      )}

      {activeMembership && (
        <div className="toastboss-dashboard-controls">
          <div className="toastboss-role-switcher">
            <label htmlFor={`club-role-${activeMembership.clubId}`}>Role</label>
            <select
              id={`club-role-${activeMembership.clubId}`}
              value={activeRole}
              onChange={(event) => setActiveRole(event.target.value as UserRole)}
            >
              {getRoleOptions(activeMembership).map((role) => (
                <option key={`${activeMembership.clubId}-${role}`} value={role}>
                  {formatRoleLabel(role)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {canManageClub && (
        <section className="toastboss-admin-section">
          <div className="toastboss-section-copy">
            <span className="toastboss-kicker">Admin tools</span>
            <h3>IDTT management</h3>
            <p>Open the management screens for the club.</p>
          </div>

          <div className="toastboss-admin-grid">
            <article className="toastboss-admin-card">
              <div className="toastboss-admin-card-header">
                <h3>{activeMembership.clubName || IDTT_CLUB_NAME}</h3>
                <span>Viewing as {formatRoleLabel(activeRole)}</span>
              </div>

              <div className="toastboss-admin-links">
                <Link className="toastboss-secondary-cta" to="/roster">
                  View/Edit roster
                </Link>
                <Link className="toastboss-secondary-cta toastboss-secondary-cta-alt" to="/agenda">
                  View/Edit agenda
                </Link>
                <Link className="toastboss-secondary-cta" to="/attendance">
                  Verify attendance
                </Link>
              </div>
            </article>
          </div>
        </section>
      )}

      {loading && <p>Loading schedule...</p>}

      {schedule && (
        <div className="toastboss-schedule">
          <h3>Generated schedule for {schedule.clubName}</h3>
          <p className="toastboss-meta">{schedule.meetings?.length ? 'Next 4 weeks' : `Meeting date: ${schedule.meetingDate}`}</p>
          <div className="toastboss-schedule-grid">
            {getScheduledMeetings(schedule).map((meeting, index) => (
              <article key={meeting.meetingId} className="toastboss-schedule-week">
                <div className="toastboss-schedule-week-header">
                  <span className="toastboss-kicker">Week {index + 1}</span>
                  <p className="toastboss-meta">Meeting date: {meeting.meetingDate}</p>
                </div>
                <ul>
                  {meeting.assignments.map((assignment) => (
                    <li key={`${assignment.meetingId}-${assignment.role}`}>
                      <strong>{assignment.role}</strong>: {assignment.memberName ?? assignment.memberId ?? 'Unassigned'} ({Math.round(assignment.confidence * 100)}% fit)
                      <br />
                      <span>{assignment.reason}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default DashboardPage;
