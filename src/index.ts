import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { generateSchedule, explainAssignment, suggestSwapCandidates } from './engine';
import type { Meeting, Member } from './types';

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
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = sampleMembers.find((member) => member.email === email);
  if (!user) {
    return res.status(404).json({ error: 'No ToastBoss member was found for that email address.' });
  }

  return res.json({ user: { id: user.id, name: user.name, email: user.email, bossScore: user.bossScore } });
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

  return res.json({
    message: `ToastBoss setup started for ${clubName}. ${adminName} has been marked as the VPE admin and ${roster.length} roster emails were captured.`,
    club: {
      id: `club-${clubName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: clubName,
      admin: {
        name: adminName,
        email: adminEmail,
        role: 'vpe',
      },
      roster,
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
