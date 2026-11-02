# Zalo Lite

A lightweight desktop client for Zalo's messaging, built with **Tauri** (shell) and **Bun** (backend + tooling). Social features (Nhật ký, Cloud, mini-apps) are deliberately left out.

## How it works

```
Tauri window (Preact UI, src/)
   │  WebSocket on 127.0.0.1, random port + token per launch
Bun backend sidecar (server/)  ──  zca-js  ──►  Zalo servers (HTTPS + WSS)
   │
SQLite message store (~/Library/Application Support/dev.khoa.zalolite/<uid>.db)
```

- `docs/PROTOCOL.md`: the endpoint map recovered from Zalo PC 26.10.20 (`app.asar`): QR login and confirmation, `getLoginInfo` signing, `zpw_enk` request encryption, message endpoints, WebSocket frame format.
- `server/`: login (QR with scan confirmation), session resume, conversation sync, send text/photo/file, reply, reactions, recall, delete-for-me, typing, read receipts, group history.
- `src/`: the UI, matching Zalo PC's layout, copy, and colour tokens in dark, light, and system themes.
- `PRODUCT.md`: product and design brief. `anti-slop/`: UI audit reports.

## Run

```bash
bun install
bun run dev        # compiles the backend sidecar, then `tauri dev`
bun run build      # release .app / .dmg in src-tauri/target/release/bundle
bun run test       # backend unit tests
```

UI-only iteration in a browser: `bun run server` in one terminal and `bun run dev:web` in another, then open http://localhost:1420.

## Known limits

- **1:1 history before first login.** Zalo keeps older 1:1 messages on the phone; the server only hands back recent messages on connect. Everything received after that is stored locally. Group history loads from the server.
- **One web session at a time.** Like Zalo Web, logging in here signs out other web/PC sessions (the app shows a reconnect banner when that happens).
- Not implemented yet: @mentions, forwarding, labels (Phân loại), voice/video calls. Files over 100 MB (they travel through the local socket).

Unofficial client. Use with your own account at your own risk.
