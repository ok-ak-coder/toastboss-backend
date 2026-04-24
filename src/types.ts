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

export interface ClubMemberRecord {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
}

export interface AgendaItem {
  id: string;
  title: string;
  role: RoleKey | 'custom';
  durationMinutes: number;
  notes?: string;
}

export interface ClubRecord {
  id: string;
  name: string;
  roster: ClubMemberRecord[];
  agenda: AgendaItem[];
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
