// Load selected real backend functions without starting Express, running
// migrations, or connecting to a database. TypeScript AST selects declarations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const text = fs.readFileSync(path.join(__dirname, '../backend/src/index.ts'), 'utf8');
const source = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true);
const names = ['FIXED_ADMIN_EMAILS', 'FIXED_ADMIN_NAMES', 'normalizeIdentityName',
  'isFixedAdminIdentity', 'parseRoles', 'parseCsvLine', 'parseOfficerRoles',
  'normalizePhoneNumber', 'pickRosterPhoneNumber', 'isPaidRosterStatus',
  'parseRosterEntries', 'getImportedOfficerState', 'hasRestrictedAdminAccess',
  'getEffectiveRolesForIdentity'];
function load(extra = [], mocks = {}) {
  const wanted = [...names, ...extra];
  const declarations = source.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => wanted.includes(declaration.name.getText(source))));
  const code = declarations.map(declaration => declaration.getText(source)).join('\n')
    + '\nglobalThis.api = {' + wanted.join(',') + '};';
  const context = { ...mocks };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context.api;
}
function loadImportHandler(mocks) {
  const route = source.statements.find(statement => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(source) === 'app.post'
    && statement.expression.arguments[0]?.text === '/api/clubs/:clubId/roster/import');
  const code = 'globalThis.handler = ' + route.expression.arguments[1].getText(source);
  const context = { ...load(), ...mocks };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context.handler;
}
module.exports = { load, loadImportHandler };
