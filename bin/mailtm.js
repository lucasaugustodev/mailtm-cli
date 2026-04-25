#!/usr/bin/env node
/**
 * mailtm — CLI for mail.tm.
 *
 * Quickstart:
 *    mailtm new                       # creates a temp inbox, prints email
 *    mailtm wait                       # waits for OTP in latest inbox, prints code
 *    mailtm wait --subject "verify"
 *    mailtm wait --json
 *    mailtm inbox
 *    mailtm read <id>
 *    mailtm rm                          # delete latest inbox
 */
const { Command } = require('commander');
const { MailTM } = require('../src/mailtm');
const sessions = require('../src/sessions');

const pkg = require('../package.json');

const program = new Command();
program
  .name('mailtm')
  .description('Tiny CLI for mail.tm — disposable inboxes & OTP capture for shell scripts and CI')
  .version(pkg.version);

// ----- helpers -----
function getCurrentClient(emailFlag) {
  let session;
  if (emailFlag) session = sessions.loadByEmail(emailFlag);
  else session = sessions.loadCurrent();
  if (!session) {
    console.error('No mail.tm session found. Run "mailtm new" first (or pass --email).');
    process.exit(1);
  }
  return MailTM.fromJSON(session);
}

function maybeJson(obj, jsonFlag) {
  if (jsonFlag) console.log(JSON.stringify(obj, null, 2));
  else console.log(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

// ===== new =====
program
  .command('new')
  .description('Create a new disposable inbox')
  .option('-u, --user <name>', 'desired local-part (default: random)')
  .option('-p, --password <pwd>', 'account password (default: random)')
  .option('-d, --domain <domain>', 'mail.tm domain (default: first available)')
  .option('--json', 'print full JSON instead of just the email')
  .action(async (opts) => {
    try {
      const mt = new MailTM();
      await mt.createAccount({ user: opts.user, password: opts.password, domain: opts.domain });
      sessions.save(mt.toJSON());
      if (opts.json) console.log(JSON.stringify(mt.toJSON(), null, 2));
      else console.log(mt.email);
    } catch (e) { console.error(e.message); process.exit(1); }
  });

// ===== current =====
program
  .command('current')
  .description('Show currently selected inbox')
  .option('--json', 'full JSON')
  .action((opts) => {
    const s = sessions.loadCurrent();
    if (!s) { console.error('No current session.'); process.exit(1); }
    if (opts.json) console.log(JSON.stringify(s, null, 2));
    else console.log(s.email);
  });

// ===== list =====
program
  .command('list')
  .alias('ls')
  .description('List saved inboxes')
  .action(() => {
    const all = sessions.list();
    if (!all.length) { console.log('(no sessions)'); return; }
    const cur = (sessions.loadCurrent() || {}).email;
    for (const s of all) console.log(`${s.email === cur ? '*' : ' '} ${s.email}\t${s.createdAt}`);
  });

// ===== use =====
program
  .command('use <email>')
  .description('Switch the "current" inbox')
  .action((email) => {
    const id = sessions.idFromEmail(email);
    if (!sessions.loadById(id)) { console.error('Email not found in sessions.'); process.exit(1); }
    sessions.setCurrent(id);
    console.log(`current = ${email}`);
  });

// ===== inbox =====
program
  .command('inbox')
  .description('List messages in inbox')
  .option('-e, --email <email>', 'use specific inbox')
  .option('--json', 'output JSON')
  .action(async (opts) => {
    try {
      const mt = getCurrentClient(opts.email);
      const msgs = await mt.listMessages();
      if (opts.json) { console.log(JSON.stringify(msgs, null, 2)); return; }
      if (!msgs.length) { console.log('(empty)'); return; }
      for (const m of msgs) {
        console.log(`${m.id}\t${m.from?.address || ''}\t${m.subject || ''}\t${m.createdAt || ''}`);
      }
    } catch (e) { console.error(e.message); process.exit(1); }
  });

// ===== read =====
program
  .command('read <id>')
  .description('Read full content of a message')
  .option('-e, --email <email>', 'use specific inbox')
  .option('--json', 'output JSON')
  .option('--text', 'print text body only (default)')
  .option('--html', 'print HTML body')
  .action(async (id, opts) => {
    try {
      const mt = getCurrentClient(opts.email);
      const m = await mt.getMessage(id);
      if (opts.json) { console.log(JSON.stringify(m, null, 2)); return; }
      if (opts.html) { console.log((m.html || []).join('\n')); return; }
      console.log(`From:    ${m.from?.address || ''}`);
      console.log(`Subject: ${m.subject || ''}`);
      console.log(`Date:    ${m.createdAt || ''}`);
      console.log('---');
      console.log(m.text || '');
    } catch (e) { console.error(e.message); process.exit(1); }
  });

// ===== wait (OTP) =====
program
  .command('wait')
  .alias('otp')
  .description('Poll inbox until an OTP code arrives, then print it')
  .option('-e, --email <email>', 'use specific inbox')
  .option('-s, --subject <text>', 'only consider messages whose subject contains this')
  .option('-f, --from <addr>', 'only consider messages from this sender (substring)')
  .option('-t, --timeout <seconds>', 'max wait in seconds', '180')
  .option('-i, --interval <seconds>', 'poll interval', '3')
  .option('--min <n>', 'min digits in OTP', '4')
  .option('--max <n>', 'max digits in OTP', '8')
  .option('--regex <pattern>', 'custom regex (uses first capture group)')
  .option('--delete', 'delete message after match')
  .option('--json', 'print {otp, subject, from, messageId, body}')
  .action(async (opts) => {
    try {
      const mt = getCurrentClient(opts.email);
      const out = await mt.waitForOTP({
        timeout: parseInt(opts.timeout, 10) * 1000,
        interval: parseInt(opts.interval, 10) * 1000,
        subjectFilter: opts.subject || null,
        fromFilter: opts.from || null,
        otpPattern: opts.regex ? new RegExp(opts.regex) : null,
        minLength: parseInt(opts.min, 10),
        maxLength: parseInt(opts.max, 10),
        deleteOnMatch: !!opts.delete,
      });
      if (opts.json) console.log(JSON.stringify(out, null, 2));
      else console.log(out.otp);
    } catch (e) { console.error(e.message); process.exit(1); }
  });

// ===== rm =====
program
  .command('rm')
  .alias('delete')
  .description('Delete an inbox (defaults to current)')
  .option('-e, --email <email>', 'specific email (defaults to current)')
  .option('--all', 'delete every saved inbox')
  .action(async (opts) => {
    try {
      if (opts.all) {
        const all = sessions.list();
        for (const s of all) {
          const sess = sessions.loadById(s.id);
          if (sess) {
            const mt = MailTM.fromJSON(sess);
            await mt.deleteAccount();
            sessions.remove(s.id);
            console.log(`deleted ${sess.email}`);
          }
        }
        return;
      }
      const session = opts.email ? sessions.loadByEmail(opts.email) : sessions.loadCurrent();
      if (!session) { console.error('No session.'); process.exit(1); }
      const mt = MailTM.fromJSON(session);
      await mt.deleteAccount();
      sessions.remove(sessions.idFromEmail(session.email));
      console.log(`deleted ${session.email}`);
    } catch (e) { console.error(e.message); process.exit(1); }
  });

// ===== where (debug) =====
program
  .command('where')
  .description('Show where sessions are stored')
  .action(() => {
    console.log(sessions.SESSIONS_DIR);
  });

program.parseAsync(process.argv).catch(e => { console.error(e.message); process.exit(1); });
