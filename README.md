# mailtm-cli

[![npm version](https://img.shields.io/npm/v/mailtm-cli.svg)](https://www.npmjs.com/package/mailtm-cli)
[![license](https://img.shields.io/npm/l/mailtm-cli.svg)](LICENSE)
[![node](https://img.shields.io/node/v/mailtm-cli.svg)](https://nodejs.org)

> Tiny CLI for [mail.tm](https://mail.tm) — disposable inboxes & OTP capture for shell scripts and CI.

Useful when you need to automate signup/login flows that send a one-time code by email.

## Install

```bash
# Zero install (recommended for one-shot use / CI)
npx mailtm-cli new

# Or install globally to use the `mailtm` command everywhere
npm install -g mailtm-cli
mailtm new
```

Requires **Node ≥ 18** (uses native `fetch`).

## 60-second example

```bash
# 1. Spin up a disposable inbox
$ mailtm new
u1234abcd@deltajohnsons.com

# 2. Use that email anywhere — the inbox is yours
$ EMAIL=$(mailtm current)
$ curl -X POST https://example.com/signup -d "email=$EMAIL"

# 3. Wait for the OTP — prints just the code
$ OTP=$(mailtm wait --subject "verify")
$ echo "got code: $OTP"
got code: 482915

# 4. Use it
$ curl -X POST https://example.com/verify -d "otp=$OTP"

# 5. Clean up when done
$ mailtm rm
deleted u1234abcd@deltajohnsons.com
```

## Commands

| Command | What it does |
|---|---|
| `mailtm new [-u user] [-d domain] [--json]` | Create a new disposable inbox. Sets it as **current**. |
| `mailtm current [--json]` | Print the email of the current inbox |
| `mailtm list` (`ls`) | List all saved inboxes (`*` marks current) |
| `mailtm use <email>` | Switch the current inbox |
| `mailtm inbox [--json]` | List messages in current inbox |
| `mailtm read <id> [--json] [--html]` | Print full content of a message |
| `mailtm wait` (`otp`) | Poll until an OTP arrives, then print just the code |
| `mailtm rm [-e email] [--all]` | Delete an inbox (defaults to current) |
| `mailtm where` | Show where sessions are saved (`~/.mailtm/`) |

### `mailtm wait` options

```
-s, --subject <text>     only messages whose subject contains this
-f, --from <addr>        only messages from this sender
-t, --timeout <seconds>  max wait (default 180)
-i, --interval <seconds> poll interval (default 3)
--min <n> --max <n>      OTP digit length (default 4–8)
--regex <pattern>        custom regex (first capture group is the OTP)
--delete                 delete the message after capture
--json                   print {otp, subject, from, messageId, body}
```

By default the regex is `\b(\d{4,8})\b` — finds 4-to-8-digit numeric codes anywhere in the message body or subject.

## Real-world recipes

### Bash — signup with OTP

```bash
EMAIL=$(mailtm new)

curl -sS -X POST https://app.example.com/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}"

OTP=$(mailtm wait --subject "code" --timeout 120)

curl -sS -X POST https://app.example.com/auth/verify \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$OTP\"}"

mailtm rm   # cleanup
```

### Playwright (Node)

```js
const { execSync } = require('child_process');

const email = execSync('mailtm new', { encoding: 'utf8' }).trim();
await page.fill('input[type=email]', email);
await page.click('button:has-text("Continue")');

const otp = execSync('mailtm wait -s token -t 180', { encoding: 'utf8' }).trim();
await page.fill('input[name=otp]', otp);
await page.click('button:has-text("Verify")');
```

### GitHub Actions

```yaml
- name: Get temp inbox
  run: |
    npm i -g mailtm-cli
    echo "EMAIL=$(mailtm new)" >> $GITHUB_ENV

- name: Trigger signup
  run: curl -X POST $URL -d "email=$EMAIL"

- name: Capture OTP
  run: |
    OTP=$(mailtm wait --subject "verify" --timeout 120)
    echo "OTP=$OTP" >> $GITHUB_ENV
```

### Custom OTP format (e.g. 6-digit code with spaces)

```bash
# code looks like: "Your code: 123 456"
mailtm wait --regex "code: (\d{3} \d{3})"
```

### Multiple inboxes in parallel

```bash
mailtm new      # → u1@x.com (current)
mailtm new      # → u2@y.com (current, but u1 still saved)
mailtm list
  u1@x.com   2026-04-25T10:00:00.000Z
* u2@y.com   2026-04-25T10:00:05.000Z

mailtm wait -e u1@x.com   # wait on a specific inbox
```

## Use as a Node library

```js
const { MailTM } = require('mailtm-cli');

const mt = new MailTM();
await mt.createAccount();
console.log(mt.email);

const { otp } = await mt.waitForOTP({
  subjectFilter: 'verify',
  timeout: 120000,
});
console.log('OTP:', otp);

await mt.deleteAccount();
```

## Where things are saved

`~/.mailtm/sessions/<id>.json` — one file per inbox, mode `600`. Contains the email, password and bearer token issued by mail.tm. Keep it private.

## Notes

- mail.tm is a free service with rate limits. The CLI handles 429 with retries.
- Inboxes expire after a few days of inactivity. Don't depend on persistence.
- This project is unofficial and not affiliated with mail.tm.

## License

MIT.
