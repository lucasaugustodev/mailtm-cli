/**
 * mail.tm client — single-file, no external runtime deps.
 * Reusable as a library (require('mailtm-cli')) or via CLI.
 *
 * Public API:
 *   const mt = new MailTM();
 *   await mt.createAccount();           // → email
 *   await mt.listMessages();             // → [{id, subject, ...}]
 *   await mt.getMessage(id);             // → { text, html, ... }
 *   await mt.waitForOTP({ subjectFilter, timeout, otpPattern });
 *   await mt.deleteAccount();
 *
 * Persisted form (used by CLI):
 *   await MailTM.fromSession(path) / mt.saveSession(path)
 */

const BASE_URL = 'https://api.mail.tm';

class MailTM {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || BASE_URL;
    this.email = opts.email || null;
    this.password = opts.password || null;
    this.token = opts.token || null;
    this.accountId = opts.accountId || null;
  }

  // ---------- HTTP ----------
  async _req(endpoint, opts = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let attempt = 0;
    while (true) {
      const res = await fetch(url, { ...opts, headers });
      // mail.tm returns 429 with Retry-After when rate-limited
      if (res.status === 429 && attempt < 3) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
        await sleep((retryAfter || 5 + attempt * 5) * 1000);
        attempt++;
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`mail.tm ${endpoint}: HTTP ${res.status} — ${body.substring(0, 200)}`);
      }
      // 204 No Content
      if (res.status === 204) return null;
      return res.json();
    }
  }

  // ---------- domains ----------
  async getDomains() {
    const data = await this._req('/domains');
    return (data?.['hydra:member'] || []).map(d => d.domain);
  }

  // ---------- account lifecycle ----------
  async createAccount({ user, password, domain } = {}) {
    if (!domain) {
      const domains = await this.getDomains();
      if (!domains.length) throw new Error('mail.tm: no domains available');
      domain = domains[0];
    }
    const localPart = user || `u${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    this.email = `${localPart}@${domain}`;
    this.password = password || `Pw${Date.now()}!${Math.random().toString(36).slice(2, 6)}`;

    const acc = await this._req('/accounts', {
      method: 'POST',
      body: JSON.stringify({ address: this.email, password: this.password }),
    });
    this.accountId = acc.id;

    const tk = await this._req('/token', {
      method: 'POST',
      body: JSON.stringify({ address: this.email, password: this.password }),
    });
    this.token = tk.token;

    return this.email;
  }

  async loginExisting({ email, password }) {
    this.email = email;
    this.password = password;
    const tk = await this._req('/token', {
      method: 'POST',
      body: JSON.stringify({ address: email, password }),
    });
    this.token = tk.token;
    // try to recover accountId
    try {
      const me = await this._req('/me');
      this.accountId = me?.id || null;
    } catch {}
    return this.token;
  }

  async deleteAccount() {
    if (!this.accountId || !this.token) return;
    try {
      await this._req(`/accounts/${this.accountId}`, { method: 'DELETE' });
    } catch (e) { /* tolerar erros (já deletada, expirou etc) */ }
  }

  // ---------- messages ----------
  async listMessages() {
    const data = await this._req('/messages');
    return data?.['hydra:member'] || [];
  }

  async getMessage(id) {
    return this._req(`/messages/${id}`);
  }

  async deleteMessage(id) {
    return this._req(`/messages/${id}`, { method: 'DELETE' });
  }

  /**
   * Polling helper to wait for an OTP to land in the inbox.
   *
   * @param {object} [opts]
   * @param {number} [opts.timeout=180000]       max ms to wait
   * @param {number} [opts.interval=3000]         poll interval ms
   * @param {RegExp} [opts.otpPattern]            regex to extract code from body. Default: /\b(\d{4,8})\b/
   * @param {string|RegExp|null} [opts.subjectFilter] match subject (string=substring, regex=test)
   * @param {string|RegExp|null} [opts.fromFilter]    match sender address
   * @param {number} [opts.minLength=4]           min OTP length
   * @param {number} [opts.maxLength=8]           max OTP length
   * @param {boolean} [opts.deleteOnMatch=false]  delete the message after extracting OTP
   * @returns {{ otp, messageId, subject, from, body }}
   */
  async waitForOTP({
    timeout = 180000,
    interval = 3000,
    otpPattern,
    subjectFilter = null,
    fromFilter = null,
    minLength = 4,
    maxLength = 8,
    deleteOnMatch = false,
  } = {}) {
    const pattern = otpPattern || new RegExp(`\\b(\\d{${minLength},${maxLength}})\\b`);
    const matchSubject = mkMatcher(subjectFilter);
    const matchFrom = mkMatcher(fromFilter);

    const seen = new Set();
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const list = await this.listMessages().catch(() => []);
      for (const m of list) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);

        if (subjectFilter && !matchSubject(m.subject || '')) continue;
        if (fromFilter && !matchFrom(m.from?.address || '')) continue;

        let full;
        try { full = await this.getMessage(m.id); } catch { continue; }
        const body = `${m.subject || ''}\n${full?.text || ''}\n${(full?.html || []).join(' ')}`;
        const match = body.match(pattern);
        if (match) {
          if (deleteOnMatch) try { await this.deleteMessage(m.id); } catch {}
          return {
            otp: match[1],
            messageId: m.id,
            subject: m.subject,
            from: m.from?.address || null,
            body: full?.text || '',
          };
        }
      }
      await sleep(interval);
    }
    throw new Error(`mail.tm: timeout (${timeout}ms) waiting for OTP in ${this.email}`);
  }

  // ---------- session helpers (for CLI persistence) ----------
  toJSON() {
    return { email: this.email, password: this.password, token: this.token, accountId: this.accountId, baseUrl: this.baseUrl };
  }

  static fromJSON(obj) {
    return new MailTM(obj || {});
  }
}

function mkMatcher(filter) {
  if (!filter) return () => true;
  if (filter instanceof RegExp) return (s) => filter.test(s || '');
  const lc = String(filter).toLowerCase();
  return (s) => String(s || '').toLowerCase().includes(lc);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { MailTM };
