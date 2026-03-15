# Poker Bankroll Tracker

App web complète avec API HTTP pour Stream Deck.

## Structure
```
poker-app/
├── server.js          ← Backend Express (API)
├── package.json
├── public/
│   └── index.html     ← Frontend
└── data/
    └── sessions.json  ← Données (auto-créé)
```

---

## 🚀 Déploiement sur Railway (gratuit)

### Étape 1 — Créer un compte Railway
1. Va sur [railway.app](https://railway.app)
2. Connecte-toi avec GitHub

### Étape 2 — Préparer le code sur GitHub
1. Crée un nouveau repo GitHub (ex: `poker-bankroll`)
2. Upload les fichiers : `server.js`, `package.json`, et le dossier `public/`
3. Commit & push

### Étape 3 — Déployer sur Railway
1. Dans Railway, clique **New Project → Deploy from GitHub**
2. Sélectionne ton repo `poker-bankroll`
3. Railway détecte automatiquement Node.js et lance `npm start`
4. Dans **Settings → Networking**, clique **Generate Domain**
5. Tu obtiens une URL du type : `https://poker-bankroll-xxxx.railway.app`

### Étape 4 — Accéder à l'app
Ouvre l'URL dans ton navigateur → l'app est en ligne !

---

## 🎮 Configuration Stream Deck

### Plugin recommandé : "API Ninja" ou "URL Launcher (POST)"

Pour chaque bouton buy-in, crée une action avec :

**Méthode :** POST  
**URL :** `https://ton-app.railway.app/api/buyin?site=SITE&amount=MONTANT`

### Tableau des URLs Stream Deck

| Bouton | URL |
|--------|-----|
| Winamax €2  | `POST /api/buyin?site=wina&amount=2`  |
| Winamax €5  | `POST /api/buyin?site=wina&amount=5`  |
| Winamax €10 | `POST /api/buyin?site=wina&amount=10` |
| Winamax €20 | `POST /api/buyin?site=wina&amount=20` |
| Winamax €50 | `POST /api/buyin?site=wina&amount=50` |
| Stars €5    | `POST /api/buyin?site=ps&amount=5`    |
| PMU €5      | `POST /api/buyin?site=pmu&amount=5`   |
| Betclic €5  | `POST /api/buyin?site=bet&amount=5`   |
| Unibet €5   | `POST /api/buyin?site=uni&amount=5`   |
| Annuler     | `POST /api/undo`                       |

**Sites valides :** `wina`, `ps`, `pmu`, `bet`, `uni`  
**Montants valides :** `2`, `5`, `10`, `20`, `50`

---

## 📡 API complète

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET  | `/api/state` | État complet (JSON) |
| POST | `/api/buyin?site=X&amount=Y` | Ajouter un buy-in |
| POST | `/api/undo` | Annuler le dernier buy-in |
| POST | `/api/session/close` | Clôturer la session |
| POST | `/api/session/reset` | Reset session en cours |
| DELETE | `/api/session/:id` | Supprimer une session |
| GET  | `/api/export/csv` | Export CSV |

### Exemple : clôturer une session via curl
```bash
curl -X POST https://ton-app.railway.app/api/session/close \
  -H "Content-Type: application/json" \
  -d '{"result": 145.50, "date": "2026-03-15", "note": "Bonne session"}'
```

---

## 💻 Lancer en local (dev)

```bash
npm install
npm start
# → http://localhost:3000
```

---

## 🔄 Polling automatique
L'app se synchronise automatiquement toutes les **5 secondes**.  
Donc si tu ajoutes un buy-in via le Stream Deck, l'interface se met à jour toute seule.
