const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, loadImportHandler } = require('./roster-role-test-helpers.cjs');
const api = load();
const plain = value => JSON.parse(JSON.stringify(value));
const csv = position => 'Name,Email,Current Position,Future Position\nFormer Officer,former@example.com,' + position + ',Club President';

test('blank current position revokes former officer title and permissions', () => {
  const [entry] = api.parseRosterEntries(csv(''));
  const state = api.getImportedOfficerState(entry, { currentPosition: 'Club President', roles: ['admin', 'member'] });
  assert.deepEqual(plain(state), { currentPosition: null, roles: ['member'] });
});
test('role switch replaces the old title rather than accumulating offices', () => {
  const [entry] = api.parseRosterEntries(csv('Club Secretary'));
  const state = api.getImportedOfficerState(entry, { currentPosition: 'Club President', roles: ['admin', 'member'] });
  assert.deepEqual(plain(state), { currentPosition: 'Club Secretary', roles: ['member'] });
});
test('future office does not grant current officer permissions', () => {
  const [entry] = api.parseRosterEntries(csv(''));
  assert.equal(entry.currentPosition, null);
  assert.deepEqual(plain(entry.roles), ['member']);
});
test('simple name/email import preserves officer data when the column is absent', () => {
  const [entry] = api.parseRosterEntries('Name,Email\nOfficer,officer@example.com');
  const state = api.getImportedOfficerState(entry, { currentPosition: 'Club President', roles: ['admin', 'member'] });
  assert.equal(state.currentPosition, 'Club President');
  assert.ok(state.roles.includes('admin'));
});
test('new president gets permissions without appearing in historical seed CSV', () => {
  const roles = api.parseOfficerRoles('Club President', 'New President', 'new@example.com');
  assert.ok(api.getEffectiveRolesForIdentity(roles, 'new@example.com', 'New President').includes('admin'));
});
test('ordinary former officer no longer has effective administrator access', () => {
  assert.deepEqual(plain(api.getEffectiveRolesForIdentity(['member'], 'former@example.com', 'Former Officer')), ['member']);
});
test('fixed administrator retains app access without a fabricated officer title', () => {
  const [entry] = api.parseRosterEntries('Name,Email,Current Position\nAvalon Korringa,nolavaavalon@gmail.com,');
  assert.equal(entry.currentPosition, null);
  assert.ok(api.getImportedOfficerState(entry).roles.includes('admin'));
});
test('quoted multiple positions and whitespace-only positions import correctly', () => {
  const entries = api.parseRosterEntries('Name,Email,Current Position\nOne,one@example.com,"Club VP Education,Club President"\nTwo,two@example.com,   ');
  assert.equal(entries[0].currentPosition, 'Club VP Education,Club President');
  assert.equal(entries[1].currentPosition, null);
});
test('database null positions stay null when the roster is read', async () => {
  const reader = load(['getClubRoster'], {
    pool: { query: async sql => sql.startsWith('SELECT id, name')
      ? { rowCount: 1, rows: [{ id: 'idtt', name: 'Club' }] }
      : { rows: [{ member_email: 'former@example.com', display_name: 'Former Officer', current_position: null, roles: ['member'] }] } },
    getMeetingDateForClub: async () => '2026-09-10',
    getAvailabilityDefaultsForClub: async () => new Map(),
    getAvailabilityOverridesForClub: async () => new Map(),
    parseEligibleRoles: () => [],
    getBundledRosterEntryByEmail: () => { throw new Error('Historical roster must not be consulted'); }
  });
  assert.equal((await reader.getClubRoster('idtt')).roster[0].currentPosition, null);
});
test('server startup does not reapply historical roles to an existing roster', async () => {
  const startup = load(['seedInitialData'], {
    sampleMeeting: { clubId: 'idtt' }, IDTT_CLUB_NAME: 'Club',
    upsertClub: async () => {}, defaultAgenda: () => [], applyRoundRobinEvaluatorDefault: async () => {},
    getClubRoster: async () => ({ roster: [{ name: 'Former Officer', currentPosition: null }] }),
    ensureDefaultMemberAccounts: async () => {},
    loadBundledRosterEntries: () => { throw new Error('Existing rosters must not load historical seed'); },
    syncRosterRoles: () => { throw new Error('Startup must not restore historical roles'); }
  });
  await startup.seedInitialData();
});

test('actual import handler persists replacement permissions and preserves member settings', async () => {
  const old = { id: 'stable-id', name: 'Former Officer', email: 'former@example.com',
    currentPosition: 'Club President', roles: ['admin', 'member'], bossScore: 127,
    availabilityDefault: 'custom', availabilityOverrides: { '2026-09-17': 'never' },
    eligibleRoles: ['speaker'] };
  let saved;
  let response;
  const handler = loadImportHandler({
    getClubRoster: async () => ({ id: 'idtt', name: 'Club', roster: [old] }),
    ensureAuthorizedMembership: async () => ({ account: { email: old.email, name: old.name }, membership: { roles: old.roles } }),
    allocateNextRosterId: async () => { throw new Error('Existing ID must be preserved'); },
    parseEligibleRoles: value => value || [],
    pool: { query: async () => ({}) },
    replaceRoster: async (clubId, name, roster) => { saved = roster; }
  });
  await handler({ params: { clubId: 'idtt' }, body: { email: old.email, rosterText: csv('') } },
    { json: value => { response = value; }, status: () => { throw new Error('Unexpected import error'); } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, old.id);
  assert.equal(saved[0].currentPosition, null);
  assert.deepEqual(plain(saved[0].roles), ['member']);
  assert.equal(saved[0].bossScore, 127);
  assert.deepEqual(plain(saved[0].availabilityOverrides), old.availabilityOverrides);
  assert.deepEqual(plain(saved[0].eligibleRoles), ['speaker']);
  assert.equal(response.warnings.length, 0);
});
