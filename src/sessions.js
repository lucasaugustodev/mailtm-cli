/**
 * Session persistence — stores accounts in ~/.mailtm/sessions/<id>.json
 * and tracks which one is "current" via ~/.mailtm/current.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.mailtm');
const SESSIONS_DIR = path.join(ROOT, 'sessions');
const CURRENT_FILE = path.join(ROOT, 'current');

function ensureDirs() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function idFromEmail(email) {
  return email.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
}

function save(session) {
  ensureDirs();
  const id = idFromEmail(session.email);
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.writeFileSync(CURRENT_FILE, id, { mode: 0o600 });
  return { id, file };
}

function loadById(id) {
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function loadCurrent() {
  if (!fs.existsSync(CURRENT_FILE)) return null;
  const id = fs.readFileSync(CURRENT_FILE, 'utf-8').trim();
  return loadById(id);
}

function loadByEmail(email) {
  return loadById(idFromEmail(email));
}

function list() {
  ensureDirs();
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
      return { id: f.replace(/\.json$/, ''), email: s.email, createdAt: fs.statSync(path.join(SESSIONS_DIR, f)).mtime.toISOString() };
    } catch { return null; }
  }).filter(Boolean);
}

function setCurrent(id) {
  ensureDirs();
  fs.writeFileSync(CURRENT_FILE, id, { mode: 0o600 });
}

function remove(id) {
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  if (fs.existsSync(CURRENT_FILE)) {
    const cur = fs.readFileSync(CURRENT_FILE, 'utf-8').trim();
    if (cur === id) fs.unlinkSync(CURRENT_FILE);
  }
}

module.exports = { save, loadById, loadCurrent, loadByEmail, list, setCurrent, remove, idFromEmail, ROOT, SESSIONS_DIR };
