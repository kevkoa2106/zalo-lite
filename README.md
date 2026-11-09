<p align="center"><img src="docs/img/logo.svg" width="128" height="128" alt="Zalo Lite app icon: a white speech bubble floating on a blue tile"></p>

<h1 align="center">Zalo Lite</h1>

A lightweight desktop client for the messaging part of [Zalo](https://zalo.me), built with **Tauri** (shell) and **Bun** (backend and tooling). Chat, groups, My Documents, photos, files, stickers and call records are in. Social features (Nhật ký, Cloud, mini-apps) are deliberately left out.

> **Unofficial.** Zalo Lite is not affiliated with or endorsed by VNG or Zalo. It talks to Zalo's servers the way Zalo's own clients do, using protocol details recovered from the Zalo PC app. Use it with your own account, at your own risk. See [Disclaimer](#disclaimer).

## Features

- **Sign in with a QR code** using Zalo PC's own login, with the web-style QR as a fallback. The session is saved locally and resumed on the next launch.
- **Conversations** sorted by recency: people, groups, official accounts and My Documents. Dark, light and system themes, laid out like Zalo PC.
- **Send and receive** text, photos, files, stickers (your own sticker packs plus search and a Recent tab), replies, reactions, recall, delete-for-me, typing indicators and read receipts.
- **Voice messages:** play them in a waveform bubble and record and send your own with the mic button (up to 5 minutes). Zalo deletes old voice files from its servers, so older ones show "Đã hết hạn".
- **Mentions and replies:** `@name` is blue, and clicking the quote above a reply scrolls to the original message.
- **Gear menu, account card and settings.** The gear button opens Zalo PC's menu: Thông tin tài khoản (banner, avatar, name, birth date, phone; you can change the name, gender, birth date and avatar, each after one confirmation), Cài đặt (language, remember login, theme, phone sync, data size and the number of messages kept per chat, how Enter sends), Dữ liệu, Ngôn ngữ, Hỗ trợ and Đăng xuất. Settings are saved in `settings.json` in the data folder.
- **Call records** shown as cards: incoming, missed and declined, with durations.
- **Older history from your phone.** Zalo keeps old 1:1 history on the phone and withholds group history from new devices, so Zalo Lite can pull a backup from the phone (you accept a prompt there) and import it. See [Phone sync](#phone-sync).
- **A bounded cache, not an archive.** Each chat keeps its newest 3,000 messages, and nothing is stored in the repository. Messages beyond the newest 200 per chat also drop Zalo's duplicate copy of themselves (about 30% smaller database on a 27,000-message account); quoting such an old message is rebuilt from the stored text.

## Architecture

![Zalo Lite architecture: a Tauri window talks over a local WebSocket to a Bun backend, which talks to Zalo's servers and a SQLite cache, and optionally reads phone backups](docs/img/architecture.svg)

- The window never talks to Zalo directly. It talks to a Bun backend on `127.0.0.1` over a WebSocket, on a random port with a per-launch token, and the backend only accepts the app's own origins.
- The backend uses [zca-js](https://github.com/RFS-ADRENO/zca-js) for the protocol and adds the pieces Zalo PC does that zca-js does not: PC QR login, group-cloud history, the phone transfer.
- Messages live in a SQLite file in your user data folder, never in this repository.

## Phone sync

![Phone sync: Zalo Lite asks the servers for history, the phone prompts, the backup is uploaded, then downloaded, decrypted and imported](docs/img/phone-sync.svg)

Settings menu, then **Đồng bộ tin nhắn từ điện thoại**. Your phone shows a sync prompt: accept it there. The backend then downloads the backup, decrypts it, maps Zalo's short ids to real ones, imports the newest messages per chat, and deletes everything it downloaded.

Zalo Lite decrypts and reads the backup with its own code, so Zalo PC is not needed. If its own decoder ever fails an integrity check, a macOS machine with Zalo PC installed falls back to Zalo's library. The full protocol write-up, including the backup format, is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Download

Installers for macOS (Apple silicon and Intel), Linux and Windows are attached to each [release](../../releases). They are **unsigned**: macOS asks you to open the app from System Settings, Privacy & Security, and Windows SmartScreen shows a warning ("More info", then "Run anyway").

| Platform | Chat, groups, stickers, call records | Phone history sync |
|---|---|---|
| macOS | yes (tested) | yes (tested) |
| Linux, Windows | yes, built and released but not yet tested by the maintainer | implemented with the same code, not yet tested |

## Getting started

Requirements: macOS, [Bun](https://bun.sh), [Rust](https://rustup.rs) with the [Tauri prerequisites](https://tauri.app/start/prerequisites/). 

```bash
bun install
bun run dev        # compiles the backend sidecar, then runs `tauri dev`
bun run build      # release .app / .dmg in src-tauri/target/release/bundle
bun run test       # backend unit tests
bun check          # type check
```

UI-only work in a browser: `bun run server` in one terminal and `bun run dev:web` in another, then open <http://localhost:1420>.

### Configuration

All optional, set as environment variables.

| Variable | Default | Purpose |
|---|---|---|
| `ZL_PORT` | `17789` | Backend port (the Tauri shell picks a random one) |
| `ZL_TOKEN` | empty | Token the window must present |
| `ZL_DATA` | `~/Library/Application Support/zalo-lite` | Where the session and message cache live |
| `ZL_LOGIN` | PC QR | Set to `web` to force the web-style QR login |
| `ZL_CACHE_PER_CHAT` | `3000` | Newest messages kept per conversation (wins over the setting in Cài đặt > Quản lý dữ liệu) |

## Project layout

| Path | What is in it |
|---|---|
| `src/` | Preact UI: login, conversation list, chat, composer, sticker picker, styles |
| `server/` | Bun backend: login, sync, message store, normalization, phone transfer and backup reader, with tests |
| `src-tauri/` | Tauri v2 shell that launches the backend sidecar |
| `docs/PROTOCOL.md` | Endpoint map and every live finding about Zalo's protocol |
| `docs/design-audit-001.md` | UI audit report and the fixes that followed |
| `PRODUCT.md` | Product and design brief |

## Known limits

- **One web session at a time.** Like Zalo Web, signing in here signs out other web or PC sessions.
- **Group history.** Zalo withholds some group history from new devices; phone sync fills most of it.
- **Calls.** Call records are shown, but placing or answering voice or video calls is not supported. Zalo PC runs calls in a separate native WebRTC process with signalling that is not documented here, so this is a project of its own ([feasibility notes](docs/PROTOCOL.md)).
- **Voice messages.**
  - Zalo deletes old voice files from its servers, so older ones (including those imported from the phone) show "Đã hết hạn" and cannot be played.
  - Recordings are limited to 5 minutes and come out as AAC on macOS. On Windows and Linux the webview records WebM/Opus, which Zalo's phone app may not play (untested).
  - A message you send shows a flat waveform until it has been played once, and the player has no seek bar.
  - Recording turns the system's echo cancellation, noise suppression and gain control off, because they cut audio from Bluetooth headsets (measured with AirPods). The first second after pressing the mic button can be quiet while a headset switches modes.
  - Allow the microphone when macOS asks; if it was denied, turn it on in System Settings, Privacy & Security, Microphone.
- **Mentions are display-only.** `@name` shows in blue, but you cannot yet pick someone with `@` while typing. Messages imported from the phone carry no mentions and no reply targets, so their quotes are not clickable.
- **Old messages are slimmed.** Beyond the newest 200 messages per chat, the app drops Zalo's duplicate copy of each message to save disk space. Replying to such an old message is rebuilt from its stored text and has not been tried against Zalo.
- **Account and settings.**
  - Changing the name, gender, birth date or avatar writes to your real Zalo account. The app validates the input and asks for one confirmation, but these calls have only been tested against a mock, never on a live account, and Zalo may limit how often some fields can change. Its error is shown as it is.
  - The banner is shown but cannot be changed: zca-js has no call for it. The phone number is display-only.
  - Not supported yet, and marked "Chưa hỗ trợ": English, start at login, notifications, privacy settings, call settings, utilities, and a "Thoát" menu item. The first three need extra Tauri plugins; use the phone app for privacy settings.
  - "Ghi nhớ tài khoản đăng nhập" off means the saved login is deleted at the next start and you scan the QR code again. Lowering the number of messages kept per chat deletes the older ones from this computer at once (not from Zalo or your phone).
- **Not implemented yet:** forwarding, labels (Phân loại), video and voice calls, files over 100 MB, searching message text (the search box only filters the conversation list).
- **macOS first.** Linux and Windows builds are released from CI, but only macOS has been run by hand. Phone sync, microphone access and audio playback are untested there.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Never commit a session file, cookie, key or message cache.

## Disclaimer

Zalo Lite does not bundle any Zalo assets, logos or code: the stylesheet, icons and application code are written from scratch, and the layout and colours follow what the real client looks like. The protocol notes in `docs/` come from studying software you have installed, for interoperability with your own account. Using unofficial clients may violate Zalo's terms of service and can get an account restricted. You are responsible for how you use it.

## License

[MIT](LICENSE)
