import { z } from 'zod';
import type { AgendaPriority, Assignment, FairnessMetric, Meeting, Member, RoleKey, ScheduleResult } from './types';

type PairingPreference = 'ok' | 'not_ideal' | 'never';

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

const scoreCandidateForRole = (member: Member, meetingDate: string, notIdealCount = 0) =>
  50 + getAvailabilityWeight(member, meetingDate) - (notIdealCount * 12);

const priorityWeight: Record<AgendaPriority, number> = {
  high: 3,
  standard: 2,
  flexible: 1,
};

const minorRoles = new Set<RoleKey>(['openingToast', 'grammarians', 'educationalMoment', 'timer']);
const isMinorRole = (role: RoleKey) => minorRoles.has(role);
const roleFamilyCooldowns = new Map<string, number>([
  ['toastmaster', 2],
  ['speaker', 2],
  ['topics', 2],
  ['generalEvaluator', 2],
  ['evaluators', 2],
  ['improvmaster', 2],
  ['educationalMoment', 2],
  ['grammarians', 2],
  ['openingToast', 2],
  ['timer', 2],
]);

// For these role families, members who have never held the role get
// absolute priority over those who have — everyone cycles through once
// before anyone repeats.
const roundRobinFirstFamilies = new Set<string>(['toastmaster', 'speaker', 'topics']);

const isEligibleForRole = (member: Member, role: RoleKey) =>
  member.eligibleRoles.length === 0 || member.eligibleRoles.includes(role);

const normalizedPair = (left: string, right: string) => [left, right].sort().join('|');
const pairCompatibility = new Map<string, PairingPreference>([
  [normalizedPair('toastmaster', 'openingToast'), 'not_ideal'],
  [normalizedPair('toastmaster', 'educationalMoment'), 'not_ideal'],
  [normalizedPair('toastmaster', 'grammarians'), 'not_ideal'],
  [normalizedPair('toastmaster', 'topics'), 'never'],
  [normalizedPair('toastmaster', 'improvmaster1'), 'never'],
  [normalizedPair('toastmaster', 'improvmaster2'), 'never'],
  [normalizedPair('toastmaster', 'speaker1'), 'never'],
  [normalizedPair('toastmaster', 'speaker2'), 'never'],
  [normalizedPair('toastmaster', 'generalEvaluator'), 'never'],
  [normalizedPair('toastmaster', 'evaluators1'), 'never'],
  [normalizedPair('toastmaster', 'evaluators2'), 'never'],
  [normalizedPair('toastmaster', 'timer'), 'never'],

  [normalizedPair('openingToast', 'educationalMoment'), 'ok'],
  [normalizedPair('openingToast', 'grammarians'), 'ok'],
  [normalizedPair('openingToast', 'topics'), 'ok'],
  [normalizedPair('openingToast', 'improvmaster1'), 'ok'],
  [normalizedPair('openingToast', 'improvmaster2'), 'ok'],
  [normalizedPair('openingToast', 'speaker1'), 'ok'],
  [normalizedPair('openingToast', 'speaker2'), 'ok'],
  [normalizedPair('openingToast', 'generalEvaluator'), 'ok'],
  [normalizedPair('openingToast', 'evaluators1'), 'ok'],
  [normalizedPair('openingToast', 'evaluators2'), 'ok'],
  [normalizedPair('openingToast', 'timer'), 'ok'],

  [normalizedPair('educationalMoment', 'grammarians'), 'ok'],
  [normalizedPair('educationalMoment', 'topics'), 'ok'],
  [normalizedPair('educationalMoment', 'improvmaster1'), 'ok'],
  [normalizedPair('educationalMoment', 'improvmaster2'), 'ok'],
  [normalizedPair('educationalMoment', 'speaker1'), 'ok'],
  [normalizedPair('educationalMoment', 'speaker2'), 'ok'],
  [normalizedPair('educationalMoment', 'generalEvaluator'), 'ok'],
  [normalizedPair('educationalMoment', 'evaluators1'), 'ok'],
  [normalizedPair('educationalMoment', 'evaluators2'), 'ok'],
  [normalizedPair('educationalMoment', 'timer'), 'ok'],

  [normalizedPair('grammarians', 'topics'), 'ok'],
  [normalizedPair('grammarians', 'improvmaster1'), 'ok'],
  [normalizedPair('grammarians', 'improvmaster2'), 'ok'],
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

  [normalizedPair('improvmaster1', 'improvmaster2'), 'never'],
  [normalizedPair('improvmaster1', 'generalEvaluator'), 'never'],
  [normalizedPair('improvmaster1', 'timer'), 'not_ideal'],
  [normalizedPair('improvmaster2', 'generalEvaluator'), 'never'],
  [normalizedPair('improvmaster2', 'timer'), 'not_ideal'],

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
    if (normalized.includes('agenda-12')) return 'improvmaster1';
    if (normalized.includes('agenda-13')) return 'improvmaster2';
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
    case 'improvmaster':
      return 'improvmaster1';
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

const getRoleFamily = (role: RoleKey, slotId?: string) => {
  const pairingKey = getPairingKey(role, slotId);
  if (pairingKey.startsWith('speaker')) {
    return 'speaker';
  }

  if (pairingKey.startsWith('evaluators')) {
    return 'evaluators';
  }

  if (pairingKey.startsWith('improvmaster')) {
    return 'improvmaster';
  }

  return pairingKey;
};

const getOrderedMeetingDates = (assignments: Assignment[]) => {
  const seen = new Set<string>();
  const dates: string[] = [];

  for (const assignment of assignments) {
    if (!assignment.meetingDate || seen.has(assignment.meetingDate)) {
      continue;
    }

    seen.add(assignment.meetingDate);
    dates.push(assignment.meetingDate);
  }

  return dates;
};

const getRecentMeetingDates = (assignments: Assignment[], meetingCount: number) =>
  getOrderedMeetingDates(assignments).slice(-meetingCount);

const getRoleFamilyCount = (memberId: string, roleFamily: string, assignments: Assignment[]) =>
  assignments.filter(
    (assignment) =>
      assignment.memberId === memberId &&
      assignment.roleKey &&
      getRoleFamily(assignment.roleKey, assignment.slotId) === roleFamily,
  ).length;

const getRecentMeetingLoad = (memberId: string, assignments: Assignment[], meetingCount: number) => {
  const recentMeetingDates = new Set(getRecentMeetingDates(assignments, meetingCount));
  if (recentMeetingDates.size === 0) {
    return 0;
  }

  const memberMeetingDates = new Set(
    assignments
      .filter((assignment) => assignment.memberId === memberId && assignment.meetingDate && recentMeetingDates.has(assignment.meetingDate))
      .map((assignment) => assignment.meetingDate as string),
  );

  return memberMeetingDates.size;
};

const violatesRoleFamilyCooldown = (
  memberId: string,
  roleFamily: string,
  assignments: Assignment[],
) => {
  const cooldownMeetings = roleFamilyCooldowns.get(roleFamily);
  if (!cooldownMeetings) {
    return false;
  }

  const orderedMeetingDates = getOrderedMeetingDates(assignments);
  if (orderedMeetingDates.length === 0) {
    return false;
  }

  const lastRoleMeetingDate = [...assignments]
    .reverse()
    .find(
      (assignment) =>
        assignment.memberId === memberId &&
        assignment.roleKey &&
        getRoleFamily(assignment.roleKey, assignment.slotId) === roleFamily &&
        assignment.meetingDate,
    )?.meetingDate;

  if (!lastRoleMeetingDate) {
    return false;
  }

  const lastRoleMeetingIndex = orderedMeetingDates.lastIndexOf(lastRoleMeetingDate);
  if (lastRoleMeetingIndex === -1) {
    return false;
  }

  const meetingsSinceLastRole = orderedMeetingDates.length - lastRoleMeetingIndex - 1;
  return meetingsSinceLastRole < cooldownMeetings;
};

const pickWeightedRandomCandidate = <T extends { finalScore: number }>(candidates: T[]) => {
  if (candidates.length === 0) {
    return undefined;
  }

  const bestScore = candidates[0].finalScore;
  const topBand = candidates.filter((candidate) => candidate.finalScore >= bestScore - 18);
  const floorScore = Math.min(...topBand.map((candidate) => candidate.finalScore));
  const weightedCandidates = topBand.map((candidate) => ({
    candidate,
    weight: Math.max(1, candidate.finalScore - floorScore + 4),
  }));
  const totalWeight = weightedCandidates.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const entry of weightedCandidates) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.candidate;
    }
  }

  return weightedCandidates[weightedCandidates.length - 1]?.candidate;
};

export const explainAssignment = (
  member: Member,
  role: RoleKey,
  meeting: Meeting,
): string => {
  const availability = member.availability[meeting.date] ?? member.availabilityDefault ?? 'always';
  const reasons = [
    `Availability status: ${availability}`,
    `You are eligible for ${role}`,
    `You have not held ${role} recently`,
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
        meetingDate: meeting.date,
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
    const slotPairingKey = slot.pairingKey ?? getPairingKey(slot.roleKey, slot.id);
    const slotRoleFamily = getRoleFamily(slot.roleKey, slot.id);

    const baseFilter = (member: Member, ignoreCooldown = false) => {
      const status = member.availability[meeting.date] ?? member.availabilityDefault ?? 'always';
      if (!slotIsMinor && status === 'tentative') {
        return false;
      }
      if (!isEligibleForRole(member, slot.roleKey)) {
        return false;
      }
      if (!ignoreCooldown && violatesRoleFamilyCooldown(member.id, slotRoleFamily, pastAssignments)) {
        return false;
      }
      return true;
    };

    // Try with cooldowns enforced; fall back to ignoring them if the pool
    // would otherwise be empty (small club exception).
    const poolWithCooldown = available.filter((m) => baseFilter(m));
    const candidatePool = (poolWithCooldown.length > 0 ? poolWithCooldown : available.filter((m) => baseFilter(m, true)))
      .filter((member) => {

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

        return memberAssignedRoles.every(
          (assignedRole) => getPairPreference(slotPairingKey, assignedRole.pairingKey) !== 'never',
        );
      })
      ;

    const scoredCandidates = candidatePool
      .map((member) => {
        const notIdealCount = assignments
          .filter((assignment) => assignment.memberId === member.id && assignment.roleKey)
          .reduce((count, assignment) => {
            const assignedPairingKey = getPairingKey(assignment.roleKey as RoleKey, assignment.slotId);
            return count + (getPairPreference(slotPairingKey, assignedPairingKey) === 'not_ideal' ? 1 : 0);
          }, 0);

        const roleFamilyCount = getRoleFamilyCount(member.id, slotRoleFamily, pastAssignments);
        const recentMeetingLoad = getRecentMeetingLoad(member.id, pastAssignments, 2);
        const exactRoleCount = pastAssignments.filter(
          (assignment) =>
            assignment.memberId === member.id &&
            ((assignment.roleKey ?? assignment.role) as RoleKey) === slot.roleKey,
        ).length;

        return {
          member,
          notIdealCount,
          baseScore: scoreCandidateForRole(member, meeting.date, notIdealCount),
          roleFamilyCount,
          recentMeetingLoad,
          exactRoleCount,
        };
      });

    // For prestige roles, restrict the pool to members who haven't held this
    // role family yet. Only fall back to the full pool once everyone has.
    const untriedCandidates = roundRobinFirstFamilies.has(slotRoleFamily)
      ? scoredCandidates.filter((c) => c.roleFamilyCount === 0)
      : [];
    const rankingPool = untriedCandidates.length > 0 ? untriedCandidates : scoredCandidates;

    const lowestRoleFamilyCount = rankingPool.length > 0
      ? Math.min(...rankingPool.map((candidate) => candidate.roleFamilyCount))
      : 0;
    const lowestRecentMeetingLoad = rankingPool.length > 0
      ? Math.min(...rankingPool.map((candidate) => candidate.recentMeetingLoad))
      : 0;
    const lowestExactRoleCount = rankingPool.length > 0
      ? Math.min(...rankingPool.map((candidate) => candidate.exactRoleCount))
      : 0;

    const rankedCandidates = rankingPool
      .map((candidate) => ({
        ...candidate,
        finalScore:
          candidate.baseScore +
          ((candidate.roleFamilyCount === lowestRoleFamilyCount ? 1 : 0) * 14) +
          ((candidate.exactRoleCount === lowestExactRoleCount ? 1 : 0) * 10) +
          ((candidate.recentMeetingLoad === lowestRecentMeetingLoad ? 1 : 0) * 6) -
          (candidate.roleFamilyCount * 6) -
          (candidate.exactRoleCount * 4) -
          (candidate.recentMeetingLoad * 5),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    const assignedCandidate = pickWeightedRandomCandidate(rankedCandidates);
    const assigned = assignedCandidate?.member;

    if (!assigned) {
      assignments.push({
        meetingId: meeting.id,
        meetingDate: meeting.date,
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
            : 'No eligible member was available for this role.',
      });
      return;
    }

    assignments.push({
      meetingId: meeting.id,
      meetingDate: meeting.date,
      slotId: slot.id,
      memberId: assigned.id,
      memberEmail: assigned.email,
      memberName: assigned.name,
      role: slot.label,
      roleKey: slot.roleKey,
      confidence: 0.85,
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
    .sort((a, b) => {
      const availabilityDelta = getAvailabilityWeight(b, date) - getAvailabilityWeight(a, date);
      if (availabilityDelta !== 0) {
        return availabilityDelta;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, 3);
};

export const validateAvailability = z.object({
  memberId: z.string(),
  date: z.string(),
  status: z.enum(['always', 'tentative', 'never', 'custom']),
});

