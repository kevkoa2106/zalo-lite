# Zalo messaging protocol map

Source: static analysis of Zalo PC **26.10.20** for macOS (`/Applications/Zalo.app/Contents/Resources/app.asar`, extracted with `@electron/asar`). Main logic lives in `pc-dist/sync-v2-sub-worker.*.js` (minified webpack bundle). Byte offsets below point into that file.

Each entry says whether it was **observed** in the bundle, or **inferred** (from the open-source `zca-js` client, which implements the same protocol and is what this project uses on the wire). Nothing here was captured from live traffic.

## Hosts

| Role | Host | Evidence |
|---|---|---|
| Auth / login | `https://wpa.chat.zalo.me` (`authDomain`) | observed: `Q(11133,"/api/login/reqqr")` registers login paths on `authDomain` (@2932334) |
| QR login (web flow) | `https://id.zalo.me/account/authen/qr/*` | inferred (zca-js `loginQR`); the PC build signs QR login through `/api/login/reqqr` instead |
| 1:1 chat | `tt-chat*-wpa.chat.zalo.me` | observed: `domainType: CHAT` for `/api/message/sms` (@14706410); concrete hosts come from `zpw_service_map_v3` in `getLoginInfo` |
| Group chat | `tt-group-wpa.chat.zalo.me` | observed: `domainType: GROUP` for `/api/group/sendmsg` |
| Files | `tt-files-wpa.chat.zalo.me` | inferred from service map |
| Realtime | `wss://ws*-msg.chat.zalo.me/?zpw_ver=…&zpw_type=…&t=<ms>` | observed: `new WebSocket(this._config.url+"&t="+e)`; URL list is `zpw_ws` from `getLoginInfo` |

Hosts are **not hard-coded**: `getLoginInfo` returns `zpw_service_map_v3` (service → host list) and `zpw_ws` (socket URLs), applied with `setEndpoints(zpw_chts_new, zpw_ctrs_new, …, zpw_conf, zpw_ws)` (@14221854).

## Common query params

Every API call carries `zpw_ver=<apiVersion>` and `zpw_type=<apiType>`. Observed in the config block (@7983210): `apiVersion: 694`, `apiType: 30` (31 for the embed bundle), `secretKey: "zpw_enk"`.

## Login

1. **QR**: `reqqr` (cmd 11133) on PC; the web flow used here is
   `generate` → long-poll `waiting-scan` (returns scanner avatar + display name: the *confirm* screen) → long-poll `waiting-confirm` → `checksession` → `userinfo`. Cookies (`zpw_sek`, …) land in the cookie jar. *(inferred)*
2. **Signed bootstrap**: `GET {authDomain}/api/login/getLoginInfo` with `imei`, `computer_name`, `language`, `ts` (@14667649), encrypted by **ParamCipher** (observed @14652561):
   - `zcid = UPPER(hex(AES-256-CBC(key=PARAM_CIPHER_KEY, iv=0, "type,imei,firstLaunchTime")))`. The key string `3FC4F0D2AB50057BCE0D90D9187A22B1` appears in the bundle.
   - `zcid_ext` = random hex string (6–12 chars).
   - `encryptKey = even(MD5(zcid_ext).upper)[0:8] + even(zcid)[0:12] + reverse(odd(zcid))[0:12]`.
   - Sent as `zcid`, `zcid_ext`, `enc_ver=v2`, `params=<AES(encryptKey, json)>`.
3. Response (decrypted) carries `zpw_enk` (the session **secret key**), `uid`/`dkey`, `zpw_service_map_v3`, `zpw_ws` (observed: `decryptKey: e.data.data.zpw_enk` @11719538).
4. Logout: `/api/login/logOut` (cmd 11135).

## Request / response encryption

Observed (@14706410): `body = "params=" + encodeURIComponent(encodeAES(JSON.stringify(params)))`.
`encodeAES` = AES-256-CBC, key = base64-decoded `zpw_enk`, IV = 16 zero bytes, base64 output. Responses come back as `{error_code, data}` where `data` is the same cipher; decrypt and `JSON.parse`.

## Messaging endpoints (command id → path)

From the endpoint registry around @2911584 (all observed):

| Cmd | Path | Use |
|---|---|---|
| 11151 | `/api/message/sms` | send text to user (`toid`, `message`, `clientId`, `imei`, `ttl`) |
| 11163 | `/api/group/sendmsg` | send text to group (`grid`, `visibility`) |
| — | `/api/message/quote` | reply with quote |
| 11154 | `/api/message/sticker` | sticker |
| 11286 | `/api/message/link` | link preview message |
| — | `/api/message/photo_original/upload`, `/photo_original/send` | images |
| — | `/api/message/asyncfile/upload`, `/asyncfile/msg` | files |
| 11144 | `/api/message/typing` | typing indicator |
| — | `/api/message/seenv2`, `/deliveredv2` | read / delivered receipts |
| — | `/api/message/reaction` | reactions |
| — | `/api/message/undo`, `/multi_undo`, `/delete` | recall / delete for me |
| — | `/api/message/forward`, `/mforward` | forward |
| — | `/api/group/getmg-v2` | group history page |
| — | `/api/preloadconvers/get-last-msgs`, `/get-last-seen` | conversation list preload |
| — | `/api/conv/getUnreadMark`, `addUnreadMark`, `removeUnreadMark` | unread mark |
| 11770 | `/keepalive` | HTTP keepalive |

## WebSocket frames

Observed (`_getHeader`, `_processEventBlob`, `_onRawData`, `_decrypt`, `_decompress`):

- Frame = 4-byte header + UTF-8 JSON. Header: `u8 version`, `u16 LE cmd`, `u8 subCmd`.
- JSON: `{ error_code, encrypt, data, key? }`.
- `cmd 1` (AUTHEN) carries `key` → stored as `_cipherKey`.
- `encrypt`: `0` = plain JSON object; `1` = base64 only; `2` = base64 → AES-GCM → zlib inflate; `3` = AES-GCM, no inflate.
- AES-GCM layout after base64: `iv = bytes[0:16]`, `additionalData = bytes[16:32]`, `ciphertext+tag = bytes[32:]`, 128-bit tag, key = base64-decoded `_cipherKey`.
- `cmd 2` = ping (`subCmd 1`, `{eventId: Date.now()}`), interval from server config.
- Event commands (inferred from zca-js listener): `501` user messages, `521` group messages, `601` control events (seen/delivered/typing/upload), `612` reactions, `510`/`511` request older user/group messages (`{first, lastId, preIds}`), `3000` duplicate connection (another web/PC session took over).

## What this client uses

`server/` (Bun) talks to Zalo through `zca-js`, which implements every step above. The Tauri app (`src-tauri/`) starts that server as a sidecar, and the UI (`src/`) talks to it over a local WebSocket guarded by a random token.
