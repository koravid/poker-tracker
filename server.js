const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Base de données ──────────────────────────────────────────────
const db = new sqlite3.Database('./poker.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    result REAL NOT NULL,
    total_buyin REAL DEFAULT 0,
    total_mtt INTEGER DEFAULT 0,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS session_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    site TEXT NOT NULL,
    mtt INTEGER DEFAULT 0,
    buyin REAL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS current_session (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT DEFAULT '{}'
  )`);
  db.run(`INSERT OR IGNORE INTO current_session (id, data) VALUES (1, '{}')`);
});

// ── Helpers ──────────────────────────────────────────────────────
function dbGet(sql, params=[]) {
  return new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
}
function dbAll(sql, params=[]) {
  return new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
}
function dbRun(sql, params=[]) {
  return new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

const SITES = ['wina', 'ps', 'pmu', 'bet', 'uni'];
function emptySession() {
  const s = { buyins: {}, mtt: {} };
  SITES.forEach(id => { s.buyins[id] = 0; s.mtt[id] = 0; });
  return s;
}

async function getCurrentSession() {
  const row = await dbGet('SELECT data FROM current_session WHERE id=1');
  return JSON.parse(row.data);
}
async function saveCurrentSession(data) {
  await dbRun('UPDATE current_session SET data=? WHERE id=1', [JSON.stringify(data)]);
}

// ── Routes ───────────────────────────────────────────────────────

app.post('/api/buyin', async (req, res) => {
  const site = req.query.site || req.body.site;
  const amount = parseFloat(req.query.amount || req.body.amount);
  if (!SITES.includes(site) || isNaN(amount) || amount <= 0)
    return res.status(400).json({ error: 'Paramètres invalides' });
  const session = await getCurrentSession();
  session.buyins[site] = (session.buyins[site] || 0) + amount;
  session.mtt[site] = (session.mtt[site] || 0) + 1;
  await saveCurrentSession(session);
  broadcast({ type: 'SESSION_UPDATE', session });
  res.json({ ok: true, session });
});

app.post('/api/buyin/undo', async (req, res) => {
  const site = req.query.site || req.body.site;
  const amount = parseFloat(req.query.amount || req.body.amount);
  if (!SITES.includes(site) || isNaN(amount))
    return res.status(400).json({ error: 'Paramètres invalides' });
  const session = await getCurrentSession();
  if ((session.mtt[site] || 0) > 0) {
    session.buyins[site] = Math.max(0, (session.buyins[site] || 0) - amount);
    session.mtt[site] = Math.max(0, (session.mtt[site] || 0) - 1);
    await saveCurrentSession(session);
    broadcast({ type: 'SESSION_UPDATE', session });
  }
  res.json({ ok: true, session });
});

app.post('/api/session/set', async (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object')
    return res.status(400).json({ error: 'Données invalides' });
  await saveCurrentSession(data);
  broadcast({ type: 'SESSION_UPDATE', session: data });
  res.json({ ok: true, session: data });
});

app.get('/api/session', async (req, res) => {
  res.json(await getCurrentSession());
});

app.delete('/api/session', async (req, res) => {
  const empty = emptySession();
  await saveCurrentSession(empty);
  broadcast({ type: 'SESSION_UPDATE', session: empty });
  res.json({ ok: true });
});

app.post('/api/session/close', async (req, res) => {
  const { result, date, note } = req.body;
  if (isNaN(parseFloat(result))) return res.status(400).json({ error: 'Résultat invalide' });
  const session = await getCurrentSession();
  const totalBuyin = SITES.reduce((a, s) => a + (session.buyins?.[s] || 0), 0);
  const totalMtt = SITES.reduce((a, s) => a + (session.mtt?.[s] || 0), 0);
  const info = await dbRun(
    'INSERT INTO sessions (date, result, total_buyin, total_mtt, note) VALUES (?,?,?,?,?)',
    [date || new Date().toISOString().split('T')[0], parseFloat(result), totalBuyin, totalMtt, note || '']
  );
  const sessionId = info.lastID;
  for (const s of SITES) {
    if ((session.mtt?.[s] || 0) > 0)
      await dbRun('INSERT INTO session_sites (session_id, site, mtt, buyin) VALUES (?,?,?,?)',
        [sessionId, s, session.mtt[s], session.buyins[s]]);
  }
  const empty = emptySession();
  await saveCurrentSession(empty);
  broadcast({ type: 'SESSION_CLOSED', sessionId });
  broadcast({ type: 'SESSION_UPDATE', session: empty });
  res.json({ ok: true, sessionId });
});

app.get('/api/sessions', async (req, res) => {
  const sessions = await dbAll('SELECT * FROM sessions ORDER BY date DESC');
  const withSites = await Promise.all(sessions.map(async s => {
    const sites = await dbAll('SELECT * FROM session_sites WHERE session_id=?', [s.id]);
    const sitesMap = {};
    sites.forEach(ss => { sitesMap[ss.site] = { mtt: ss.mtt, buyin: ss.buyin }; });
    return { ...s, sites: sitesMap };
  }));
  res.json(withSites);
});

app.delete('/api/sessions/:id', async (req, res) => {
  await dbRun('DELETE FROM session_sites WHERE session_id=?', [req.params.id]);
  await dbRun('DELETE FROM sessions WHERE id=?', [req.params.id]);
  broadcast({ type: 'SESSIONS_UPDATED' });
  res.json({ ok: true });
});

app.get('/api/ping', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Poker Tracker démarré sur http://localhost:${PORT}`));
