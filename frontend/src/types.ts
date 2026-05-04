export type UserRole = 'member' | 'admin';
export type AgendaPriority = 'high' | 'standard' | 'flexible';
export type AgendaEvaluatorMode = 'individual' | 'roundRobin';
export type AvailabilityStatus = 'always' | 'tentative' | 'never' | 'custom';
export type AttendanceStatus = 'fulfilled' | 'tentativeNoShow' | 'noShow';

export interface ClubMembership {
  clubId: string;
  clubName: string;
  roles: UserRole[];
}

export interface NotificationPreferences {
  emailReminders: boolean;
  swapAlerts: boolean;
}

export interface UserSession {
  id: string;
  name: string;
  email: string;
  bossScore?: number;
  setupComplete: boolean;
  memberships: ClubMembership[];
  notificationPreferences: NotificationPreferences;
}

export interface ClubMemberRecord {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  bossScore?: number;
  calledOut?: boolean;
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
}

export interface AttendanceVerificationRecord {
  role: string;
  roleKey?: string;
  memberEmail: string | null;
  memberName?: string | null;
  status: AttendanceStatus;
  pointsDelta: number;
}
