import { z } from 'zod';
import type { AgendaPriority, Assignment, FairnessMetric, Meeting, Member, RoleKey, ScheduleResult } from './types';

const bossScoreSchema = z.number().min(0).max(200);

export const calculateBossScore = (member: Member): number => {
  const baseScore = member.bossScore || 100;
  const trend = Math.max(0, Math.min(20, member.bossScore - 100));
  return bossScoreSchema.parse(baseScore + Math.round(trend / 2));
};

const getAvailabilityWeight = (member: Member, date: string): number => {
  const status = member.availability[date] ?? 'always';

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

const scoreCandidateForRole = (member: Member, role: RoleKey, meetingDate: string): number => {
  const rolePreferenceBoost = member.preferredRoles.includes(role) ? 8 : 0;
  return calculateBossScore(member) + rolePreferenceBoost + getAvailabilityWeight(member, meetingDate);
};

const priorityWeight: Record<AgendaPriority, number> = {
  high: 3,
  standard: 2,
  flexible: 1,
};

export const explainAssignment = (
  member: Member,
  role: RoleKey,
  meeting: Meeting,
): string => {
  const availability = member.availability[meeting.date] ?? 'always';
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
    const status = member.availability[meeting.date] ?? 'always';
    return status !== 'never';
  });
  const assignedMemberIds = new Set<string>();
  const roleQueue = [...meeting.roles].sort((left, right) => {
    const leftPriority = meeting.roleRequirements?.[left]?.priority ?? 'standard';
    const rightPriority = meeting.roleRequirements?.[right]?.priority ?? 'standard';
    return priorityWeight[rightPriority] - priorityWeight[leftPriority];
  });

  roleQueue.forEach((role) => {
    const minimumBossScore = meeting.roleRequirements?.[role]?.minBossScore ?? 0;
    const candidatePool = available
      .filter((member) => calculateBossScore(member) >= minimumBossScore)
      .sort((a, b) => {
      const aScore = scoreCandidateForRole(a, role, meeting.date);
      const bScore = scoreCandidateForRole(b, role, meeting.date);
      return bScore - aScore;
    });

    const assigned = candidatePool.find((member) => {
      const hasRoleRecently = pastAssignments.some(
        (assignment) => assignment.memberId === member.id && assignment.role === role,
      );
      return !hasRoleRecently && !assignedMemberIds.has(member.id);
    }) ?? candidatePool.find((member) => !assignedMemberIds.has(member.id));

    if (!assigned) {
      assignments.push({
        meetingId: meeting.id,
        memberId: null,
        memberName: null,
        role,
        confidence: 0,
        reason:
          minimumBossScore > 0
            ? `No eligible member met the minimum BossScore of ${minimumBossScore} for this role.`
            : 'No eligible member was available for this role.',
      });
      return;
    }

    assignedMemberIds.add(assigned.id);

    assignments.push({
      meetingId: meeting.id,
      memberId: assigned.id,
      memberName: assigned.name,
      role,
      confidence: Math.max(0.5, Math.min(1, scoreCandidateForRole(assigned, role, meeting.date) / 100)),
      reason: explainAssignment(assigned, role, meeting),
    });
  });

  const fairness = members.map((member) => {
    const roleFrequency = meeting.roles.reduce<Record<RoleKey, number>>((acc, role) => {
      acc[role] = pastAssignments.filter((assignment) => assignment.memberId === member.id && assignment.role === role).length;
      return acc;
    }, {} as Record<RoleKey, number>);

    return {
      memberId: member.id,
      roleFrequency,
      recentAssignments: pastAssignments
        .filter((assignment) => assignment.memberId === member.id)
        .slice(-4)
        .map((assignment) => assignment.role),
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
      const available = member.availability[date] ?? 'always';
      return available !== 'never';
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
      availability: z.record(z.string(), z.enum(['always', 'tentative', 'never', 'custom'])),
      preferredRoles: z.array(z.string()),
    }),
  ),
});
