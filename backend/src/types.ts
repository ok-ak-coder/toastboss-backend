export type RoleKey =
  | 'openingToast'
  | 'toastmaster'
  | 'improvmaster'
  | 'speaker'
  | 'evaluators'
  | 'topics'
  | 'generalEvaluator'
  | 'timer'
  | 'grammarians'
  | 'educationalMoment';

export type AvailabilityStatus = 'always' | 'tentative' | 'never' | 'custom';
export type UserRole = 'member' | 'admin';
export type AgendaPriority = 'high' | 'standard' | 'flexible';
export type AgendaEvaluatorMode = 'individual' | 'roundRobin';
export type AttendanceStatus = 'fulfilled' | 'tentativeNoShow' | 'noShow';

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
  bio?: string | null;
  profileImageUrl?: string | null;
  notificationPreferences: {
    emailReminders: boolean;
    swapAlerts: boolean;
  };
}

export interface ClubMemberRecord {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string | null;
  roles: UserRole[];
  eligibleRoles?: RoleKey[];
  bossScore?: number;
  calledOut?: boolean;
  bio?: string | null;
  profileImageUrl?: string | null;
  availabilityDefault?: AvailabilityStatus;
  availabilityOverrides?: Record<string, AvailabilityStatus>;
}

export interface AgendaItem {
  id: string;
  title: string;
  role: string;
  durationMinutes: number;
  notes?: string;
  minBossScore?: number;
  priority?: AgendaPriority;
  optional?: boolean;
  evaluatorMode?: AgendaEvaluatorMode;
  meetingMode?: 'all' | 'standard' | 'improv';
}

export interface MeetingRoleSlot {
  id: string;
  label: string;
  roleKey: RoleKey;
  order: number;
  pairingKey?: string;
  optional?: boolean;
  evaluatorMode?: AgendaEvaluatorMode;
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
  eligibleRoles: RoleKey[];
  availabilityDefault?: AvailabilityStatus;
  availability: Record<string, AvailabilityStatus>;
  preferredRoles: RoleKey[];
}

export interface AttendanceVerificationRecord {
  role: string;
  roleKey?: RoleKey;
  memberEmail: string | null;
  memberName?: string | null;
  status: AttendanceStatus;
  pointsDelta: number;
}

export interface Meeting {
  id: string;
  clubId: string;
  date: string;
  roles: RoleKey[];
  roleSlots?: MeetingRoleSlot[];
  roleRequirements?: Partial<Record<RoleKey, { minBossScore: number; priority: AgendaPriority }>>;
}

export interface Assignment {
  meetingId: string;
  meetingDate?: string;
  slotId?: string;
  memberId: string | null;
  memberEmail?: string | null;
  memberName?: string | null;
  role: string;
  roleKey?: RoleKey;
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
