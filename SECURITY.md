# Security

## What this app handles

Zalo Lite holds a live session for a real Zalo account and a local copy of the user's messages. Treat both as secrets.

- **Session file** (`session.json` in the data folder): the account's session cookie and device id. Anyone holding it can act as the account until the session is revoked. It is never part of this repository.
- **Message cache** (`<uid>.db`): private conversations in plain SQLite, newest 3,000 messages per chat.
- **Local backend**: listens on `127.0.0.1` only, requires a per-launch token, and rejects browser requests from origins other than the app's own.
- **Phone sync** downloads an encrypted backup, decrypts it with a key that exists only in memory for that run, imports it, and deletes the files. The decrypted copy is kept on disk only if an import fails, so it can be retried.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Include what you found, how to reproduce it, and the affected version or commit. You will get a reply as soon as the maintainer can read it.

## Never post

Session files, cookies, `zpw_sek` values, RSA keys, backup files, message databases or screenshots of private chats, in issues, pull requests or logs. If you pasted one by mistake, sign out of the account's other sessions in the Zalo app and treat the session as compromised.
