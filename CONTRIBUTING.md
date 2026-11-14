# Contributing

Thanks for looking. This is a small project, so the rules are short.

## Setup

```bash
bun install
bun run dev     # Tauri window with hot reload
bun run test    # backend tests
bun check       # type check
```

The project uses **Bun** for everything: `bun` instead of `node`, `bun test` instead of jest, `bun:sqlite` instead of better-sqlite3. See `CLAUDE.md` for the full list.

## Before you open a pull request

1. `bun check` and `bun run test` pass.
2. UI changes: check dark and light themes and a narrow window.
3. Protocol changes: document findings in `docs/PROTOCOL.md` or the relevant focused guide under `docs/` (endpoint, parameters, what the server answers). Print shapes and counts in notes and logs, never message text, tokens or ids from a real account.
4. Keep commits small, with a message saying what changed and why.

## What not to commit

Anything private to an account: `session.json`, cookies, keys, `*.db` message caches, decrypted backups, logs with real ids. Tool caches (`.claude-flow/`, `.swarm/`, `.grepai/`, `ruvector.db`) are ignored for the same reason. If you are unsure, leave it out.

## Scope

Zalo's social features and mini-apps are out of scope. Voice and video calls are not implemented; the [calling investigation and test harness](docs/calling-protocol.md) cover protocol feasibility. Features should follow what Zalo PC does, so a Zalo user trusts the app on sight.
