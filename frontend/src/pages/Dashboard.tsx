import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
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
  const [scheduleClubId, setScheduleClubId] = useState<string>(() => user.memberships[0]?.clubId ?? '');
  const [activeRoleByClub, setActiveRoleByClub] = useState<Record<string, UserRole>>(() =>
    Object.fromEntries(
      user.memberships.map((membership) => [
        membership.clubId,
        membership.roles.includes('admin') ? 'admin' : 'member',
      ]),
    ),
  );

  const managementMemberships = useMemo(() => {
    return user.memberships.filter(
      (membership) => membership.roles.includes('admin') && activeRoleByClub[membership.clubId] === 'admin',
    );
  }, [activeRoleByClub, user.memberships]);
  const activeMembership = useMemo(
    () => user.memberships.find((membership) => membership.clubId === scheduleClubId) ?? user.memberships[0] ?? null,
    [scheduleClubId, user.memberships],
  );
  const hasMultipleMemberships = user.memberships.length > 1;

  const handleRoleSwitch = (clubId: string, role: UserRole) => {
    setActiveRoleByClub((current) => ({
      ...current,
      [clubId]: role,
    }));
  };

  useEffect(() => {
    const fetchSchedule = async () => {
      if (!scheduleClubId) {
        setSchedule(null);
        setLoading(false);
        setNote('Join or create a club to generate a schedule.');
        return;
      }

      setLoading(true);
      try {
        const response = await apiClient.get<ScheduleResponse>('/engine/schedule', {
          params: {
            clubId: scheduleClubId,
            email: user.email,
          },
        });
        setSchedule(response.data);
        setNote(`Generated from the current ${response.data.clubName} roster.`);
      } catch (error) {
        setNote('Unable to load schedule. Please check connectivity.');
      } finally {
        setLoading(false);
      }
    };

    fetchSchedule();
  }, [scheduleClubId, user.email]);

  return (
    <section className="toastboss-panel">
      <div className="toastboss-intro">
        <h2>Your ToastBoss Dashboard</h2>
        <p>{note}</p>
        <div className="toastboss-meta">
          <span>Signed in as {user.name} ({user.email})</span>
        </div>
        {!hasMultipleMemberships && activeMembership && (
          <div className="toastboss-meta">
            <span>{activeMembership.clubName}</span>
          </div>
        )}
        {hasMultipleMemberships && (
          <div className="toastboss-role-switcher">
            <label htmlFor="schedule-club">Generate schedule for</label>
            <select
              id="schedule-club"
              value={scheduleClubId}
              onChange={(event) => setScheduleClubId(event.target.value)}
            >
              {user.memberships.map((membership) => (
                <option key={`schedule-${membership.clubId}`} value={membership.clubId}>
                  {membership.clubName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {activeMembership && (
        <div className="toastboss-dashboard-controls">
          <div className="toastboss-role-switcher">
            <label htmlFor={`club-role-${activeMembership.clubId}`}>
              {hasMultipleMemberships ? `${activeMembership.clubName} role` : 'Role'}
            </label>
            <select
              id={`club-role-${activeMembership.clubId}`}
              value={activeRoleByClub[activeMembership.clubId] ?? 'member'}
              onChange={(event) => handleRoleSwitch(activeMembership.clubId, event.target.value as UserRole)}
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

      {managementMemberships.length > 0 && (
        <section className="toastboss-admin-section">
          <div className="toastboss-section-copy">
            <span className="toastboss-kicker">Admin tools</span>
            <h3>Club management</h3>
            <p>Open the two management screens for each club you manage.</p>
          </div>

          <div className="toastboss-admin-grid">
            {managementMemberships.map((membership) => (
              <article key={membership.clubId} className="toastboss-admin-card">
                <div className="toastboss-admin-card-header">
                  <h3>{membership.clubName}</h3>
                  <span>Viewing as {formatRoleLabel(activeRoleByClub[membership.clubId] ?? 'member')}</span>
                </div>

                <div className="toastboss-admin-links">
                  <Link className="toastboss-secondary-cta" to={`/clubs/${membership.clubId}/roster`}>
                    View/Edit roster
                  </Link>
                  <Link className="toastboss-secondary-cta toastboss-secondary-cta-alt" to={`/clubs/${membership.clubId}/agenda`}>
                    View/Edit agenda
                  </Link>
                  <Link className="toastboss-secondary-cta" to={`/clubs/${membership.clubId}/attendance`}>
                    Verify attendance
                  </Link>
                </div>
              </article>
            ))}
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
