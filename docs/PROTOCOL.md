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
| 12028 | `/api/group/getmg-v2` | group info for many groups (`gridVerMap`), not messages |
| 11240 | `/api/group/history` | group history (`grid`, `count`). Only called on group rejoin behind feature flags; returns HTTP 404 for this client (observed live) |
| 10053 | `/api/preloadconvers/get-last-msgs` | conversation list: GET on the `conversation` service with `{threadIdLocalMsgId: JSON(map), imei}`. Reply has `msgs` (1:1), `groupMsgs` (idTo = group id), `pageMsgs` (Official Accounts), `clearUnreads`, `more`, `lastActionId` (observed in bundle and live) |
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

## History sources (confirmed against a live account, 2026-11-02)

- **Conversation preload** (`/api/preloadconvers/get-last-msgs` with an empty map) only returns activity since this device logged in. It does not list past conversations on a new device.
- **WS 510/511 offline queue** starting at `lastId: "1"` also returns nothing on a new device.
- **Group history** comes from the `group_cloud_message` service: `GET /api/cm/getrecentv2` (newest; `globalMsgId: "0"`) and `/api/cm/getoldv2` (older than `globalMsgId`), params `{groupId, globalMsgId, count, msgIds: [], imei, src: -1}`, reply `groupMsgs` (+ `hasMore`). Observed in `getCloudMessage` (cmd 12506/12507).
- **1:1 history** is only on the phone. Zalo PC pulls it with an encrypted phone-to-PC transfer: `/api/message/pull_mobile_msg` (`pc_name`, `public_key`, `from_seq_id`, `min_seq_id`, `temp_key`, `imei`), `/api/transfer-sync-v2/request-sync`, `/api/message/get_crossdb`, `/api/message/delete_snapshot_mobile_msg`. Not implemented here.
- Group-cloud calls from this client returned error **604**, which Zalo PC's error table names `Common.SESSION` (session not accepted by that service).

## Stickers (observed in the bundle)

- **Your packs**: `GET {sticker}/api/message/sticker/category/list/v2` with `params = AES("")` (cmd 12020). Reply `{dataUrl, cs, data, exCateIds}`: the pack list is the JSON array at `dataUrl` (checked by Zalo PC as `MD5(body + salt) === cs`), else the inline `data`; packs in `exCateIds` are dropped; sorted by `type` then `status` (status 4 ranks as 0).
- **Pack contents**: `GET {sticker}/api/message/sticker/category/sticker_detail` with `{"cid": "<id>"}` (cmd 11284), wrapped by zca-js as `getStickerCategoryDetail`.
- **Search / detail / send**: zca-js `getStickers(keyword)`, `getStickersDetail(ids)`, `sendSticker({id, cateId, type})`.
- Live check (2026-11-02): the group-cloud host is `tt-group-cm.chat.zalo.me`, inside the same `chat.zalo.me` cookie domain, and still returns 604 with `zpw_ver=694`. So the refusal is about the session type (zca-js logs in through the web QR flow), not missing cookies or client version. Getting group history would need Zalo PC's own login (`/api/login/reqqr` + signed `getLoginInfo`), not attempted.

## PC QR login (`server/pclogin.ts`)

Zalo PC does not use the `id.zalo.me/account/authen/qr/*` flow that zca-js uses. Observed in the 26.10.20 bundle (`getQRCode`, `Dr`, the login screen's state machine) and confirmed live on 2026-11-03:

1. **QR**: `GET https://wpa.chat.zalo.me/api/login/reqqr` (cmd 11133). Encrypted data `{language, client_time, imei, computer_name, logged_uids, self_g, qr_form}` plus `zcid`, `zcid_ext`, `enc_ver=v2`, `type=30`, `client_version=694`, `signkey`. With `self_g=0` the server returns the plain QR image; the "trusted device" variants are re-rendered by native code (`genFirstQR`/`genSecondQR`) and are avoided by sending 0.
2. **Signing**: `signkey = MD5("zsecure" + "reqqr" + values of all other query params, keys sorted)`, and the signed set **includes `zpw_ver` and `zpw_type`**. Signing without them (as `getLoginInfo` does) returns inner error **18022 Invalid Signature**. Tried and rejected live: other signing names, `type` 31, `client_version` 685/693, signing the plain fields, adding `nretry`.
3. **Reply**: the encrypted payload (key = the request's `encryptKey`) is an envelope `{error_code, error_message, data: {base64_qr, chk_wait_scan, chk_wait_cfirm, qr_timeout: 180, qr_retry: 3, token_id}}`.
4. **Wait for scan**: GET `chk_wait_scan` (`qr.id.zalo.me/polling/qr/waiting`, `&lang=vi`) is a long-poll, no params or encryption; a timeout means "not yet". Reply `{error_code: 0, data: {avatar, display_name, link_data}}`; `-20` carries a fresh `base64_qr`; `-21` and `18010` stop the flow.
5. **Wait for confirm**: GET `chk_wait_cfirm` (`qr.id.zalo.me/polling/qr/pc-status`). Reply data has `uid`, `dkey`, `zpw_sek`, `zpw_kt`, `profile`, `devices`. Zalo PC installs `zpw_sek` as its session cookie for `chat.zalo.me`.
6. The backend then opens that session with zca-js's cookie login (`imei`, cookies, user agent), using client version 694.

Not verified live: steps 4 and 5 beyond the polling behaviour (they need a phone scan), and whether the resulting session is accepted by the group-cloud service (error 604 for web-style sessions).

## Group history: what was found live (2026-11-03, PC QR session)

- The PC QR login works end to end: scan, confirm, `zpw_sek`, then zca-js cookie login at client version 694 (friends, groups, realtime all work). The session type was **not** why group history failed.
- **Error 604 on `/api/cm/getrecentv2` and `getoldv2` is cured by adding `nretry=0` to the query** (Zalo PC sends it on every request). Nothing else changed the answer: not `g`-prefixed ids, POST, other params, or the host.
- With `nretry`, the service replies normally (`error: 0`) but returns **no messages**: `groupMsgs: []`, `isFiltered: 1`, while `minMsgId`/`maxMsgId` show a message range exists. Groups with no messages report `lastMsgId: "0"`, `isFiltered: 0`. Paging (`getoldv2` from the reported ids, other `count`/`src`, other start ids) changes nothing.
- Zalo PC's built-in defaults have `cloud.enable: false`; the server config (`getServerInfo`) sends this client no `cloud` block, with either `computer_name: "Web"` or the machine name. So cloud history looks disabled for this client by design, and Zalo PC itself loads a new device's history through the **phone-to-PC transfer** (`/api/message/pull_mobile_msg`, `/api/transfer-sync-v2/request-sync`, `get_crossdb`), which is not implemented here.
- `/api/preloadconvers/get-last-msgs` is also unchanged by `nretry` (only activity since this device logged in).

## Phone-to-PC message transfer (static analysis of Zalo PC 26.10.20, not yet exercised)

How Zalo PC loads a new device's history (`lazy/main-startup.*.js` sync service, `shared-worker.*.js`, `native/nativelibs/db-cross-v4`):

1. **Key pair (plain JS)**: a session generates `RSA-2048`, public key as base64 SPKI DER, private key as PKCS#1 PEM, with a TTL (`cross_setting.timeoutKey` hours).
2. **Ask the phone**: `GET {file}/api/message/pull_mobile_msg` with encrypted `{pc_name: hostname, public_key, from_seq_id, is_retry, min_seq_id, temp_key, imei}` (cmd 12000). Related: `get_crossdb` (`{pc_name, sync_session}`, 12412), `get_backupmsginfo` (12096), `delete_snapshot_mobile_msg` (12003), `transfer-sync-v2/request-sync` (`{reqId, data}`, 12888), `cancel_pull_mobile_msg` (12700).
3. **Websocket side**: commands in the `SYNC_MESSAGE` family (`REQUEST`, `REQUEST_MOBILE_WAKE_UP`, `ACK_DELETE_SYNC_SESSION`) and a newer `BACKUP_MSG` family (`CREATE_SESSION`, `INIT`, `GET_METADATA`, ...). Numeric command ids were not resolved. The phone must be online and is woken up; an event (`syncmsg_info`, with `transfer_error` on failure) announces the result.
4. **The backup**: the event carries `{name, url, checksum, encryptedKey, format (0|1), numberOfMessagesCount, numberOfConversationsCount}`. Zalo PC downloads `url` (with cookies), unwraps `encryptedKey` with the RSA private key (`RSA_PKCS1_PADDING`, hex or base64 per `format`), then calls the native add-on.
5. **Native add-on** (`db-cross-v4-native.node`, a standard N-API module): `decompressAndDecryptDb(in, out, key)` for format 0 (one database file) and `decompressAndDecryptDb_V2(in, outDir, KEY_UPPERCASE, progressCb)` for format 1 (a folder of per-conversation databases). Its symbols show **mbedTLS AES** tables (`FSb`, `FT0`..`FT3`, `KT0`..`KT3`) and the **7-Zip LZMA SDK**, plus an MD5 check and a custom file header ("read header fail", "Incorrect key length"). Nothing proprietary beyond the container layout.
6. **Restore**: Zalo PC's JS (`RESTORE_CONVERSATIONS`, `RESTORE_MESSAGES` in `shared-worker`) reads those databases and imports them. Schema not yet read.

Open items before any implementation: the websocket command ids, what the phone prompts the user with, the container header/AES mode, and the restore schema.

### Transfer handshake, live result (2026-11-03, PC QR session, nothing downloaded or imported)

- `get_backupmsginfo` returns HTTP 404 on `tt-files-wpa.chat.zalo.me` (retired or not for this client).
- `pull_mobile_msg` (fresh in-memory RSA key, `from_seq_id: 0`, `nretry=0`, version 694) is **accepted**: HTTP 200, `error_code 0`, reply data is a plain string.
- Within about a minute the realtime socket delivered one unknown event, **cmd 621 / subCmd 0** (`error_code 0`, "Success", `data` is a string), which the realtime listener does not decode. This is the first candidate for the sync status event.
- `cancel_pull_mobile_msg` is accepted afterwards.
- Not yet known: what the phone showed, and the decoded contents of the reply string and of event 621.
