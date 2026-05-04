import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AvailabilityStatus, ClubMemberRecord, UserRole, UserSession } from '../types';

interface RosterManagerProps {
  user: UserSession;
}

const getPermission = (roles: UserRole[]) => (roles.includes('admin') ? 'admin' : 'member');
const getRolesForPermission = (permission: 'member' | 'admin'): UserRole[] =>
  permission === 'admin' ? ['member', 'admin'] : ['member'];
const AVAILABILITY_OPTIONS: AvailabilityStatus[] = ['always', 'tentative', 'never', 'custom'];

const RosterManagerPage = ({ user }: RosterManagerProps) => {
  const { clubId = '' } = useParams();
  const membership = useMemo(
    () => user.memberships.find((entry) => entry.clubId === clubId) ?? null,
    [clubId, user.memberships],
  );
  const [clubName, setClubName] = useState(membership?.clubName ?? '');
  const [meetingDate, setMeetingDate] = useState('');
  const [roster, setRoster] = useState<ClubMemberRecord[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [overrideDateByMember, setOverrideDateByMember] = useState<Record<string, string>>({});
  const [overrideStatusByMember, setOverrideStatusByMember] = useState<Record<string, AvailabilityStatus>>({});
  const canManageRoster = membership?.roles.includes('admin') ?? false;
  const canEditAvailability = (member: ClubMemberRecord) =>
    canManageRoster || member.email.toLowerCase() === user.email.toLowerCase();

  useEffect(() => {
    const fetchRoster = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/clubs/${clubId}/roster`, {
          params: { email: user.email },
        });
        setClubName(response.data.club.name);
        setMeetingDate(response.data.club.meetingDate ?? '');
        setRoster(response.data.club.roster);
        setEditingMemberId(null);
      } catch (error: any) {
        setMessage(error?.response?.data?.error ?? 'Unable to load the club roster right now.');
      } finally {
        setLoading(false);
      }
    };

    fetchRoster();
  }, [clubId, user.email]);

  const updateMember = (index: number, field: 'name' | 'email', value: string) => {
    setRoster((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, [field]: value } : member,
      ),
    );
  };

  const updatePermission = (index: number, permission: 'member' | 'admin') => {
    setRoster((current) =>
      current.map((member, memberIndex) => {
        if (memberIndex !== index) {
          return member;
        }

        return {
          ...member,
          roles: getRolesForPermission(permission),
        };
      }),
    );
  };

  const updateBossScore = (index: number, bossScore: number) => {
    setRoster((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, bossScore } : member,
      ),
    );
  };

  const updateCalledOut = (index: number, calledOut: boolean) => {
    setRoster((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, calledOut } : member,
      ),
    );
  };

  const updateAvailabilityDefault = (index: number, availabilityDefault: AvailabilityStatus) => {
    setRoster((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, availabilityDefault } : member,
      ),
    );
  };

  const updateAvailabilityOverride = (index: number, meetingDate: string, status: AvailabilityStatus) => {
    setRoster((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index
          ? {
              ...member,
              availabilityOverrides: {
                ...(member.availabilityOverrides ?? {}),
                [meetingDate]: status,
              },
            }
          : member,
      ),
    );
  };

  const removeAvailabilityOverride = (index: number, meetingDate: string) => {
    setRoster((current) =>
      current.map((member, memberIndex) => {
        if (memberIndex !== index) {
          return member;
        }

        const nextOverrides = { ...(member.availabilityOverrides ?? {}) };
        delete nextOverrides[meetingDate];
        return {
          ...member,
          availabilityOverrides: nextOverrides,
        };
      }),
    );
  };

  const addAvailabilityOverride = (index: number, memberId: string) => {
    const meetingDate = overrideDateByMember[memberId];
    const status = overrideStatusByMember[memberId] ?? 'custom';
    if (!meetingDate) {
      return;
    }

    updateAvailabilityOverride(index, meetingDate, status);
    setOverrideDateByMember((current) => ({ ...current, [memberId]: '' }));
    setOverrideStatusByMember((current) => ({ ...current, [memberId]: 'custom' }));
  };

  const addMember = () => {
    const id = `member-${Date.now()}`;
    setRoster((current) => [
      ...current,
      {
        id,
        name: '',
        email: '',
        roles: ['member'],
        bossScore: 100,
        calledOut: false,
      },
    ]);
    setEditingMemberId(id);
  };

  const removeMember = (index: number) => {
    setRoster((current) => {
      const next = current.filter((_, memberIndex) => memberIndex !== index);
      if (current[index]?.id === editingMemberId) {
        setEditingMemberId(null);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiClient.put(`/clubs/${clubId}/roster`, {
        email: user.email,
        roster,
      });
      setRoster(response.data.club.roster);
      setMessage(response.data.message);
      setEditingMemberId(null);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save the roster right now.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvailabilitySave = async (member: ClubMemberRecord) => {
    setSaving(true);
    try {
      const response = await apiClient.put(`/clubs/${clubId}/availability`, {
        email: user.email,
        targetEmail: member.email,
        availabilityDefault: member.availabilityDefault ?? 'always',
        availabilityOverrides: member.availabilityOverrides ?? {},
      });
      setRoster(response.data.club.roster);
      setMessage(response.data.message);
      setEditingMemberId(null);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save availability right now.');
    } finally {
      setSaving(false);
    }
  };

  if (!membership) {
    return (
      <section className="toastboss-panel toastboss-setup-page">
        <h2>Roster manager unavailable</h2>
        <p>This account does not belong to that club.</p>
        <Link className="toastboss-text-link" to="/dashboard">
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <section className="toastboss-panel">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">Club roster</span>
        <h2>{clubName}</h2>
        <p>View scores, manage availability, update permissions, and mark who called out for {meetingDate || 'this meeting'}.</p>
      </div>

      {loading && <p>Loading roster...</p>}

      {!loading && (
        <div className="toastboss-roster-table-wrap">
          <table className="toastboss-roster-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Permission</th>
                <th scope="col">Score</th>
                <th scope="col">Called out</th>
                <th scope="col">Availability</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((member, index) => (
                <Fragment key={member.id}>
                  <tr>
                    <td>
                      {editingMemberId === member.id && canManageRoster ? (
                        <div className="toastboss-agenda-inline-field">
                          <label htmlFor={`member-name-${member.id}`}>Name</label>
                          <input
                            id={`member-name-${member.id}`}
                            type="text"
                            value={member.name}
                            onChange={(event) => updateMember(index, 'name', event.target.value)}
                          />
                        </div>
                      ) : (
                        member.name || 'Unnamed member'
                      )}
                    </td>
                    <td>
                      {editingMemberId === member.id && canManageRoster ? (
                        <div className="toastboss-agenda-inline-field">
                          <label htmlFor={`member-email-${member.id}`}>Email</label>
                          <input
                            id={`member-email-${member.id}`}
                            type="email"
                            value={member.email}
                            onChange={(event) => updateMember(index, 'email', event.target.value)}
                          />
                        </div>
                      ) : (
                        member.email || 'No email yet'
                      )}
                    </td>
                    <td>
                      {editingMemberId === member.id && canManageRoster ? (
                        <div className="toastboss-agenda-inline-field">
                          <label htmlFor={`member-permission-${member.id}`}>Permission</label>
                          <select
                            id={`member-permission-${member.id}`}
                            value={getPermission(member.roles)}
                            onChange={(event) =>
                              updatePermission(index, event.target.value as 'member' | 'admin')
                            }
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      ) : (
                        getPermission(member.roles) === 'admin' ? 'Admin' : 'Member'
                      )}
                    </td>
                    <td>
                      {editingMemberId === member.id && canManageRoster ? (
                        <div className="toastboss-agenda-inline-field">
                          <label htmlFor={`member-score-${member.id}`}>BossScore</label>
                          <input
                            id={`member-score-${member.id}`}
                            type="number"
                            min={0}
                            max={200}
                            value={member.bossScore ?? 100}
                            onChange={(event) => updateBossScore(index, Number(event.target.value) || 0)}
                          />
                        </div>
                      ) : (
                        member.bossScore ?? 100
                      )}
                    </td>
                    <td>
                      {editingMemberId === member.id && canManageRoster ? (
                        <div className="toastboss-agenda-inline-field toastboss-agenda-inline-field-checkbox">
                          <label htmlFor={`member-calledout-${member.id}`}>Called out</label>
                          <input
                            id={`member-calledout-${member.id}`}
                            type="checkbox"
                            checked={Boolean(member.calledOut)}
                            onChange={(event) => updateCalledOut(index, event.target.checked)}
                          />
                        </div>
                      ) : (
                        member.calledOut ? 'Yes' : 'No'
                      )}
                    </td>
                    <td>
                      {editingMemberId === member.id && canEditAvailability(member) ? (
                        <div className="toastboss-inline-edit-stack">
                          <div className="toastboss-agenda-inline-field">
                            <label htmlFor={`member-availability-default-${member.id}`}>Default</label>
                            <select
                              id={`member-availability-default-${member.id}`}
                              value={member.availabilityDefault ?? 'always'}
                              onChange={(event) => updateAvailabilityDefault(index, event.target.value as AvailabilityStatus)}
                            >
                              {AVAILABILITY_OPTIONS.map((status) => (
                                <option key={`${member.id}-${status}`} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="toastboss-agenda-inline-field">
                            <label htmlFor={`member-override-date-${member.id}`}>Add date override</label>
                            <input
                              id={`member-override-date-${member.id}`}
                              type="date"
                              value={overrideDateByMember[member.id] ?? ''}
                              onChange={(event) =>
                                setOverrideDateByMember((current) => ({ ...current, [member.id]: event.target.value }))
                              }
                            />
                          </div>
                          <div className="toastboss-agenda-inline-field">
                            <label htmlFor={`member-override-status-${member.id}`}>Override status</label>
                            <select
                              id={`member-override-status-${member.id}`}
                              value={overrideStatusByMember[member.id] ?? 'custom'}
                              onChange={(event) =>
                                setOverrideStatusByMember((current) => ({
                                  ...current,
                                  [member.id]: event.target.value as AvailabilityStatus,
                                }))
                              }
                            >
                              {AVAILABILITY_OPTIONS.map((status) => (
                                <option key={`${member.id}-override-${status}`} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button type="button" className="toastboss-ghost-button" onClick={() => addAvailabilityOverride(index, member.id)}>
                            Add override
                          </button>
                          <div className="toastboss-inline-edit-stack">
                            {Object.entries(member.availabilityOverrides ?? {}).map(([date, status]) => (
                              <div key={`${member.id}-${date}`} className="toastboss-inline-actions">
                                <span>{date}: {status}</span>
                                <button type="button" className="toastboss-ghost-button" onClick={() => removeAvailabilityOverride(index, date)}>
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div>Default: {member.availabilityDefault ?? 'always'}</div>
                          {Object.keys(member.availabilityOverrides ?? {}).length > 0 && (
                            <div>{Object.keys(member.availabilityOverrides ?? {}).length} date override(s)</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="toastboss-inline-actions">
                        {canEditAvailability(member) && (
                          <button
                            type="button"
                            className="toastboss-ghost-button"
                            onClick={() =>
                              setEditingMemberId((current) => (current === member.id ? null : member.id))
                            }
                          >
                            {editingMemberId === member.id ? 'Close' : 'Edit'}
                          </button>
                        )}
                        {canManageRoster && (
                          <button
                            type="button"
                            className="toastboss-ghost-button"
                            onClick={() => removeMember(index)}
                          >
                            Remove
                          </button>
                        )}
                        {editingMemberId === member.id && canEditAvailability(member) && !canManageRoster && (
                          <button type="button" className="toastboss-ghost-button" onClick={() => handleAvailabilitySave(member)}>
                            Save availability
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="toastboss-manager-actions">
        {canManageRoster && <button type="button" onClick={addMember}>Add member</button>}
        {canManageRoster && (
          <button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving roster...' : 'Save roster and permissions'}
          </button>
        )}
      </div>

      {message && <p className="toastboss-note">{message}</p>}

      <Link className="toastboss-text-link" to="/dashboard">
        Back to dashboard
      </Link>
    </section>
  );
};

export default RosterManagerPage;
