import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AgendaEvaluatorMode, AgendaItem, UserSession } from '../types';

interface AgendaEditorProps {
  user: UserSession;
}

type AgendaRoleOption =
  | 'toastmaster'
  | 'openingToast'
  | 'educationalMoment'
  | 'grammarian'
  | 'barroomTopics'
  | 'speaker'
  | 'speechEvaluator'
  | 'generalEvaluator'
  | 'timer'
  | 'other';

const ROLE_OPTIONS: Array<{ value: AgendaRoleOption; label: string }> = [
  { value: 'toastmaster', label: 'Toastmaster' },
  { value: 'openingToast', label: 'Opening Toast' },
  { value: 'educationalMoment', label: 'Educational Moment' },
  { value: 'grammarian', label: 'Grammarian' },
  { value: 'barroomTopics', label: 'Barroom Topics' },
  { value: 'speaker', label: 'Speaker' },
  { value: 'speechEvaluator', label: 'Speech Evaluator' },
  { value: 'generalEvaluator', label: 'General Evaluator' },
  { value: 'timer', label: 'Timer' },
  { value: 'other', label: 'Other' },
];

const roleLabelMap = new Map(ROLE_OPTIONS.map((option) => [option.value, option.label]));

const legacyRoleMap: Record<string, AgendaRoleOption> = {
  custom: 'other',
  toastmaster: 'toastmaster',
  openingtoast: 'openingToast',
  topics: 'barroomTopics',
  grammarians: 'grammarian',
  evaluators: 'speechEvaluator',
  educationalMoment: 'educationalMoment',
  generalEvaluator: 'generalEvaluator',
  speaker: 'speaker',
  timer: 'timer',
};

const normalizeAgendaRole = (role: string): AgendaRoleOption =>
  legacyRoleMap[role] ?? (ROLE_OPTIONS.some((option) => option.value === role) ? (role as AgendaRoleOption) : 'other');

const countExistingRole = (agenda: AgendaItem[], role: AgendaRoleOption, excludeId?: string) =>
  agenda.filter((item) => item.id !== excludeId && normalizeAgendaRole(item.role) === role).length;

const getDefaultScoreForRole = (agenda: AgendaItem[], role: AgendaRoleOption, excludeId?: string) => {
  const matchingRole = agenda.find(
    (item) => item.id !== excludeId && normalizeAgendaRole(item.role) === role,
  );

  return matchingRole?.minBossScore ?? 0;
};

const buildTitleForRole = (role: AgendaRoleOption, agenda: AgendaItem[], excludeId?: string) => {
  const existingCount = countExistingRole(agenda, role, excludeId);
  const baseLabel = roleLabelMap.get(role) ?? 'Other';

  if (role === 'speaker' || role === 'speechEvaluator') {
    return existingCount === 0 ? baseLabel : `${baseLabel} ${existingCount + 1}`;
  }

  if (role === 'other') {
    return 'Custom role';
  }

  return baseLabel;
};

const relabelSequentialRoles = (agenda: AgendaItem[]) => {
  const sequentialRoles: AgendaRoleOption[] = ['speaker', 'speechEvaluator'];

  return agenda.map((item) => ({ ...item })).map((item, _index, items) => {
    const normalizedRole = normalizeAgendaRole(item.role);
    if (!sequentialRoles.includes(normalizedRole)) {
      return item;
    }

    const matchingItems = items.filter((entry) => normalizeAgendaRole(entry.role) === normalizedRole);
    const baseLabel = roleLabelMap.get(normalizedRole) ?? item.title;

    if (matchingItems.length === 1) {
      return {
        ...item,
        title: baseLabel,
      };
    }

    const position = matchingItems.findIndex((entry) => entry.id === item.id);
    return {
      ...item,
      title: `${baseLabel} ${position + 1}`,
    };
  });
};

const createAgendaItem = (agenda: AgendaItem[]): AgendaItem => ({
  id: `agenda-${Date.now()}`,
  title: buildTitleForRole('speaker', agenda),
  role: 'speaker',
  durationMinutes: 5,
  notes: '',
  minBossScore: getDefaultScoreForRole(agenda, 'speaker'),
  priority: 'standard',
  optional: false,
  evaluatorMode: 'individual',
});

const AgendaEditorPage = ({ user }: AgendaEditorProps) => {
  const { clubId = '' } = useParams();
  const membership = useMemo(
    () => user.memberships.find((entry) => entry.clubId === clubId) ?? null,
    [clubId, user.memberships],
  );
  const canManageAgenda = membership?.roles.includes('admin') ?? false;
  const [clubName, setClubName] = useState(membership?.clubName ?? '');
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAgenda = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/clubs/${clubId}/agenda`, {
          params: { email: user.email },
        });
        setClubName(response.data.club.name);
        setAgenda(response.data.club.agenda);
      } catch (error: any) {
        setMessage(error?.response?.data?.error ?? 'Unable to load the club agenda right now.');
      } finally {
        setLoading(false);
      }
    };

    fetchAgenda();
  }, [clubId, user.email]);

  const updateItem = <K extends keyof AgendaItem>(index: number, field: K, value: AgendaItem[K]) => {
    setAgenda((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item,
      ),
    );
  };

  const updateRole = (index: number, nextRole: AgendaRoleOption) => {
    setAgenda((current) =>
      relabelSequentialRoles(current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        return {
          ...item,
          role: nextRole,
          title: buildTitleForRole(nextRole, current, item.id),
          minBossScore: getDefaultScoreForRole(current, nextRole, item.id),
          evaluatorMode: nextRole === 'speechEvaluator' ? (item.evaluatorMode ?? 'individual') : 'individual',
        };
      })),
    );
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    setAgenda((current) => {
      if (toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) {
        return current;
      }

      const reordered = [...current];
      const [movedItem] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, movedItem);

      return relabelSequentialRoles(reordered);
    });
  };

  const addItem = () => {
    const item = createAgendaItem(agenda);
    setAgenda((current) => relabelSequentialRoles([...current, item]));
    setEditingItemId(item.id);
  };

  const removeItem = (index: number) => {
    setAgenda((current) => relabelSequentialRoles(current.filter((_, itemIndex) => itemIndex !== index)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiClient.put(`/clubs/${clubId}/agenda`, {
        email: user.email,
        agenda,
      });
      setAgenda(response.data.club.agenda);
      setMessage(response.data.message);
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Unable to save the agenda right now.');
    } finally {
      setSaving(false);
    }
  };

  if (!membership || !canManageAgenda) {
    return (
      <section className="toastboss-panel toastboss-setup-page">
        <h2>Agenda editor unavailable</h2>
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
        <span className="toastboss-kicker">Meeting agenda</span>
        <h2>{clubName}</h2>
        <p>Add roles, put them in order, and use edit only when you need custom settings.</p>
      </div>

      {!loading && (
        <div className="toastboss-agenda-toolbar">
          <button type="button" onClick={addItem}>Add role</button>
        </div>
      )}

      {loading && <p>Loading agenda...</p>}

      {!loading && (
        <div className="toastboss-roster-table-wrap">
          <table className="toastboss-roster-table toastboss-agenda-compact-table">
            <thead>
              <tr>
                <th scope="col">Move</th>
                <th scope="col">#</th>
                <th scope="col">Role</th>
                <th scope="col">Min score</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agenda.map((item, index) => {
                const isEditing = editingItemId === item.id;
                const normalizedRole = normalizeAgendaRole(item.role);

                return (
                  <Fragment key={item.id}>
                    <tr
                      draggable
                      className={[
                        draggedIndex === index ? 'toastboss-dragging-row' : '',
                        dragOverIndex === index && draggedIndex !== index ? 'toastboss-drop-target-row' : '',
                      ].filter(Boolean).join(' ')}
                      onDragStart={() => setDraggedIndex(index)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (draggedIndex !== index) {
                          setDragOverIndex(index);
                        }
                      }}
                      onDrop={() => {
                        if (draggedIndex !== null) {
                          moveItem(draggedIndex, index);
                        }
                        setDraggedIndex(null);
                        setDragOverIndex(null);
                      }}
                      onDragLeave={() => {
                        if (dragOverIndex === index) {
                          setDragOverIndex(null);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedIndex(null);
                        setDragOverIndex(null);
                      }}
                    >
                      <td className="toastboss-move-cell">
                        <div className="toastboss-order-buttons" aria-label={`Move item ${index + 1}`}>
                          <span className="toastboss-drag-handle" aria-hidden="true">::</span>
                          <div className="toastboss-order-buttons-stack">
                            <button
                              type="button"
                              className="toastboss-ghost-button toastboss-arrow-button"
                              aria-label={`Move item ${index + 1} up`}
                              onClick={() => moveItem(index, index - 1)}
                            >
                              {'\u2191'}
                            </button>
                            <button
                              type="button"
                              className="toastboss-ghost-button toastboss-arrow-button"
                              aria-label={`Move item ${index + 1} down`}
                              onClick={() => moveItem(index, index + 1)}
                            >
                              {'\u2193'}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="toastboss-order-number-cell">{index + 1}</td>
                      <td>
                        {isEditing ? (
                          <div className="toastboss-inline-edit-stack">
                            <div className="toastboss-agenda-inline-field">
                              <label htmlFor={`agenda-role-${item.id}`}>Role</label>
                              <select
                                id={`agenda-role-${item.id}`}
                                value={normalizedRole}
                                onChange={(event) => updateRole(index, event.target.value as AgendaRoleOption)}
                              >
                                {ROLE_OPTIONS.map((option) => (
                                  <option key={`${item.id}-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {normalizedRole === 'other' && (
                              <div className="toastboss-agenda-inline-field">
                                <label htmlFor={`agenda-title-${item.id}`}>Custom label</label>
                                <input
                                  id={`agenda-title-${item.id}`}
                                  type="text"
                                  value={item.title}
                                  onChange={(event) => updateItem(index, 'title', event.target.value)}
                                />
                              </div>
                            )}
                            {normalizedRole === 'speechEvaluator' && (
                              <div className="toastboss-agenda-inline-field">
                                <label htmlFor={`agenda-evaluator-mode-${item.id}`}>Evaluation style</label>
                                <select
                                  id={`agenda-evaluator-mode-${item.id}`}
                                  value={item.evaluatorMode ?? 'individual'}
                                  onChange={(event) => updateItem(index, 'evaluatorMode', event.target.value as AgendaEvaluatorMode)}
                                >
                                  <option value="individual">Individual evaluator</option>
                                  <option value="roundRobin">Round Robin</option>
                                </select>
                              </div>
                            )}
                            <div className="toastboss-agenda-inline-field toastboss-agenda-inline-field-checkbox">
                              <label htmlFor={`agenda-optional-${item.id}`}>Optional role</label>
                              <input
                                id={`agenda-optional-${item.id}`}
                                type="checkbox"
                                checked={Boolean(item.optional)}
                                onChange={(event) => updateItem(index, 'optional', event.target.checked)}
                              />
                            </div>
                          </div>
                        ) : (
                          item.title
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div className="toastboss-agenda-inline-field">
                            <label htmlFor={`agenda-score-${item.id}`}>Minimum BossScore</label>
                            <input
                              id={`agenda-score-${item.id}`}
                              type="number"
                              min="0"
                              max="200"
                              placeholder="0"
                              value={item.minBossScore ? item.minBossScore : ''}
                              onChange={(event) => updateItem(index, 'minBossScore', event.target.value === '' ? 0 : Number(event.target.value))}
                            />
                          </div>
                        ) : (
                          item.minBossScore ?? 0
                        )}
                      </td>
                      <td>
                        <div className="toastboss-inline-actions">
                          <button
                            type="button"
                            className="toastboss-ghost-button"
                            onClick={() => setEditingItemId(isEditing ? null : item.id)}
                          >
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                          <button type="button" className="toastboss-ghost-button" onClick={() => removeItem(index)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="toastboss-manager-actions">
        <button type="button" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving agenda...' : 'Save agenda'}
        </button>
      </div>

      {message && <p className="toastboss-note">{message}</p>}

      <Link className="toastboss-text-link" to="/dashboard">
        Back to dashboard
      </Link>
    </section>
  );
};

export default AgendaEditorPage;
