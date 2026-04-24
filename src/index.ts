import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { generateSchedule, explainAssignment, suggestSwapCandidates } from './engine';
import type { ClubMembership, Meeting, Member, UserAccount, UserRole } from './types';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const sampleMembers: Member[] = [
  {
    id: 'm1',
    name: 'Avery Silva',
    email: 'avery@example.com',
    clubId: 'club-1',
    bossScore: 108,
    availability: {},
    preferredRoles: ['toastmaster', 'speaker', 'timer'],
  },
  {
    id: 'm2',
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    clubId: 'club-1',
    bossScore: 92,
    availability: { '2026-05-08': 'tentative' },
    preferredRoles: ['grammarians', 'educationalMoment', 'timer'],
  },
  {
    id: 'm3',
    name: 'Taylor Park',
    email: 'taylor@example.com',
    clubId: 'club-1',
    bossScore: 110,
    availability: {},
    preferredRoles: ['speaker', 'generalEvaluator', 'topics'],
  },
];

const sampleMeeting: Meeting = {
  id: 'meeting-1',
  clubId: 'club-1',
  date: '2026-05-08',
  roles: ['toastmaster', 'speaker', 'generalEvaluator', 'topics', 'timer', 'grammarians', 'educationalMoment'],
};

const sampleClubNames: Record<string, string> = {
  'club-1': 'Sample Toastmasters Club',
};

const accounts = new Map<string, UserAccount>();

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const ensureAccount = (
  email: string,
  name: string,
  membership: ClubMembership,
  options?: { setupComplete?: boolean; password?: string },
): UserAccount => {
  const existing = accounts.get(email);

  if (!existing) {
    const account: UserAccount = {
      id: `acct-${slugify(email)}`,
      name,
      email,
      bossScore: 100,
      setupComplete: options?.setupComplete ?? false,
      memberships: [membership],
      password: options?.password,
      notificationPreferences: {
        emailReminders: true,
        swapAlerts: true,
      },
    };
    accounts.set(email, account);
    return account;
  }

  existing.name = name || existing.name;
  existing.setupComplete = options?.setupComplete ?? existing.setupComplete;
  existing.password = options?.password ?? existing.password;

  const existingMembership = existing.memberships.find((entry) => entry.clubId === membership.clubId);
  if (!existingMembership) {
    existing.memberships.push(membership);
  } else {
    existingMembership.clubName = membership.clubName;
    existingMembership.roles = Array.from(new Set([...existingMembership.roles, ...membership.roles]));
  }

  return existing;
};

sampleMembers.forEach((member) => {
  ensureAccount(
    member.email,
    member.name,
    {
      clubId: member.clubId,
      clubName: sampleClubNames[member.clubId] ?? 'Toastmasters Club',
      roles: ['member'],
    },
    { setupComplete: false },
  );
});

const parseRosterEntries = (rosterText: string) => {
  return rosterText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const columns = line.split(',').map((column) => column.trim()).filter(Boolean);
      const email = columns.find((column) => /\S+@\S+\.\S+/.test(column)) ?? '';
      const nameColumns = columns.filter((column) => column !== email);
      const name = nameColumns.join(' ') || `Member ${index + 1}`;

      return {
        id: `roster-${index + 1}`,
        name,
        email,
      };
    })
    .filter((entry) => entry.email);
};

const sanitizeUserForResponse = (account: UserAccount) => ({
  id: account.id,
  name: account.name,
  email: account.email,
  bossScore: account.bossScore,
  setupComplete: account.setupComplete,
  memberships: account.memberships,
  notificationPreferences: account.notificationPreferences,
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ToastBoss backend' });
});

app.post('/api/auth/magic-link', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  return res.json({ message: `Magic link sent to ${email}`, email });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const account = accounts.get(email);
  if (account) {
    if (!account.setupComplete) {
      return res.status(409).json({
        error: 'This account still needs to finish setup before signing in.',
        redirectTo: '/activate-account',
        account: sanitizeUserForResponse(account),
      });
    }

    if (account.password && password !== account.password) {
      return res.status(401).json({ error: 'Incorrect password for this ToastBoss account.' });
    }

    return res.json({ user: sanitizeUserForResponse(account) });
  }

  const member = sampleMembers.find((entry) => entry.email === email);
  if (!member) {
    return res.status(404).json({ error: 'No ToastBoss member was found for that email address.' });
  }

  const fallbackMembership: ClubMembership = {
    clubId: member.clubId,
    clubName: sampleClubNames[member.clubId] ?? 'Toastmasters Club',
    roles: ['member'],
  };

  return res.json({
    user: {
      id: member.id,
      name: member.name,
      email: member.email,
      bossScore: member.bossScore,
      setupComplete: false,
      memberships: [fallbackMembership],
      notificationPreferences: {
        emailReminders: true,
        swapAlerts: true,
      },
    },
  });
});

app.post('/api/auth/complete-setup', (req, res) => {
  const { email, password, name, emailReminders, swapAlerts } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required to finish account setup.' });
  }

  const account = accounts.get(email);
  if (!account) {
    return res.status(404).json({ error: 'No pending ToastBoss account was found for that email.' });
  }

  account.name = name || account.name;
  account.password = password;
  account.setupComplete = true;
  account.notificationPreferences = {
    emailReminders: emailReminders !== false,
    swapAlerts: swapAlerts !== false,
  };

  return res.json({
    message: `Account setup complete for ${account.name}.`,
    user: sanitizeUserForResponse(account),
  });
});

app.post('/api/clubs/setup', (req, res) => {
  const { adminName, clubName, adminEmail, rosterText } = req.body;

  if (!adminName || !clubName || !adminEmail || !rosterText) {
    return res.status(400).json({ error: 'VPE name, club name, admin email, and roster are required.' });
  }

  const roster = parseRosterEntries(rosterText);
  if (roster.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one valid roster email.' });
  }

  const clubId = `club-${slugify(clubName)}`;
  const adminMembership: ClubMembership = {
    clubId,
    clubName,
    roles: ['member', 'vpe'],
  };

  const adminAccount = ensureAccount(adminEmail, adminName, adminMembership, { setupComplete: false });

  roster.forEach((entry) => {
    const roles: UserRole[] = entry.email === adminEmail ? ['member', 'vpe'] : ['member'];
    ensureAccount(entry.email, entry.name, { clubId, clubName, roles }, { setupComplete: entry.email === adminEmail ? adminAccount.setupComplete : false });
  });

  return res.json({
    message: `ToastBoss setup started for ${clubName}. ${adminName} can now finish account setup, and ${roster.length} roster emails were captured.`,
    redirectTo: '/activate-account',
    user: sanitizeUserForResponse(adminAccount),
    club: {
      id: clubId,
      name: clubName,
      admin: {
        name: adminName,
        email: adminEmail,
        roles: adminMembership.roles,
      },
      rosterCount: roster.length,
    },
  });
});

app.get('/api/engine/schedule', (_req, res) => {
  const schedule = generateSchedule(sampleMeeting, sampleMembers);
  return res.json(schedule);
});

app.get('/api/engine/explain', (_req, res) => {
  const member = sampleMembers[0];
  const explanation = explainAssignment(member, 'toastmaster', sampleMeeting);
  return res.json({ explanation });
});

app.get('/api/engine/swap-candidates', (_req, res) => {
  const candidates = suggestSwapCandidates('timer', sampleMembers, sampleMeeting.date);
  return res.json({ candidates });
});

app.listen(PORT, () => {
  console.log(`ToastBoss backend listening on http://localhost:${PORT}`);
});
