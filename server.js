const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('./poker.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    result REAL NOT NULL,
    total_buyin REAL DEFAULT 0,
    total_mtt INTEGER DEFAULT 0,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS session_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    site TEXT NOT NULL,
    mtt INTEGER DEFAULT 0,
    buyin REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS current_session (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT DEFAULT '{}'
  );
  INSERT OR IGNORE INTO current_session (id, data) VALUES (1, '{}');
`);

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function getCurrentSession() {
  const row = db.prepare('SELECT data FROM current_session WHERE id=1').get();
  return JSON.parse(row.data);
}

function saveCurrentSession(data) {
  db.prepare('UPDATE current_session SET data=? WHERE id=1').run(JSON.stringify(data));
}

const SITES = ['wina', 'ps', 'pmu', 'bet', 'uni'];

function emptySession() {
  const s = { buyins: {}, mtt: {} };
  SITES.forEach(id => { s.buyins[id] = 0; s.mtt[id] = 0; });
  return s;
}

// Ajouter un buy-in (Stream Deck ou manuel)
app.post('/api/buyin', (req, res) => {
  const site = req.query.site || req.body.site;
  const amount = parseFloat(req.query.amount || req.body.amount);
  if (!SITES.includes(site) || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const session = getCurrentSession();
  if (!session.buyins) Object.assign(session, emptySession());
  session.buyins[site] = (session.buyins[site] || 0) + amount;
  session.mtt[site] = (session.mtt[site] || 0) + 1;
  saveCurrentSession(session);
  broadcast({ type: 'SESSION_UPDATE', session });
  res.json({ ok: true, session });
});

// Annuler un buy-in
app.post('/api/buyin/undo', (req, res) => {
  const site = req.query.site || req.body.site;
  const amount = parseFloat(req.query.amount || req.body.amount);
  if (!SITES.includes(site) || isNaN(amount)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const session = getCurrentSession();
  if ((session.mtt[site] || 0) > 0) {
    session.buyins[site] = Math.max(0, (session.buyins[site] || 0) - amount);
    session.mtt[site] = Math.max(0, (session.mtt[site] || 0) - 1);
    saveCurrentSession(session);
    broadcast({ type: 'SESSION_UPDATE', session });
  }
  res.json({ ok: true, session });
});

// Lire la session courante
app.get('/api/session', (req, res) => {
  res.json(getCurrentSession());
});

// Écraser directement la session courante (bouton "Modifier" du frontend)
app.post('/api/session/set', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Données invalides' });
  }
  if (!data.buyins) data.buyins = {};
  if (!data.mtt) data.mtt = {};
  SITES.forEach(s => {
    if (data.buyins[s] === undefined) data.buyins[s] = 0;
    if (data.mtt[s] === undefined) data.mtt[s] = 0;
  });
  saveCurrentSession(data);
  broadcast({ type: 'SESSION_UPDATE', session: data });
  res.json({ ok: true, session: data });
});

// Réinitialiser la session
app.delete('/api/session', (req, res) => {
  const empty = emptySession();
  saveCurrentSession(empty);
  broadcast({ type: 'SESSION_UPDATE', session: empty });
  res.json({ ok: true });
});

// Clôturer et enregistrer la session
app.post('/api/session/close', (req, res) => {
  const { result, date, note } = req.body;
  if (isNaN(parseFloat(result))) return res.status(400).json({ error: 'Résultat invalide' });
  const session = getCurrentSession();
  const totalBuyin = SITES.reduce((a, s) => a + (session.buyins?.[s] || 0), 0);
  const totalMtt = SITES.reduce((a, s) => a + (session.mtt?.[s] || 0), 0);
  const info = db.prepare(`
    INSERT INTO sessions (date, result, total_buyin, total_mtt, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(date || new Date().toISOString().split('T')[0], parseFloat(result), totalBuyin, totalMtt, note || '');
  const sessionId = info.lastInsertRowid;
  SITES.forEach(s => {
    if ((session.mtt?.[s] || 0) > 0) {
      db.prepare('INSERT INTO session_sites (session_id, site, mtt, buyin) VALUES (?,?,?,?)')
        .run(sessionId, s, session.mtt[s], session.buyins[s]);
    }
  });
  const empty = emptySession();
  saveCurrentSession(empty);
  broadcast({ type: 'SESSION_CLOSED', sessionId });
  broadcast({ type: 'SESSION_UPDATE', session: empty });
  res.json({ ok: true, sessionId });
});

// Toutes les sessions
app.get('/api/sessions', (req, res) => {
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY date DESC').all();
  const withSites = sessions.map(s => {
    const sites = db.prepare('SELECT * FROM session_sites WHERE session_id=?').all(s.id);
    const sitesMap = {};
    sites.forEach(ss => { sitesMap[ss.site] = { mtt: ss.mtt, buyin: ss.buyin }; });
    return { ...s, sites: sitesMap };
  });
  res.json(withSites);
});

// Supprimer une session
app.delete('/api/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id=?').run(req.params.id);
  broadcast({ type: 'SESSIONS_UPDATED' });
  res.json({ ok: true });
});

app.get('/api/ping', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Poker Tracker démarré sur http://localhost:${PORT}`);
});
