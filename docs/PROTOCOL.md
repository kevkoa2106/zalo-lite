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

## Phone-to-PC message transfer (static analysis of Zalo PC 26.10.20; exercised live, see the working end-to-end notes below)

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

#### Handshake, decoded (same day, three runs)

- The phone **does show a sync prompt** after `pull_mobile_msg`.
- The reply to `pull_mobile_msg` and to `cancel_pull_mobile_msg` is an **empty string**: a bare acknowledgement.
- **Event 621/0 is not the sync event.** Its decoded payload is `{"mycloudMedia": {...}}` (a few numeric limits and a short token): My Cloud media settings, which arrive a few seconds after the connection/request regardless.
- With the prompt left unanswered, no backup information arrived within about 60 s. The sync notice (`syncmsg_info`, `transfer_error`) is therefore expected only after the phone accepts, and probably as an `act` inside the control-event commands (601/602), which the first probes deliberately skipped.
- Next observation to make: accept the prompt once and log the `act` names of 601/602 events (names and counts only).

#### Handshake, runs 5 and 6 (control events and a quiet run)

- The sync notices are **control events** (command 601, `act_type` `syncmsgmb`), as suspected. In run 5, with the prompt accepted, three arrived within about 6 s of the request: `syncmsgmb/user_confirm`, `syncmsgmb/syncmsg_info` (a ~1.5 KB string) and `syncmsgmb/transfer_error` (fields: `public_key`, `pc_name`, `can_retry`, `error_msg`, `error_code`). Their contents were not yet decoded (printed as "string" only), and `transfer_error` arriving together with the info suggests the transfer failed or was refused.
- Run 6 (decoding in place) saw **none** of them: the request was acknowledged (empty string), only a routine command 524 event (the same shape as the conversation preload, empty) arrived twice, and `delete_snapshot_mobile_msg` answered 212 "not found", so no backup was created. Possible causes: Zalo throttling repeated requests, the phone not prompting this time, or the account being in a cool-down after the earlier accepted transfers. Not determined.
- Earlier runs created server-side snapshots for RSA keys that were thrown away; they cannot be decrypted and should expire on Zalo's side.

#### Phone-to-PC transfer: working end to end (2026-11-04)

Implemented in `server/transfer.ts` (flow) and `server/crossdb.ts` (backup reader); started from the settings menu ("Đồng bộ tin nhắn từ điện thoại") or the `phone_sync` op. One accepted request produced a 5.7 MB backup of 59,854 messages in 94 chats.

1. `pull_mobile_msg` (fresh RSA key) -> phone prompt -> control events (cmd 601, `act_type` `syncmsgmb`): `user_confirm`, then `syncmsg_info`, then `transfer_error` with `error_code 0` and `can_retry 1`, which is only a completion marker, not a failure.
2. `syncmsg_info` (`data` is URL-encoded JSON) carries `url`, `file_name`, `checksum_code` (MD5 of the download), `file_size`, `encrypted_key`, `public_key`, `device_name`, `is_full_transfer`, and `db_info` (itself a JSON string: `db_format`, `backup_db.msg_total`, `backup_db.msg_thread`, `min_time_msg_at_all`, `db_encrypt_type`).
3. **Download**: `GET https://trans-bin.zaloapp.com/download/<a>/<b>` answers HTTP 400 (empty body) unless the request carries `Cookie: zpw_sek=<session cookie>`. The host is outside the `zalo.me` cookie scope, so the cookie header is added by hand. The MD5 matched `checksum_code`.
4. **Key**: `encrypted_key` is base64 RSA-PKCS#1 v1.5 encrypted to our public key. Bun refuses `RSA_PKCS1_PADDING` for private decryption, so decrypt with `RSA_NO_PADDING` and strip `00 02 <random> 00`. The result is the secret as hex (format 1) or base64 (format 0).
5. **Decrypt**: Zalo PC's own `db-cross-v4-native.node` (the installed app's `app.asar.unpacked`, arm64 or x64) loads in Bun with `process.dlopen`. Format 1: `decompressAndDecryptDb_V2(file, outDir + "/", SECRET_UPPERCASE, progress)`; the output directory needs a **trailing slash**, otherwise file names are glued onto the folder name.
6. **Layout**: one plain SQLite file per chat: `<id>.db` (person) or `group_<id>.db`. Table `ChatContent(SenderId, CliMsgId, GlbMsgId, MsgStatus, MsgType, TimeStamp ms, TTL, MsgContent, RefCliMsgId, BinNet, LocalPath, SeqId, FLStatus, E2EE)`, primary key (SenderId, CliMsgId). Ids exceed 2^53 elsewhere, so read them with `CAST(... AS TEXT)`. `BinNet` is parsed by the library's `parseBinNet(blob)` into `{data: {attachs: [...]}}`; media, stickers and calls keep their content only there.
7. **Short ids**: file names and `SenderId` are 9-digit "noise" ids. `POST https://zwid.api.zalo.me/api/znoise?zpw_ver=694&zpw_type=30` with `params=<AES {"fids":[...]}` (users) or `{"gids":[...]}` (groups), ids as bare JSON numbers, returns the real ids in the same order (groups may carry a `g` prefix). Verified by cross-checking message ids of six chats that already existed in the app.
8. **Types** (`MsgType`): 0 text, 2 doodle, 3/4/31 photo, 6 voice, 10 sticker, 12 recommended (links, contacts, and **calls**: actions `recommened.calltime` / `recommened.misscall`), 15 OA, 18 location, 19 video, 22 file, 23 gif, 24/53 web content. Zalo PC skips 20, 21, 25, 26, 29, 32, 34, 35, 45, 51, 52 on restore (group notices, polls, ...); 33 and 36 are delete/undo markers.
9. **Calls**: `params` JSON `{duration, calltype (1 = video), isCaller, reason, isEnableCallback}`. Titles follow Zalo PC: incoming connected "Cuộc gọi thoại/video đến" plus the duration; missed "Bạn bị nhỡ"; `reason 3` on a miss "Bạn đã từ chối"; outgoing "đi", "Bạn đã hủy" (reason 4/5), "Người nhận từ chối" (3), "Người nhận bận" (1).
10. **Quirk**: after `delete_snapshot_mobile_msg`, the phone answers a new request at once with its cached reply, whose download then returns 404 because the file is gone. Keep the decrypted copy until the import has succeeded (`phone_sync` with `resume: true` re-imports it).

Import policy: the history is a cache. `server/index.ts` keeps the newest `ZL_CACHE_PER_CHAT` (default 3000) messages per chat, so the import brings in at most that many per chat; the download and decrypted databases live under `<data dir>/cache/transfer` and are deleted afterwards.

#### Backup container format, from the decompiled Zalo PC library (2026-11-07)

Source: static analysis of `db-cross-v4-native.node` (arm64, not stripped: functions `_decode_stream`, `DecompressAndDecryptDb_V2`, `decompress_file`, `read_header`, `ZCUtil::DecompressProcessV2`, `parse_bin_net`, `ParseAttachChatMsg`) with Ghidra 12.2 headless. The library is a thin wrapper around three public pieces: AES (128-bit, CBC and CFB), the 7-Zip LZMA SDK (`LzmaDec`) and liblzma (`lzma_stream_decoder`). Not yet verified against a real backup: every statement below comes from reading code.

**Layer A, per file (`_decode_stream`): AES-128-CBC then LZMA1.**
1. `key16` = the first 16 bytes of the **ASCII hex MD5 of the secret string** (the secret is the RSA-unwrapped `encrypted_key`: hex for format 1, base64 for format 0; the V2 entry point passes it upper-cased).
2. Optional first 4 bytes (read only when the caller's version int is not negative).
3. 64 bytes: the stored MD5 text of the data. Only the first 32 bytes are used, XORed byte for byte with the 32 ASCII chars of the key's MD5 hex. It is printed as "MD5 read from encrypted file".
4. 16 bytes: the CBC **IV**.
5. Ciphertext in 16-byte blocks, AES-128-CBC. The first decrypted block starts with the 13-byte "LZMA alone" header: 5 bytes of LZMA properties, then the 8-byte little-endian uncompressed size (0 is an error, all-ones means unknown size). The remaining bytes of that block are LZMA data.
6. Plaintext is fed to `LzmaDec_DecodeToBuf` in chunks of up to 64 KB while an MD5 of the decrypted (compressed) bytes is accumulated, compared against the stored MD5.
7. **Ending:** when a read returns fewer than 16 bytes, its first byte's low nibble says how many bytes of the last decrypted block are valid (0 means all 16). That short trailer is not decrypted.
- Error codes seen: -1 bad arguments, -2 cannot read input, -3/-4/-5/-6 short reads, -7 cannot write, -8 zero size.

**Layer B, the archive that Layer A yields (`decompress_file`).** All integers are big-endian.
- bytes 0..5: 6 bytes of magic or version (not yet identified).
- offset 6: `u32 headerEnd` (at least 14).
- offset 10: `u32 xxhash32` of bytes `[14, headerEnd)` (seed 0), checked before anything else.
- offset 14: `u32 fileCount`, then `fileCount` entries: `u32 nameLen` (at most 128), the name bytes, `u32 size` (at most 2 billion). Names are the per-chat file names (`<id>.db`, `group_<id>.db`).
- From `headerEnd` to the end: one **XZ stream** (`lzma_stream_decoder`, concatenated mode). Its decompressed bytes are the files back to back, split by the `size` fields in order.

**Not yet read:** the 6-byte magic, whether the V2 path wraps these two layers differently from V1 (`DecompressAndDecryptDb`, format 0), the `parse_bin_net` / `ParseAttachChatMsg` message format (1,304 + 806 lines of pseudocode), and the exact padding rule on a final block that is exactly 16 bytes long.

**Decoders for a native-free reimplementation (checked on npm, 2026-11-07):** `lzma1` 0.8.0 (pure JS, MIT or Apache-2.0, decodes the 13-byte-header "LZMA alone" layout used by Layer A) and `xz-decompress` 0.2.3 (WebAssembly, MIT, 52 KB, decodes the Layer B XZ stream). Neither is added to the project yet.

**Tooling note:** the Homebrew Ghidra package ships no native decompiler for Apple silicon. It was built from the bundled source (`Features/Decompiler/src/decompile/cpp`, with `-arch arm64`) and placed at `Ghidra/Features/Decompiler/os/mac_arm_64/decompile`. REA 6.4.0 rejects Ghidra 12.2 (it wants 12.1.x), so the analysis ran through `analyzeHeadless` with a small script that dumps every function's pseudocode.

#### Correction and verification (2026-11-07, tested on a real backup)

The "Layer A" above (AES-128-CBC with an MD5-derived key, LZMA1) is the **format 0** path (`DecompressAndDecryptDb`, `_decode_stream`). A format 1 backup (`db_format` 1, what the phone sends today) takes a different path (`CrossBackupFormat1::decrypt`):
- **Decrypt in place, then unpack.** `decrypt_file` rewrites the downloaded file in place: AES with a 256-bit key (`AES::AES(0x100)`, a standard Rijndael implementation), CBC, a **zero IV**, in chunks of 65,536 bytes (the IV is restarted for each chunk), key = the first 32 bytes of the key string passed in. The first decrypted chunk must start with `ZDB4.0`; if not, it fails. The unpack step is then Layer B below. **Not yet verified:** the library overwrote the first captured download before it could be copied, so the AES details above come from reading code and are untested. A trial with the first 32 characters of the uppercase hex secret as the key could not be checked for that reason.
- **Layer B is verified.** The decrypted file starts `ZDB4.0\0`. `u32 BE` at offset 6 is the length of the hashed region (it covers the file list **and the XZ payload**, not only the header; the real file has 132 more bytes after it); at 10 the XXHash32 (seed 0) of bytes `[14, that length)`; at 14 the file count (95 in the test backup); then per file `u32 nameLen`, name, `u32 size`. The XZ stream starts right after the last entry (at 2,048 in the test backup, magic `fd 37 7a 58 5a 00`) and runs to the hashed length. Decoding it gave exactly 40,873,984 bytes, and **all 95 files were byte-identical to what Zalo PC's own library wrote**.
- Implemented as `unpackArchive` in `server/crossdb-native-free.ts` with `xz-decompress` (WebAssembly, MIT); tests include a byte-for-byte check against a local fixture when one exists.
- **Gotcha for fixtures:** because the library decrypts in place, a capture must copy the download *before* calling it (`ZL_KEEP_FIXTURE=1` now writes `backup.enc` first, then `backup.dec` and `oracle/`).
- **Still open:** confirm the AES step on a real encrypted download (one more phone accept), the `parse_bin_net` message-blob format, and wiring all of it into `server/transfer.ts`. The oracle databases already in the fixture contain every BinNet blob, so the parser can be developed without another capture.

#### Message blobs ("BinNet"), verified (2026-11-07)

`ChatContent.BinNet` is a list of TLV records: `u32 BE tag`, `u32 BE length`, value, nested for containers. Implemented as `parseBinNet` in `server/binnet.ts`; on all 59,965 blobs of a real backup its output equals Zalo's library output exactly.

| Container tag | Becomes | Fields (tag: name, type) |
|---|---|---|
| 5 | `property` | 30 size, 31 subType, 32 type (i32); 33 ext (string, JSON text) |
| 6 (repeats) | `attachs[]` | 40 type (string), 41 catId, 42 id, 44 childNumber (i32); 43 extInfo, 45 action, 46 params, 47 title, 48 href, 49 thumb, 50 description, 66 remains, 67 zinstantData, 68 zinstantMsg (strings) |
| 7 | `quote` | 80 ownerId, 83 cliMsgType (i32); 81 cliMsgId, 82 globalMsgId, 84 ts, 85 ttl (i64); 86 msg, 87 attach, 88 fromD (strings) |
| 8 (repeats) | `mentions[]` | 100 type, 101 uid, 102 pos, 103 len (i32) |
| 11 | `reference` | 170 type (i32), 171 data (string) |

Integers are signed big-endian (`childNumber` is -1 when unused); `i64` values come out as JSON numbers like the library's. Other top-level tags (10, 15, 17 and their children) carry sender display data and extras that the library does not return in `data`, so they are ignored. Method: infer tag-to-field pairs by matching each record's value against the library's parsed JSON over a sample, write the tables, then compare over every blob and fix the differences (the quote `ttl` and three rare attachment fields were the only gaps).

#### AES step, verified; no native library needed (2026-11-07)

On a second capture (the encrypted download saved before Zalo's library could overwrite it), the format 1 decryption was confirmed: **AES-256-CBC, no padding, key = the first 32 ASCII characters of the upper-case hex secret, zero IV restarted at the start of every 65,536-byte chunk**. The result is byte-identical to Zalo PC's output up to the hashed length; the bytes after it (a short unused tail) are not decrypted. The lower-case secret, the hex-decoded secret and a chained IV all fail the `ZDB4.0` magic check. Implemented as `decryptBackup` in `server/crossdb-native-free.ts`; `server/transfer.ts` now decodes backups with its own code (decrypt, unpack, parse) and falls back to Zalo PC's library only when the header hash or size check fails. A test runs the whole chain on a real download against the library's output. The archive's file names are checked before they touch the disk (no path separators, no leading dot).

## Voice messages and voice calls: feasibility notes (2026-11-08, read-only, nothing sent to Zalo)

### Receiving voice messages (done)
- Stored voice rows (40 checked, key names only): `attach.href` plus `attach.params` with `duration` (integer, milliseconds, 1.5 s to 290 s), `m4a` (a URL ending `.aac`, present on all 40), `waveformSamples` (23 integers, 0 to about 23,000, on 28 of 40) and `fileSize` (27 of 40). Older messages have only an `.amr` `href` (13 of 40); the `.aac` copy is what the UI plays.
- Hosts seen: `f1-voice-talk`, `f2-voice-talk`, `f2-voice-aac-dl`, `voice-aac-dl` on `zdn.vn`.

### Sending voice messages (not built; two unknowns)
- zca-js `sendVoice` posts to `/api/message/forward` (users) or `/api/group/forward` (groups) with `msgType: 3` and `msgInfo = {voiceUrl, m4aUrl, fileSize}`. It only forwards an **already hosted** URL (it does a HEAD request for the size) and has no upload step and no duration or waveform field.
- zca-js `uploadAttachment` accepts any extension not listed in the server's `restricted_ext_file`, so an `.aac` recording uploads as an ordinary **file** message. Whether the file host's URL is accepted as a `voiceUrl`, and which endpoint Zalo PC uses to upload a real voice message, is **unknown** and needs a live experiment (a new request to Zalo).
- Recording: macOS needs `NSMicrophoneUsageDescription`; Tauri merges a `src-tauri/Info.plist` into the bundle (Tauri docs, "Extend macOS native configuration in Info.plist"). Windows and Linux webview microphone behaviour is not verified. WebView2 and WebKitGTK usually record `audio/webm;codecs=opus`, Safari/WKWebView `audio/mp4` (AAC); Zalo's own voice files are AAC, so a Windows or Linux recording would need converting, which means a dependency.
- Fallback with no unknowns: send the recording as a normal file attachment through the existing `files` op.

### Voice calls: what Zalo PC uses (static, strings only)
- Calls run in a separate native process: `Zalo.app/Contents/ZaloHelper.app/Contents/MacOS/ZaloCall` (35.6 MB, universal) plus the Node addon `app.asar.unpacked/native/nativelibs/zcall/zcall_mac.node` (7.4 MB, x86_64 only).
- Both are built on WebRTC (string counts in `ZaloCall`: about 1,680 `webrtc`, 665 `rtp`, 188 `turn`, 117 `opus`, 71 `srtp`, 68 `ice_`, 68 `echo`, 34 `audio_processing`, 323 `h264`, 14 `vp8`) with Zalo's own `zrtc` layer (about 1,340 hits). No `stun:` or `turn:` literals are in the binary, so the relay servers come from signalling at call time.
- Signalling (ring, answer, hang-up, relay credentials) travels through Zalo's servers via the main app. Its command numbers and payloads are **not documented here**, and zca-js has no call API or call events. Chat history already records finished calls (`recommened.*` actions).
- Not done (needs you at a phone): a passive capture of unknown realtime events while the account is rung once.

### Verdict (spike only; no call code written)
- **Voice message playback:** done.
- **Voice message recording and sending:** feasible but unverified; go only after one approved live experiment on the upload endpoint. The file-attachment fallback is safe.
- **Voice calls:** **no-go for now.** It needs the undocumented signalling reverse-engineered from the Zalo PC bundle, plus a WebRTC stack that interoperates with Zalo's `zrtc` layer, TURN credentials, echo cancellation and microphone permissions on three operating systems. That is a project of its own, far from "lightweight", and the whole media stack would run in the user's webview on low-end machines.

### Voice message sending: live experiment (2026-11-08, own "My Documents" chat only)
- A 2-second AAC (ADTS, 16 kHz mono, 2,430 bytes) was uploaded with zca-js `uploadAttachment` as `voice.aac`. The reply was an ordinary file upload (`fileType: "others"`) with `fileUrl` on `f41-zfcloud.zdn.vn`.
- That `fileUrl` was then passed to `sendVoice` as `voiceUrl`. Zalo accepted it (reply `{msgId}`) and the realtime echo was a **`chat.voice`** message whose params keys were only `fileSize` and `m4a`. So the file host's URL works as a voice message: no separate voice upload endpoint is needed.
- Missing from a message sent this way: `duration` and `waveformSamples` (received voice messages carry both, see above). The `sendVoice` payload has no field for them. The UI therefore shows 0:00 and a flat waveform for such messages unless the client reads the length from the audio itself. Whether Zalo accepts `duration` and `waveformSamples` added to `msgInfo` is untested.
- Not verified: that the message plays on the phone and in Zalo PC (check the "My Documents" chat), and recording format conversion (see above).
