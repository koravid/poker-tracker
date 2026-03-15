const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'sessions.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = { sessions: [], currentSession: initSession(), initialBankroll: 0 };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function initSession() {
  return {
    buyins: { wina: 0, ps: 0, pmu: 0, bet: 0, uni: 0 },
    mtt:    { wina: 0, ps: 0, pmu: 0, bet: 0, uni: 0 },
    history: [] // for undo
  };
}

const VALID_SITES   = ['wina', 'ps', 'pmu', 'bet', 'uni'];
const VALID_AMOUNTS = [2, 5, 10, 20, 50];

// ── GET current state ─────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json(loadData());
});

// ── POST add buy-in  (Stream Deck calls this) ─────────────────────────────────
// e.g. POST /api/buyin?site=wina&amount=5
// or   POST /api/buyin  { site: "wina", amount: 5 }
app.post('/api/buyin', (req, res) => {
  const site   = req.query.site   || req.body.site;
  const amount = parseFloat(req.query.amount || req.body.amount);

  if (!VALID_SITES.includes(site))
    return res.status(400).json({ error: `Invalid site. Valid: ${VALID_SITES.join(', ')}` });
  if (!VALID_AMOUNTS.includes(amount))
    return res.status(400).json({ error: `Invalid amount. Valid: ${VALID_AMOUNTS.join(', ')}` });

  const data = loadData();
  data.currentSession.buyins[site]  = (data.currentSession.buyins[site]  || 0) + amount;
  data.currentSession.mtt[site]     = (data.currentSession.mtt[site]     || 0) + 1;
  data.currentSession.history.push({ site, amount, ts: Date.now() });
  saveData(data);

  const totalBuyin = Object.values(data.currentSession.buyins).reduce((a, b) => a + b, 0);
  const totalMTT   = Object.values(data.currentSession.mtt).reduce((a, b) => a + b, 0);
  res.json({ ok: true, site, amount, totalBuyin, totalMTT, session: data.currentSession });
});

// ── POST undo last buy-in ─────────────────────────────────────────────────────
app.post('/api/undo', (req, res) => {
  const data = loadData();
  const hist = data.currentSession.history;
  if (!hist.length) return res.status(400).json({ error: 'Nothing to undo' });

  const last = hist.pop();
  data.currentSession.buyins[last.site] = Math.max(0, (data.currentSession.buyins[last.site] || 0) - last.amount);
  data.currentSession.mtt[last.site]    = Math.max(0, (data.currentSession.mtt[last.site]    || 0) - 1);
  saveData(data);
  res.json({ ok: true, undone: last, session: data.currentSession });
});

// ── POST close session ────────────────────────────────────────────────────────
app.post('/api/session/close', (req, res) => {
  const { result, date, note } = req.body;
  if (result === undefined || isNaN(parseFloat(result)))
    return res.status(400).json({ error: 'result (number) is required' });

  const data = loadData();
  const sess = data.currentSession;
  const totalBuyin = Object.values(sess.buyins).reduce((a, b) => a + b, 0);
  const totalMTT   = Object.values(sess.mtt).reduce((a, b) => a + b, 0);

  const record = {
    id: Date.now(),
    date: date || new Date().toISOString().split('T')[0],
    result: parseFloat(result),
    totalBuyin,
    totalMTT,
    sites: Object.fromEntries(
      Object.keys(sess.buyins).map(s => [s, { mtt: sess.mtt[s] || 0, buyin: sess.buyins[s] || 0 }])
    ),
    note: note || ''
  };

  data.sessions.push(record);
  data.currentSession = initSession();
  saveData(data);
  res.json({ ok: true, session: record });
});

// ── POST reset current session ────────────────────────────────────────────────
app.post('/api/session/reset', (req, res) => {
  const data = loadData();
  data.currentSession = initSession();
  saveData(data);
  res.json({ ok: true });
});

// ── DELETE session by id ──────────────────────────────────────────────────────
app.delete('/api/session/:id', (req, res) => {
  const data = loadData();
  data.sessions = data.sessions.filter(s => s.id !== parseInt(req.params.id));
  saveData(data);
  res.json({ ok: true });
});

// ── GET export CSV ────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const data = loadData();
  const sites = ['wina', 'ps', 'pmu', 'bet', 'uni'];
  const siteNames = { wina: 'Winamax', ps: 'PokerStars', pmu: 'PMU Poker', bet: 'Betclic', uni: 'Unibet' };
  const header = ['Date', 'Résultat net', 'Buy-ins total', 'MTT total',
    ...sites.flatMap(s => [`${siteNames[s]} MTT`, `${siteNames[s]} Buy-ins`]), 'Note'].join(',');
  const rows = [...data.sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => [
      s.date, s.result, s.totalBuyin, s.totalMTT,
      ...sites.flatMap(si => [s.sites?.[si]?.mtt || 0, s.sites?.[si]?.buyin || 0]),
      `"${s.note || ''}"`
    ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="poker_sessions.csv"');
  res.send(header + '\n' + rows.join('\n'));
});

app.listen(PORT, () => console.log(`Poker Bankroll App running on port ${PORT}`));
