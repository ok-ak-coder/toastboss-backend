import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AttendanceStatus, UserSession } from '../types';

interface AttendanceVerifierProps {
  user: UserSession;
}

interface AttendanceAssignment {
  role: string;
  roleKey?: string;
  memberEmail: string | null;
  memberName?: string | null;
  availabilityStatus?: string;
  verification?: {
    memberEmail: string | null;
    status: AttendanceStatus;
    pointsDelta: number;
  } | null;
}

const AttendanceVerifierPage = ({ user }: AttendanceVerifierProps) => {
  const { clubId = '' } = useParams();
  const membership = useMemo(
    () => user.memberships.find((entry) => entry.clubId === clubId) ?? null,
    [clubId, user.memberships],
  );
  const [meetingDate, setMeetingDate] = useState('');
  const [availableMeetingDates, setAvailableMeetingDates] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<AttendanceAssignment[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const fetchAttendance = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/clubs/${clubId}/attendance`, {
          params: {
            email: user.email,
            ...(meetingDate ? { meetingDate } : {}),
          },
        });
        setMeetingDate(response.data.meetingDate);
        setAvailableMeetingDates(response.data.availableMeetingDates ?? []);
        setAssignments(response.data.assignments);
        setStatuses(
          Object.fromEntries(
            response.data.assignments.map((assignment: AttendanceAssignment) => [
              assignment.role,
              assignment.verification?.status ?? 'fulfilled',
            ]),
          ),
        );
      } catch (error: any) {
        setMessage(error?.response?.data?.error ?? 'Unable to load attendance verification.');
      } finally {
        setLoading(false);
      }
    };

    fetchAttendance();
  }, [clubId, meetingDate, refreshToken, user.email]);

  const handleSeedHistory = async () => {
    setSeeding(true);
    setMessage('');
    try {
      const response = await apiClient.post(`/clubs/${clubId}/attendance/seed`, {
        email: user.email,
      });
      setMessage(response.data.message ?? 'Created test attendance history.');
      setRefreshToken((current) => current + 1);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to create test attendance history.');
    } finally {
      setSeeding(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/clubs/${clubId}/attendance`, {
        email: user.email,
        meetingDate,
        records: assignments
          .filter((assignment) => assignment.memberEmail)
          .map((assignment) => ({
            role: assignment.role,
            roleKey: assignment.roleKey,
            memberEmail: assignment.memberEmail,
            memberName: assignment.memberName,
            status: statuses[assignment.role] ?? 'fulfilled',
            availabilityStatus: assignment.availabilityStatus,
          })),
      });
      setMessage(`Attendance saved for ${meetingDate}.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save attendance verification.');
    } finally {
      setSaving(false);
    }
  };

  if (!membership || !membership.roles.includes('admin')) {
    return (
      <section className="toastboss-panel toastboss-setup-page">
        <h2>Attendance verifier unavailable</h2>
        <p>This account does not have admin access for that club.</p>
        <Link className="toastboss-text-link" to="/dashboard">
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <section className="toastboss-panel">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">Attendance</span>
        <h2>{membership.clubName}</h2>
        <p>Verify who fulfilled their roles for {meetingDate || 'this meeting'}.</p>
      </div>

      <div className="toastboss-manager-actions">
        <button type="button" className="toastboss-secondary-button" onClick={handleSeedHistory} disabled={seeding || loading}>
          {seeding ? 'Creating test history...' : 'Create test month'}
        </button>
      </div>

      {!loading && availableMeetingDates.length > 0 && (
        <div className="toastboss-role-switcher">
          <label htmlFor="attendance-meeting-date">Meeting date</label>
          <select
            id="attendance-meeting-date"
            value={meetingDate}
            onChange={(event) => setMeetingDate(event.target.value)}
          >
            {availableMeetingDates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && <p>Loading attendance...</p>}

      {!loading && (
        <div className="toastboss-roster-table-wrap">
          <table className="toastboss-roster-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Assigned to</th>
                <th scope="col">Availability</th>
                <th scope="col">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.role}>
                  <td>{assignment.role}</td>
                  <td>{assignment.memberName ?? assignment.memberEmail ?? 'Unassigned'}</td>
                  <td>{assignment.availabilityStatus ?? 'always'}</td>
                  <td>
                    {assignment.memberEmail ? (
                      <select
                        value={statuses[assignment.role] ?? 'fulfilled'}
                        onChange={(event) =>
                          setStatuses((current) => ({
                            ...current,
                            [assignment.role]: event.target.value as AttendanceStatus,
                          }))
                        }
                      >
                        <option value="fulfilled">Fulfilled role</option>
                        <option value="tentativeNoShow">Tentative no-show</option>
                        <option value="noShow">No-show</option>
                      </select>
                    ) : (
                      'N/A'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="toastboss-manager-actions">
        <button type="button" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving attendance...' : 'Save attendance'}
        </button>
      </div>

      {message && <p className="toastboss-note">{message}</p>}

      <Link className="toastboss-text-link" to="/dashboard">
        Back to dashboard
      </Link>
    </section>
  );
};

export default AttendanceVerifierPage;
