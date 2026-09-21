// After the apps/ migration the backend's better-sqlite3 binary may live
// either in `apps/backend/node_modules/` (if not hoisted) or in the
// workspace root `node_modules/` (if hoisted by npm). Try both.
const path = require('path');
const fs = require('fs');
function loadBetterSqlite() {
  const candidates = [
    path.resolve(__dirname, '..', 'apps', 'backend', 'node_modules', 'better-sqlite3'),
    path.resolve(__dirname, '..', 'node_modules', 'better-sqlite3'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  // Last resort — let Node's resolver find it via the workspace tree.
  return require('better-sqlite3');
}
const Database = loadBetterSqlite();
const os = require('os');
const home = os.homedir();
const platformPaths =
  process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'betterc0de', 'betterc0de.db'),
      ]
    : process.platform === 'darwin'
      ? [
          path.join(home, 'Library', 'Application Support', 'betterc0de', 'betterc0de.db'),
        ]
      : [
          path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'betterc0de', 'betterc0de.db'),
        ];
const paths = [...platformPaths, path.join(home, '.betterc0de', 'betterc0de.db')];
for (const p of paths) {
  try {
    const db = new Database(p, { readonly: true });
    const tCount = db.prepare('SELECT COUNT(*) as c FROM projection_threads').get().c;
    const mCount = db.prepare('SELECT COUNT(*) as c FROM projection_messages').get().c;
    const active = db.prepare("SELECT COUNT(*) as c FROM projection_threads WHERE status = 'active'").get().c;
    console.log('\n=== ' + p + ' ===');
    console.log('threads:', tCount, '| messages:', mCount, '| active:', active);
    const last = db.prepare('SELECT thread_id, title, status, updated_at FROM projection_threads ORDER BY updated_at DESC LIMIT 5').all();
    console.log('last 5:', JSON.stringify(last, null, 2));
    db.close();
  } catch (e) { console.log('err on ' + p + ':', e.message); }
}
process.exit(0);
