import { z } from 'zod';
import type { AgendaPriority, Assignment, FairnessMetric, Meeting, Member, RoleKey, ScheduleResult } from './types';

const bossScoreSchema = z.number().min(0).max(200);
type PairingPreference = 'ok' | 'not_ideal' | 'never';

export const calculateBossScore = (member: Member): number => {
  const baseScore = member.bossScore || 100;
  const trend = Math.max(0, Math.min(20, member.bossScore - 100));
  return bossScoreSchema.parse(baseScore + Math.round(trend / 2));
};

const getAvailabilityWeight = (member: Member, date: string): number => {
  const status = member.availability[date] ?? member.availabilityDefault ?? 'always';

  if (status === 'never') {
    return -1000;
  }

  if (status === 'tentative') {
    return -18;
  }

  if (status === 'custom') {
    return -8;
  }

  return 0;
};

const scoreCandidateForRole = (member: Member, role: RoleKey, meetingDate: string, notIdealCount = 0): number => {
  const rolePreferenceBoost = member.preferredRoles.includes(role) ? 8 : 0;
  return calculateBossScore(member) + rolePreferenceBoost + getAvailabilityWeight(member, meetingDate) - (notIdealCount * 12);
};

const priorityWeight: Record<AgendaPriority, number> = {
  high: 3,
  standard: 2,
  flexible: 1,
};

const minorRoles = new Set<RoleKey>(['openingToast', 'grammarians', 'educationalMoment', 'timer']);
const isMinorRole = (role: RoleKey) => minorRoles.has(role);

const isEligibleForRole = (member: Member, role: RoleKey) =>
  member.eligibleRoles.length === 0 || member.eligibleRoles.includes(role);

const normalizedPair = (left: string, right: string) => [left, right].sort().join('|');
const pairCompatibility = new Map<string, PairingPreference>([
  [normalizedPair('toastmaster', 'openingToast'), 'not_ideal'],
  [normalizedPair('toastmaster', 'educationalMoment'), 'not_ideal'],
  [normalizedPair('toastmaster', 'grammarians'), 'not_ideal'],
  [normalizedPair('toastmaster', 'topics'), 'never'],
  [normalizedPair('toastmaster', 'speaker1'), 'never'],
  [normalizedPair('toastmaster', 'speaker2'), 'never'],
  [normalizedPair('toastmaster', 'generalEvaluator'), 'never'],
  [normalizedPair('toastmaster', 'evaluators1'), 'never'],
  [normalizedPair('toastmaster', 'evaluators2'), 'never'],
  [normalizedPair('toastmaster', 'timer'), 'never'],

  [normalizedPair('openingToast', 'educationalMoment'), 'ok'],
  [normalizedPair('openingToast', 'grammarians'), 'ok'],
  [normalizedPair('openingToast', 'topics'), 'ok'],
  [normalizedPair('openingToast', 'speaker1'), 'ok'],
  [normalizedPair('openingToast', 'speaker2'), 'ok'],
  [normalizedPair('openingToast', 'generalEvaluator'), 'ok'],
  [normalizedPair('openingToast', 'evaluators1'), 'ok'],
  [normalizedPair('openingToast', 'evaluators2'), 'ok'],
  [normalizedPair('openingToast', 'timer'), 'ok'],

  [normalizedPair('educationalMoment', 'grammarians'), 'ok'],
  [normalizedPair('educationalMoment', 'topics'), 'ok'],
  [normalizedPair('educationalMoment', 'speaker1'), 'ok'],
  [normalizedPair('educationalMoment', 'speaker2'), 'ok'],
  [normalizedPair('educationalMoment', 'generalEvaluator'), 'ok'],
  [normalizedPair('educationalMoment', 'evaluators1'), 'ok'],
  [normalizedPair('educationalMoment', 'evaluators2'), 'ok'],
  [normalizedPair('educationalMoment', 'timer'), 'ok'],

  [normalizedPair('grammarians', 'topics'), 'ok'],
  [normalizedPair('grammarians', 'speaker1'), 'ok'],
  [normalizedPair('grammarians', 'speaker2'), 'ok'],
  [normalizedPair('grammarians', 'generalEvaluator'), 'ok'],
  [normalizedPair('grammarians', 'evaluators1'), 'ok'],
  [normalizedPair('grammarians', 'evaluators2'), 'ok'],
  [normalizedPair('grammarians', 'timer'), 'ok'],

  [normalizedPair('topics', 'speaker1'), 'never'],
  [normalizedPair('topics', 'speaker2'), 'never'],
  [normalizedPair('topics', 'generalEvaluator'), 'never'],
  [normalizedPair('topics', 'evaluators1'), 'ok'],
  [normalizedPair('topics', 'evaluators2'), 'ok'],
  [normalizedPair('topics', 'timer'), 'never'],

  [normalizedPair('speaker1', 'speaker2'), 'never'],
  [normalizedPair('speaker1', 'generalEvaluator'), 'never'],
  [normalizedPair('speaker1', 'evaluators1'), 'never'],
  [normalizedPair('speaker1', 'evaluators2'), 'ok'],
  [normalizedPair('speaker1', 'timer'), 'not_ideal'],

  [normalizedPair('speaker2', 'generalEvaluator'), 'never'],
  [normalizedPair('speaker2', 'evaluators1'), 'ok'],
  [normalizedPair('speaker2', 'evaluators2'), 'never'],
  [normalizedPair('speaker2', 'timer'), 'not_ideal'],

  [normalizedPair('generalEvaluator', 'evaluators1'), 'never'],
  [normalizedPair('generalEvaluator', 'evaluators2'), 'never'],
  [normalizedPair('generalEvaluator', 'timer'), 'not_ideal'],

  [normalizedPair('evaluators1', 'evaluators2'), 'not_ideal'],
  [normalizedPair('evaluators1', 'timer'), 'not_ideal'],
  [normalizedPair('evaluators2', 'timer'), 'not_ideal'],
]);

const getPairingKey = (role: RoleKey, slotId?: string) => {
  if (slotId) {
    const normalized = slotId.toLowerCase();
    if (normalized.includes('agenda-1')) return 'openingToast';
    if (normalized.includes('agenda-2')) return 'toastmaster';
    if (normalized.includes('agenda-3')) return 'educationalMoment';
    if (normalized.includes('agenda-4')) return 'grammarians';
    if (normalized.includes('agenda-5')) return 'topics';
    if (normalized.includes('agenda-6')) return 'speaker1';
    if (normalized.includes('agenda-7')) return 'speaker2';
    if (normalized.includes('agenda-8')) return 'generalEvaluator';
    if (normalized.includes('agenda-9')) return 'evaluators1';
    if (normalized.includes('agenda-10')) return 'evaluators2';
    if (normalized.includes('agenda-11')) return 'timer';
  }

  switch (role) {
    case 'openingToast':
      return 'openingToast';
    case 'toastmaster':
      return 'toastmaster';
    case 'educationalMoment':
      return 'educationalMoment';
    case 'grammarians':
      return 'grammarians';
    case 'topics':
      return 'topics';
    case 'generalEvaluator':
      return 'generalEvaluator';
    case 'timer':
      return 'timer';
    case 'speaker':
      return 'speaker1';
    case 'evaluators':
      return 'evaluators1';
    default:
      return role;
  }
};

const getPairPreference = (left: string, right: string): PairingPreference =>
  pairCompatibility.get(normalizedPair(left, right)) ?? 'ok';

export const explainAssignment = (
  member: Member,
  role: RoleKey,
  meeting: Meeting,
): string => {
  const availability = member.availability[meeting.date] ?? member.availabilityDefault ?? 'always';
  const requirement = meeting.roleRequirements?.[role];
  const reasons = [
    `Availability status: ${availability}`,
    `Your BossScore is ${calculateBossScore(member)}`,
    requirement?.minBossScore
      ? `Minimum BossScore for ${role} is ${requirement.minBossScore}`
      : null,
    member.preferredRoles.includes(role)
      ? `${role} is one of your preferred roles`
      : `You have not held ${role} recently`,
  ].filter(Boolean);
  return reasons.join('. ') + '.';
};

export const generateSchedule = (
  meeting: Meeting,
  members: Member[],
  pastAssignments: Assignment[] = [],
): ScheduleResult => {
  const assignments: Assignment[] = [];
  const available = members.filter((member) => {
    const status = member.availability[meeting.date] ?? member.availabilityDefault ?? 'always';
    return status !== 'never';
  });
  const roleSlots = meeting.roleSlots ?? meeting.roles.map((role, index) => ({
    id: `${meeting.id}-${role}-${index}`,
    label: role,
    roleKey: role,
    order: index,
    pairingKey: `${role}-${index}`,
    optional: false,
    evaluatorMode: 'individual' as const,
  }));
  const roleQueue = [...roleSlots].sort((left, right) => {
    const leftPriority = meeting.roleRequirements?.[left.roleKey]?.priority ?? 'standard';
    const rightPriority = meeting.roleRequirements?.[right.roleKey]?.priority ?? 'standard';
    return priorityWeight[rightPriority] - priorityWeight[leftPriority];
  });

  roleQueue.forEach((slot) => {
    if (slot.evaluatorMode === 'roundRobin') {
      assignments.push({
        meetingId: meeting.id,
        slotId: slot.id,
        memberId: null,
        memberEmail: null,
        memberName: 'Round Robin',
        role: slot.label,
        roleKey: slot.roleKey,
        confidence: 1,
        reason: 'Speech evaluation will be handled as a round robin instead of assigning one evaluator.',
      });
      return;
    }

    const slotIsMinor = isMinorRole(slot.roleKey);
    const minimumBossScore = meeting.roleRequirements?.[slot.roleKey]?.minBossScore ?? 0;
    const candidatePool = available
      .filter((member) => {
        const status = member.availability[meeting.date] ?? member.availabilityDefault ?? 'always';
        if (!slotIsMinor && status === 'tentative') {
          return false;
        }

        if (calculateBossScore(member) < minimumBossScore) {
          return false;
        }

        if (!isEligibleForRole(member, slot.roleKey)) {
          return false;
        }

        const memberAssignedRoles = assignments
          .filter((assignment) => assignment.memberId === member.id)
          .map((assignment) => ({
            roleKey: assignment.roleKey,
            pairingKey: assignment.roleKey ? getPairingKey(assignment.roleKey, assignment.slotId) : null,
          }))
          .filter((assignment) => Boolean(assignment.pairingKey)) as Array<{ roleKey?: RoleKey; pairingKey: string }>;

        if (memberAssignedRoles.length >= 2) {
          return false;
        }

        const slotPairingKey = slot.pairingKey ?? getPairingKey(slot.roleKey, slot.id);
        return memberAssignedRoles.every(
          (assignedRole) => getPairPreference(slotPairingKey, assignedRole.pairingKey) !== 'never',
        );
      })
      .sort((a, b) => {
      const slotPairingKey = slot.pairingKey ?? getPairingKey(slot.roleKey, slot.id);
      const getNotIdealCount = (member: Member) =>
        assignments
          .filter((assignment) => assignment.memberId === member.id && assignment.roleKey)
          .reduce((count, assignment) => {
            const assignedPairingKey = getPairingKey(assignment.roleKey as RoleKey, assignment.slotId);
            return count + (getPairPreference(slotPairingKey, assignedPairingKey) === 'not_ideal' ? 1 : 0);
          }, 0);
      const aScore = scoreCandidateForRole(a, slot.roleKey, meeting.date, getNotIdealCount(a));
      const bScore = scoreCandidateForRole(b, slot.roleKey, meeting.date, getNotIdealCount(b));
      return bScore - aScore;
    });

    const assigned = candidatePool.find((member) => {
      const hasRoleRecently = pastAssignments.some(
        (assignment) =>
          assignment.memberId === member.id &&
          ((assignment.roleKey ?? assignment.role) as RoleKey) === slot.roleKey,
      );
      return !hasRoleRecently;
    }) ?? candidatePool[0];

    if (!assigned) {
      assignments.push({
        meetingId: meeting.id,
        slotId: slot.id,
        memberId: null,
        memberEmail: null,
        memberName: null,
        role: slot.label,
        roleKey: slot.roleKey,
        confidence: slot.optional ? 1 : 0,
        reason:
          slot.optional
            ? 'This optional role was left unassigned because no eligible member was available.'
            : minimumBossScore > 0
              ? `No eligible member met the minimum BossScore of ${minimumBossScore} for this role.`
              : 'No eligible member was available for this role.',
      });
      return;
    }

    assignments.push({
      meetingId: meeting.id,
      slotId: slot.id,
      memberId: assigned.id,
      memberEmail: assigned.email,
      memberName: assigned.name,
      role: slot.label,
      roleKey: slot.roleKey,
      confidence: Math.max(0.5, Math.min(1, scoreCandidateForRole(assigned, slot.roleKey, meeting.date) / 100)),
      reason: explainAssignment(assigned, slot.roleKey, meeting),
    });
  });

  const fairness = members.map((member) => {
    const roleFrequency = meeting.roles.reduce<Record<RoleKey, number>>((acc, role) => {
      acc[role] = pastAssignments.filter(
        (assignment) =>
          assignment.memberId === member.id &&
          ((assignment.roleKey ?? assignment.role) as RoleKey) === role,
      ).length;
      return acc;
    }, {} as Record<RoleKey, number>);

    return {
      memberId: member.id,
      roleFrequency,
      recentAssignments: pastAssignments
        .filter((assignment) => assignment.memberId === member.id)
        .slice(-4)
        .map((assignment) => (assignment.roleKey ?? assignment.role) as RoleKey),
    };
  });

  return { meetingId: meeting.id, assignments, fairness };
};

export const suggestSwapCandidates = (
  role: RoleKey,
  members: Member[],
  date: string,
): Member[] => {
  return members
    .filter((member) => {
      const available = member.availability[date] ?? member.availabilityDefault ?? 'always';
      return available !== 'never' && isEligibleForRole(member, role);
    })
    .sort((a, b) => scoreCandidateForRole(b, role, date) - scoreCandidateForRole(a, role, date))
    .slice(0, 3);
};

export const validateAvailability = z.object({
  memberId: z.string(),
  date: z.string(),
  status: z.enum(['always', 'tentative', 'never', 'custom']),
});

export const sampleEngineInput = z.object({
  meeting: z.object({
    id: z.string(),
    clubId: z.string(),
    date: z.string(),
    roles: z.array(z.string()),
  }),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      clubId: z.string(),
      bossScore: z.number(),
      eligibleRoles: z.array(z.string()),
      availability: z.record(z.string(), z.enum(['always', 'tentative', 'never', 'custom'])),
      preferredRoles: z.array(z.string()),
    }),
  ),
});
