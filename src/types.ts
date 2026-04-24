export type RoleKey =
  | 'toastmaster'
  | 'speaker'
  | 'evaluators'
  | 'topics'
  | 'generalEvaluator'
  | 'timer'
  | 'grammarians'
  | 'educationalMoment';

export type AvailabilityStatus = 'always' | 'tentative' | 'never' | 'custom';
export type UserRole = 'member' | 'vpe' | 'admin';

export interface ClubMembership {
  clubId: string;
  clubName: string;
  roles: UserRole[];
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  bossScore: number;
  setupComplete: boolean;
  memberships: ClubMembership[];
  password?: string;
  notificationPreferences: {
    emailReminders: boolean;
    swapAlerts: boolean;
  };
}

export interface Member {
  id: string;
  name: string;
  email: string;
  clubId: string;
  bossScore: number;
  availability: Record<string, AvailabilityStatus>;
  preferredRoles: RoleKey[];
}

export interface Meeting {
  id: string;
  clubId: string;
  date: string;
  roles: RoleKey[];
}

export interface Assignment {
  meetingId: string;
  memberId: string | null;
  memberName?: string | null;
  role: RoleKey;
  confidence: number;
  reason: string;
}

export interface FairnessMetric {
  memberId: string;
  roleFrequency: Record<RoleKey, number>;
  recentAssignments: RoleKey[];
}

export interface ScheduleResult {
  meetingId: string;
  assignments: Assignment[];
  fairness: FairnessMetric[];
}
