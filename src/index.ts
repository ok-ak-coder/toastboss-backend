import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { generateSchedule, explainAssignment, suggestSwapCandidates } from './engine';
import { pool, runMigrations } from './db';
import type {
  AgendaItem,
  ClubMembership,
  ClubMemberRecord,
  Meeting,
  Member,
  RoleKey,
  UserAccount,
  UserRole,
} from './types';

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

const defaultAgenda = (): AgendaItem[] => [
  { id: 'agenda-1', title: 'Opening', role: 'custom', durationMinutes: 5, notes: 'Welcome and introductions' },
  { id: 'agenda-2', title: 'Toastmaster', role: 'toastmaster', durationMinutes: 10 },
  { id: 'agenda-3', title: 'Table Topics', role: 'topics', durationMinutes: 15 },
  { id: 'agenda-4', title: 'Prepared Speaker', role: 'speaker', durationMinutes: 12 },
  { id: 'agenda-5', title: 'General Evaluation', role: 'generalEvaluator', durationMinutes: 10 },
];

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const deriveDisplayNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Club Admin';

const parseRoles = (value: unknown): UserRole[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is UserRole => typeof entry === 'string');
};

const parseAgenda = (value: unknown): AgendaItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const record = item as Partial<AgendaItem>;
    return {
      id: record.id || `agenda-${index + 1}`,
      title: record.title || `Agenda item ${index + 1}`,
      role: (record.role as RoleKey | 'custom') || 'custom',
      durationMinutes: Number(record.durationMinutes) || 0,
      notes: record.notes ?? '',
    };
  });
};

const parsePreferences = (value: unknown) => {
  const record = (value as { emailReminders?: boolean; swapAlerts?: boolean } | null) ?? {};
  return {
    emailReminders: record.emailReminders !== false,
    swapAlerts: record.swapAlerts !== false,
  };
};

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

const upsertAccount = async (
  email: string,
  name: string,
  options?: {
    setupComplete?: boolean;
    password?: string | null;
    bossScore?: number;
    notificationPreferences?: { emailReminders: boolean; swapAlerts: boolean };
  },
) => {
  const id = `acct-${slugify(email)}`;
  const bossScore = options?.bossScore ?? 100;
  const setupComplete = options?.setupComplete ?? false;
  const password = options?.password ?? null;
  const preferences = options?.notificationPreferences ?? {
    emailReminders: true,
    swapAlerts: true,
  };

  await pool.query(
    `
      INSERT INTO accounts (email, id, name, boss_score, setup_complete, password, notification_preferences)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        boss_score = COALESCE(accounts.boss_score, EXCLUDED.boss_score),
        setup_complete = EXCLUDED.setup_complete,
        password = COALESCE(EXCLUDED.password, accounts.password),
        notification_preferences = EXCLUDED.notification_preferences
    `,
    [email, id, name, bossScore, setupComplete, password, JSON.stringify(preferences)],
  );
};

const upsertClub = async (clubId: string, clubName: string, agenda?: AgendaItem[]) => {
  await pool.query(
    `
      INSERT INTO clubs (id, name, agenda)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        agenda = COALESCE(clubs.agenda, EXCLUDED.agenda)
    `,
    [clubId, clubName, JSON.stringify(agenda ?? defaultAgenda())],
  );
};

const upsertMembership = async (email: string, membership: ClubMembership) => {
  await pool.query(
    `
      INSERT INTO memberships (account_email, club_id, roles)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (account_email, club_id)
      DO UPDATE SET roles = EXCLUDED.roles
    `,
    [email, membership.clubId, JSON.stringify(membership.roles)],
  );
};

const replaceRoster = async (clubId: string, clubName: string, roster: ClubMemberRecord[]) => {
  await pool.query('DELETE FROM roster WHERE club_id = $1', [clubId]);

  for (const member of roster) {
    await pool.query(
      `
        INSERT INTO roster (club_id, member_email, member_id, name, roles)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [clubId, member.email, member.id, member.name, JSON.stringify(member.roles)],
    );

    await upsertAccount(member.email, member.name, {
      setupComplete: false,
      password: null,
    });

    await upsertMembership(member.email, {
      clubId,
      clubName,
      roles: member.roles,
    });
  }
};

const getAccountByEmail = async (email: string): Promise<UserAccount | null> => {
  const accountResult = await pool.query(
    `
      SELECT email, id, name, boss_score, setup_complete, password, notification_preferences
      FROM accounts
      WHERE email = $1
    `,
    [email],
  );

  if (accountResult.rowCount === 0) {
    return null;
  }

  const accountRow = accountResult.rows[0];
  const membershipResult = await pool.query(
    `
      SELECT memberships.club_id, clubs.name AS club_name, memberships.roles
      FROM memberships
      INNER JOIN clubs ON clubs.id = memberships.club_id
      WHERE memberships.account_email = $1
      ORDER BY clubs.name ASC
    `,
    [email],
  );

  const memberships: ClubMembership[] = membershipResult.rows.map((row: any) => ({
    clubId: row.club_id as string,
    clubName: row.club_name as string,
    roles: parseRoles(row.roles),
  }));

  return {
    id: accountRow.id as string,
    name: accountRow.name as string,
    email: accountRow.email as string,
    bossScore: Number(accountRow.boss_score),
    setupComplete: Boolean(accountRow.setup_complete),
    memberships,
    password: (accountRow.password as string | null) ?? undefined,
    notificationPreferences: parsePreferences(accountRow.notification_preferences),
  };
};

const getClubRoster = async (clubId: string): Promise<{ id: string; name: string; roster: ClubMemberRecord[] } | null> => {
  const clubResult = await pool.query('SELECT id, name FROM clubs WHERE id = $1', [clubId]);
  if (clubResult.rowCount === 0) {
    return null;
  }

  const rosterResult = await pool.query(
    `
      SELECT member_id, name, member_email, roles
      FROM roster
      WHERE club_id = $1
      ORDER BY name ASC
    `,
    [clubId],
  );

  return {
    id: clubResult.rows[0].id as string,
    name: clubResult.rows[0].name as string,
    roster: rosterResult.rows.map((row: any) => ({
      id: row.member_id as string,
      name: row.name as string,
      email: row.member_email as string,
      roles: parseRoles(row.roles),
    })),
  };
};

const getClubAgenda = async (clubId: string): Promise<{ id: string; name: string; agenda: AgendaItem[] } | null> => {
  const clubResult = await pool.query('SELECT id, name, agenda FROM clubs WHERE id = $1', [clubId]);
  if (clubResult.rowCount === 0) {
    return null;
  }

  return {
    id: clubResult.rows[0].id as string,
    name: clubResult.rows[0].name as string,
    agenda: parseAgenda(clubResult.rows[0].agenda),
  };
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

const ensureAuthorizedMembership = async (email: string | undefined, clubId: string, allowedRoles: UserRole[]) => {
  if (!email) {
    return { error: 'User email is required for this action.', status: 400 as const };
  }

  const account = await getAccountByEmail(email);
  if (!account) {
    return { error: 'No ToastBoss account was found for that email.', status: 404 as const };
  }

  const membership = account.memberships.find((entry) => entry.clubId === clubId);
  if (!membership) {
    return { error: 'This account does not belong to that club.', status: 403 as const };
  }

  if (!allowedRoles.some((role) => membership.roles.includes(role))) {
    return { error: 'This account does not have permission for that action.', status: 403 as const };
  }

  return { account, membership };
};

const seedInitialData = async () => {
  await upsertClub(sampleMeeting.clubId, 'Sample Toastmasters Club', defaultAgenda());

  for (const member of sampleMembers) {
    await upsertAccount(member.email, member.name, {
      setupComplete: false,
      bossScore: member.bossScore,
      password: null,
    });

    await upsertMembership(member.email, {
      clubId: member.clubId,
      clubName: 'Sample Toastmasters Club',
      roles: ['member'],
    });
  }

  await replaceRoster(sampleMeeting.clubId, 'Sample Toastmasters Club', sampleMembers.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    roles: ['member'],
  })));
};

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

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const account = await getAccountByEmail(email);
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

  return res.status(404).json({ error: 'No ToastBoss member was found for that email address.' });
});

app.post('/api/auth/complete-setup', async (req, res) => {
  const { email, password, name, emailReminders, swapAlerts } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required to finish account setup.' });
  }

  const account = await getAccountByEmail(email);
  if (!account) {
    return res.status(404).json({ error: 'No pending ToastBoss account was found for that email.' });
  }

  await upsertAccount(email, name || account.name, {
    setupComplete: true,
    bossScore: account.bossScore,
    password,
    notificationPreferences: {
      emailReminders: emailReminders !== false,
      swapAlerts: swapAlerts !== false,
    },
  });

  const updatedAccount = await getAccountByEmail(email);
  return res.json({
    message: `Account setup complete for ${updatedAccount?.name ?? account.name}.`,
    user: sanitizeUserForResponse(updatedAccount ?? account),
  });
});

app.post('/api/clubs/setup', async (req, res) => {
  const { clubName, adminEmail, password } = req.body;

  if (!clubName || !adminEmail || !password) {
    return res.status(400).json({ error: 'Club name, admin email, and password are required.' });
  }

  const clubId = `club-${slugify(clubName)}`;
  const adminName = deriveDisplayNameFromEmail(adminEmail);
  const adminRoles: UserRole[] = ['member', 'admin'];

  await upsertClub(clubId, clubName, defaultAgenda());
  await upsertAccount(adminEmail, adminName, {
    setupComplete: true,
    password,
  });
  await upsertMembership(adminEmail, {
    clubId,
    clubName,
    roles: adminRoles,
  });
  await replaceRoster(clubId, clubName, [
    {
      id: `acct-${slugify(adminEmail)}`,
      name: adminName,
      email: adminEmail,
      roles: adminRoles,
    },
  ]);

  const adminAccount = await getAccountByEmail(adminEmail);

  return res.json({
    message: `${clubName} is ready. Your admin account has been created and you can upload your roster from the dashboard.`,
    user: sanitizeUserForResponse(adminAccount as UserAccount),
    club: {
      id: clubId,
      name: clubName,
      admin: {
        name: adminName,
        email: adminEmail,
        roles: adminRoles,
      },
      rosterCount: 1,
    },
  });
});

app.get('/api/clubs/:clubId/roster', async (req, res) => {
  const { clubId } = req.params;
  const club = await getClubRoster(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(req.query.email as string | undefined, clubId, ['member', 'vpe', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  return res.json({ club });
});

app.put('/api/clubs/:clubId/roster', async (req, res) => {
  const { clubId } = req.params;
  const { email, roster } = req.body as { email?: string; roster?: ClubMemberRecord[] };
  const club = await getClubRoster(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['vpe', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!Array.isArray(roster) || roster.length === 0) {
    return res.status(400).json({ error: 'Updated roster data is required.' });
  }

  const normalizedRoster = roster.map((member, index) => ({
    id: member.id || `roster-${index + 1}`,
    name: member.name,
    email: member.email,
    roles: parseRoles(member.roles),
  }));

  await pool.query('DELETE FROM memberships WHERE club_id = $1', [clubId]);
  await replaceRoster(clubId, club.name, normalizedRoster);

  return res.json({
    message: `Roster updated for ${club.name}.`,
    club: await getClubRoster(clubId),
  });
});

app.post('/api/clubs/:clubId/roster/import', async (req, res) => {
  const { clubId } = req.params;
  const { email, rosterText } = req.body as { email?: string; rosterText?: string };
  const club = await getClubRoster(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['vpe', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!rosterText?.trim()) {
    return res.status(400).json({ error: 'Roster CSV text is required.' });
  }

  const rosterEntries = parseRosterEntries(rosterText);
  if (rosterEntries.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one valid roster email.' });
  }

  const existingRosterByEmail = new Map(
    club.roster.map((member) => [member.email.toLowerCase(), member]),
  );

  const normalizedRoster: ClubMemberRecord[] = rosterEntries.map((entry, index) => {
    const existing = existingRosterByEmail.get(entry.email.toLowerCase());
    return {
      id: existing?.id || entry.id || `roster-${index + 1}`,
      name: entry.name,
      email: entry.email,
      roles: existing?.roles ?? ['member'],
    };
  });

  if (!normalizedRoster.some((member) => member.email.toLowerCase() === auth.account.email.toLowerCase())) {
    normalizedRoster.unshift({
      id: auth.account.id,
      name: auth.account.name,
      email: auth.account.email,
      roles: auth.membership.roles,
    });
  }

  await pool.query('DELETE FROM memberships WHERE club_id = $1', [clubId]);
  await replaceRoster(clubId, club.name, normalizedRoster);

  return res.json({
    message: `Roster imported for ${club.name}. ${normalizedRoster.length} members are now on the club roster.`,
    club: await getClubRoster(clubId),
  });
});

app.get('/api/clubs/:clubId/agenda', async (req, res) => {
  const { clubId } = req.params;
  const club = await getClubAgenda(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(req.query.email as string | undefined, clubId, ['member', 'vpe', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  return res.json({ club });
});

app.put('/api/clubs/:clubId/agenda', async (req, res) => {
  const { clubId } = req.params;
  const { email, agenda } = req.body as { email?: string; agenda?: AgendaItem[] };
  const club = await getClubAgenda(clubId);

  if (!club) {
    return res.status(404).json({ error: 'Club not found.' });
  }

  const auth = await ensureAuthorizedMembership(email, clubId, ['vpe', 'admin']);
  if ('error' in auth) {
    return res.status(auth.status ?? 403).json({ error: auth.error });
  }

  if (!Array.isArray(agenda) || agenda.length === 0) {
    return res.status(400).json({ error: 'Updated agenda items are required.' });
  }

  const normalizedAgenda = agenda.map((item, index) => ({
    id: item.id || `agenda-${index + 1}`,
    title: item.title,
    role: item.role as RoleKey | 'custom',
    durationMinutes: Number(item.durationMinutes) || 0,
    notes: item.notes ?? '',
  }));

  await pool.query('UPDATE clubs SET agenda = $2::jsonb WHERE id = $1', [clubId, JSON.stringify(normalizedAgenda)]);

  return res.json({
    message: `Agenda updated for ${club.name}.`,
    club: await getClubAgenda(clubId),
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

const start = async () => {
  await runMigrations();
  await seedInitialData();

  app.listen(PORT, () => {
    console.log(`ToastBoss backend listening on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error('ToastBoss backend failed to start', error);
  process.exit(1);
});
