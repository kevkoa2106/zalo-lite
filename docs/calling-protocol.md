# Calling protocol investigation

This is an offline trace of Zalo 26.11.10 (build 26.11.10.3400), inspected on 2026-11-14. It establishes a signaling boundary and a test harness, **not working voice or video calls**. No reference application code was executed, native calling helper launched, account secrets read, endpoint contacted, call placed, or device captured during this investigation. A consenting second account/device is still required for interoperability testing.

Labels used below:

- **Observed** means present in the pinned shipped bytes or local source. It does not mean execution was observed.
- **Inferred** means a proposed interpretation or integration choice supported by those observations.
- **Unknown** means the available evidence does not establish the contract. A named probe describes the next observation needed.

## Reference identity and evidence limits

| Artifact | SHA-256 |
| --- | --- |
| `/Applications/Zalo.app/Contents/Resources/app.asar` | `9217d0e419c4f2b89033cf23e89073de0052d7417e6e16270afc2d68e31896d2` |
| Renderer: `pc-dist/compact-app-pc.cfeba43a9a8e4e40dda3.js` (21,676,308 bytes) | `42776e94434246d4f4089cacbb63adf781a55c0436c7d11d452f3221fa1a664e` |
| Main: `main-dist/main.js` (4,365,792 bytes) | `328f2d2c12101b965a738559f6e7c3e48d2e1fd0e956bef4e44fde84e2019c43` |
| Current helper: `Contents/ZaloHelper.app/Contents/MacOS/ZaloCall` | `ad1c7b44ab149c9f7697e19c5484072f6facb6edcec4ef9b1cf580ddf80e6101` |
| Legacy addon: `Contents/Resources/app.asar.unpacked/native/nativelibs/zcall/zcall_mac.node` | `537bceb12c80264ac3b5bc9b0ea3547b6ce446db5ff44f5dce0e26c7cff98783` |

The existing REA application analysis is Evidence `ev_f932b38e53add70e450197f3e245f871d2d9fa680b9269a7e28e558c7cba9ab7`. Its summary is `ev_2f1302399998076fcedb602946340a7c46ffe93a1cb46a95340d45028f89aaf8`. Application and semantic coverage are partial, with resource limits and unresolved relationships. The summary view being exhausted does not make application coverage complete.

Archive integrity metadata contradicts observed unpacked native bytes, including the legacy addon. Its digest records the observed file, not trusted provenance. No decompiler result for that addon is asserted here.

The focused trace below was checked directly against the retained renderer/main source bytes and their digests; it is additional static-source evidence, not a new REA Evidence record. Source copies, manifests and private investigation excerpts remain local research and are excluded from Git in this workspace. Only original implementation, synthetic fixtures and sanitized descriptions belong in the product. The historical string-only calling notes in [PROTOCOL.md](PROTOCOL.md) are not proof of a current live media contract.

All offsets below are zero-based **UTF-8 byte offsets in the named extracted source**, not character positions, archive offsets, or native addresses. `R` means the renderer artifact above; `M` means main.

| Source | Location | Contract observed |
| --- | --- | --- |
| R 8,351,193 | `OU7N` module | Current renderer call helper |
| R 8,355,373 | `startListeners` | Binds control polling, native signals, requests and updates |
| R 8,357,322 | `handleUpdate` | Native call state, device list and completed-call bubble updates |
| R 8,357,841 | `handleSendSignal` | Native signal → high-level API method mappings |
| R 8,363,163 | `handleRecvSignal` | API result → native `recvSignal` envelope |
| R 8,363,448 | `handleControl` | Incoming control filtering and native forwarding |
| R 8,364,076 | `eventFromCtrlPolling` | Polling callback → per-item `handleControl` |
| R 8,366,185 | `makeCall` | Outgoing native request and one-to-one media-type selection |
| R 8,372,459 | `endCall` | Explicit native end request |
| R 14,596,706 | `bindCallbackVideoCall` assignment | Stores callback used by control dispatch |
| R 14,600,224 | `_processCtrlMessages` definition | Groups decoded `controls[].content` and parses string data |
| R 14,658,793 | High-level `requestCall` and following call methods | Raw HTTP request → shared response decoder |
| R 15,056,153 | Common-parameter initialization | `zpw_ver`, `zpw_type` |
| R 15,058,049 | `_getCommonParams` | Serializes common parameters |
| R 15,060,617 / 15,062,027 | `_request` / `_get` | Credentialed GET, timeout and command telemetry |
| R 16,593,502 | `kCOK` module | HTTP, outer envelope and encrypted inner envelope decoding |
| R 18,027,599 / 18,029,420 | `getDomainByType` / `getVoiceCallDomain` | Selects active `VOICE_CALL` service domain |
| R 20,752,127 | `setDecryptKey` assignment | Stores current session parameter-encryption key |
| R 20,753,001 / 20,753,526 | `decodeAES` / `encodeAES` | Session-key AES-CBC wrapper |
| M 315,208 | `3Zc2` module | Current native helper bridge |
| M 316,350 / 316,998 | Native dispatch / receive framing | Routes native messages and decrypts framed JSON |
| M 317,949 | Helper launch and IPC setup | Selects platform helper and creates local sockets |
| M 321,396 | `configure` | Electron `call-init` and `call-send-to-native` bindings |

## Outgoing signaling

**Observed:** the renderer chooses one-to-one audio type `1` or video type `3`, builds a native `request/makeCall` envelope containing `partner` objects (`id`, `avatar`, `name`), `type` and `groupInfo`, then sends it through `$zcall.sendDataToNative`. The helper excludes the local user from the partner list. Group types `5`/`6` exist but are outside this implementation.

The native engine subsequently emits `sendSignal`. Main forwards the command and data on `call-send-signal`. `OU7N.handleSendSignal` invokes a high-level API method, whose raw request builder uses the fields below. Fields are descriptions of the producer contract, not sample account values.

| Native signal | GET suffix under `/api/voicecall/` | HTTP command identifier | Request builder (R byte) | Plain parameters before encryption |
| --- | --- | --- | --- | --- |
| 401 | `requestcall` | 11300 | 15,123,284 | `calleeId`, `callId`, `codec` (nullish default `"[]"`), `typeRequest` from native `type`, `imei` |
| 416 | `request` | 11301 | 15,123,592 | `calleeId`, `rtcpAddress`, `rtpAddress`, `codec`, `session`, `callId`, `imei`; truthy `extendData` adds `extendData` and `subCommand: 3` |
| 407 | `ringring` | 11302 | 15,123,951 | `callerId`, `callId`, `status: 0`, `imei` |
| 402 | `answer` | 11303 | 15,124,227 | `callerId`, `callId`, `status`, `codec` (falsy default empty string), `rtcpAddress`, `rtpAddress`, `session_id` from native `session`; truthy `extendData` adds it and `subCommand: 3` |
| 408 | `answerack` | 11304 | 15,124,571 | `calleeId`, `callId`, `status: 0`, `imei` |
| 405 | `cancel` | 11305 | 15,124,849 | `callerId` from native `toId`, `callId`, `callType`, `status: 0`, `imei` |
| 409 | `endcall` | 11306 | 15,125,134 | `uidTo` from native `toId`, `callId`, `status: 3`, `imei` |
| 406 | `logendcall` | 11311 | 15,126,321 | `call_id` from `callId`, `partner_id` from `partnerId`, `status`, `logdata` from native `data`, `duration`, `role`, `imei` |

These are three different namespaces: native helper signals such as `401`, HTTP command/telemetry identifiers such as `11300`, and realtime socket header commands such as `601`. Sending a helper signal number as a socket opcode is unsupported.

**Unknown:** equality between `makeCall` types `1`/`3` and native-emitted `type`/HTTP `typeRequest` is not established through the native engine. Treat a direct `requestcall` type probe as a candidate, not a supported full dialing implementation. Call-ID generation, native `callType`, codec negotiation, statuses and session material also remain engine-owned unknowns. Do not synthesize them from timestamps or assign decline/busy meanings to arbitrary integers.

### Host, encryption and replies

**Observed:** `getVoiceCallDomain()` selects `VOICE_CALL`, whose active domain comes from the service map. The domain manager also contains a development override when `useApiVoiceCallLive` is false; this is not a production endpoint to hard-code. `setEndpoints` consumes `voice_call` from login information. The existing session, rather than a captured hostname, owns host selection.

Each listed builder JSON-serializes its parameter object, encrypts it with the shared session `encodeAES`, URL-encodes the result into query parameter `params`, and appends `_getCommonParams()`. The common object is initialized with the current `zpw_ver` and `zpw_type`; it does **not** contain `nretry`. A conditional `ref` assignment is disabled by the observed constant expression. Do not confuse retry parameters added by another HTTP utility with this official common-parameter object.

The shared cipher decodes the session key from Base64, uses AES-CBC with an all-zero 16-byte IV and PKCS#7 padding, and emits Base64 ciphertext. `setDecryptKey`/`getSecretKey` maintain session ownership; no key value was retrieved. This parameter cipher is separate from native IPC encryption and from any media keying.

The request wrapper uses credentialed GET requests, a default 10-second timeout, and command identifiers for telemetry. Authentication cookies and current session keys must remain inside the established API extension.

The high-level call API applies `kCOK` to HTTP responses. It requires HTTP status 200, an outer body and outer `error_code: 0`. When outer `data` exists, it AES-decodes and JSON-parses that value. It then requires inner `error_code: 0` and returns inner `data`. An outer success without `data` resolves without a value.

Outer/inner failures reject their envelope. HTTP/network failures propagate their response/error. These error objects can contain URLs or personal data and must not be printed or persisted by diagnostics. Queue/retry logic exists, especially for `logendcall`. A diagnostic probe must not retry a call request automatically.

On success the helper wraps the decoded result as native `recvSignal`, retaining the original **native** command identifier. A successful HTTP exchange establishes neither remote ringing nor connected media.

## Incoming controls and correlation

**Observed official path:** decoded control batch → `controls[].content` → group by `act_type` → `callbackVideoCallEvent` for `voip` → `eventFromCtrlPolling` → `handleControl` → native `control` envelope.

The producer dispatcher parses `content.data` strings beginning with `{` or `[` as JSON; object/array data already decoded stays in that form. Other data remains opaque. `content.act` is the action string. The helper recognizes `request` as an incoming one-to-one invite; it also mentions `answer` in activity bookkeeping. It recognizes `group_request`/`group_answer` separately, outside scope. There is no evidence that every other action name is a complete lifecycle transition.

`handleControl` checks incoming-call settings, drops events whose numeric `data.ts` is over 60 seconds old relative to the official clock, and adds `inCallStatus: "zalo"` to an incoming invite when already calling. It forwards the event to native, which owns subsequent accept/decline behavior. `data.uidN` is used as the activity partner and `data.ts` as its timestamp. Outgoing request builders establish `callerId`/`calleeId`/`callId` correlation; the exact incoming call-ID field, identifier domain and timestamp unit in a live control still need capture. Avoid silently treating historical message IDs, HTTP command IDs or every numeric data field as a call identity.

**Observed Lite gap:** zca-js 2.2.0 already decrypts socket `version: 1`, `cmd: 601`, `subCmd: 0` to `controls`, but the unpatched listener dispatches only `file_done`, `group` and `fr`. It silently drops `voip`. The reproducible dependency patch exposes a typed `voip_control` content envelope on that same listener, retaining opaque fields. The production consumer handles parsing and filtering; no second account login, realtime socket or raw-frame UI broadcast is needed. A unit replay proves the patched receive path, not that Zalo delivers invitations to this client session.

## Transition inventory and required probes

The observations below describe producer/consumer boundaries, not a guessed native state machine. Each live probe requires a consenting peer and authenticated existing session. Capture only sanitized action/type/shape metadata; compare sensitive correlation material in memory and discard it.

| Transition | Established boundary | Unresolved contract | Named probe and expected observation |
| --- | --- | --- | --- |
| Initiate/bootstrap | `makeCall` at R 8,366,185 → native; native 401 → `requestcall` builder R 15,123,284 | ID creation, `typeRequest`, response semantics for current Lite session | **OUT-BOOTSTRAP:** controlled official outgoing voice/video attempts; distinguish helper input type from emitted type and decoded response shape |
| Invite/negotiation | Native 416 → `request` builder R 15,123,592; incoming `voip/request` reaches helper/native at R 8,363,448 | Codec/session/address/extendData contents, incoming call-ID field, listener eligibility | **INVITE-CORRELATION:** official peer invites Lite; observe same-listener `voip` arrival and compare partner/call/timestamp correlation in memory |
| Ring | Native 407 → `ringring` builder R 15,123,951 | What triggers ringing, when peer actually rings, incoming action/status | **RING:** leave controlled invitation unanswered; compare UI ring onset and control order without accepting |
| Answer | Native 402 → `answer` builder R 15,124,227; helper recognizes incoming `answer` | Accept status, media keying, address/session negotiation, native accept command/UI ownership | **ACCEPT:** manually accept a controlled official call; identify exact emitted status and subsequent actions, then test real media separately |
| Acknowledge | Native 408 → `answerack` builder R 15,124,571 | Trigger, ordering, timeout and readiness meaning | **ANSWER-ACK:** correlate both sides after manual acceptance; establish whether acknowledgement precedes any audible/visible media |
| Decline | No distinct rejection endpoint established; `answer` accepts an opaque status | Reject status/action and local/remote cleanup | **DECLINE:** decline at each official endpoint; observe which signal/endpoint/status occurs and both sides become idle; do not send guessed rejection values |
| Busy | Helper adds `inCallStatus` for incoming invite while occupied | Native busy reply/status, precedence and second-call behavior | **BUSY:** while a controlled call is active, arrange another consented invitation; observe native response and confirm first call survives |
| Cancel before answer | Native 405 → `cancel` builder R 15,124,849 | Native `callType` domain, correct caller/callee role and terminal control | **CANCEL:** originator cancels a known controlled invite; correlate exact callType/identities and remote ring stopping |
| End connected call | Renderer `endCall` R 8,372,459 → native; native 409 → `endcall` R 15,125,134 | Remote termination action, teardown order and races | **HANGUP:** each side ends an established controlled call; observe both idle states and released device indicators |
| Final accounting | Native 406 → `logendcall` R 15,126,321; `update/bubble` / `update/callState` R 8,357,322 | Status/role/duration semantics, retry deduplication | **FINALIZE:** end/cancel/decline independently; compare sanitized update order and verify one finalization without treating a history bubble as live state |
| Stale/duplicate/late delivery | Official helper has 60-second stale guard; same session can reconnect | Server ordering, replay IDs, clock units/skew, late replies after teardown | **RECONNECT-ORDER:** reconnect only the controlled client during an arranged call; compare repeated controls in memory and ensure stale data never revives an ended call |

`BUSY` needs an additional consenting caller or equivalent controlled official setup; it is not satisfied by the currently missing single test peer. None of these live cases has been performed.

## Current media-engine boundary

**Observed:** main module `3Zc2` selects a platform helper executable, not the bundled legacy addon. On production macOS it resolves `../ZaloHelper.app/Contents/MacOS/ZaloCall` relative to the main executable directory, which is `Contents/ZaloHelper.app/Contents/MacOS/ZaloCall` in this installation. Development and Windows branches select other packaged paths. `call-init` caches initialization; a nonoptional `call-send-to-native` lazily starts the helper. Runtime feature flags govern whether the renderer uses IPC. Static branches establish intended selection, not that any particular branch was executed during this investigation.

The helper is a Mach-O universal executable containing **x86_64 and arm64**. The legacy `zcall_mac.node` is **x86_64 only**, and its unpacked integrity contradiction remains. Current-path evidence does not support importing that addon as the production calling engine. Read-only load metadata lists Qt Multimedia/Network/WebSockets and Apple AVFoundation/CoreAudio/VideoToolbox frameworks. Bounded string checks find codec/WebRTC/zrtc markers but do not establish callable APIs, wire formats, negotiated codecs or browser compatibility.

The bridge creates two local servers using fixed macOS paths `/tmp/socketzalorecv2021` and `/tmp/socketzalosend2021`, then spawns the helper with those paths. Native-to-main encrypted text uses `$` delimiters, decryption, null removal and JSON parsing. Main-to-native macOS traffic uses `buildListMsgs` chunks and an acknowledgement-driven queue; Windows has a separate write path. The transport key comes from `zsecureSecrets().getCallV2TransportAesKey()`. The key value and full chunk/framing contract were not recovered. These fixed paths also make attaching to another running official app unsafe and unsuitable as a product integration design.

`update/native-ready` flushes cached initialization and pending requests. Other `update` commands go to `call-update`. `sendSignal` goes to `call-send-signal`. `request` goes to `call-request`, with a special helper restart path for `killMe`. `response` goes to `call-response-<command>`.

Renderer updates interpret `callState` as free/occupied and `bubble` as completed-call metadata. A renderer `endCall` request is visible, but this focused helper module does not expose a corresponding renderer accept/reject command. The native call window/engine is the unresolved acceptance boundary.

**Inferred:** native input `makeCall` and incoming `control`/`recvSignal` are consumed by the engine; its outgoing signals supply codec, session, RTP/RTCP addresses, extendData and statuses used by HTTP builders. Their internal creation and media consumption are **unknown**. HTTP parameter AES and native IPC AES must not be presented as media encryption. Neither SDP/ICE mapping, DTLS-SRTP key agreement, relay authentication, codec packetization, nor Zalo-specific zrtc framing has been reconstructed. Absence of SDP markers in a bounded string search is not evidence those mechanisms are absent.

Deeper native analysis is blocked by the recorded provider setup: REA expects Ghidra 12.1.x while the installed version is 12.2, with a Java runtime/path mismatch; Hopper is absent and IDA is not configured. No provider or unrelated toolchain was installed or changed. Next native work needs a supported provider/runtime configuration and a scoped trace from helper `makeCall`/`control` parsing to signal construction and media startup. It must retain native artifact identity and resolve the addon integrity contradiction before trusting addon-derived behavior.

### Candidate media approaches and smallest useful experiment

| Approach | Present evidence | Experiment that would justify selecting it |
| --- | --- | --- |
| Platform WebRTC in Lite's WKWebView | Browser capture/peer APIs are available in principle; official binary contains WebRTC-related markers | Recover the actual negotiation and relay contract, translate one consented official call into a minimal WKWebView transport, and prove outgoing/incoming two-way audio and video. A browser-to-browser demo is insufficient. |
| An original native engine/adapter | Official engine owns currently unknown Zalo-specific negotiation/media behavior | Reconstruct a concrete minimal transport/codec/keying boundary using supported static analysis and controlled captures, select an implementable engine, and prove the same four peer cases before production UI work. |
| Launch or redistribute official helper/addon | An internal IPC path exists, with secrets, fixed paths and architecture/ownership constraints | Not selected. A private reference helper is not a redistributable original implementation or an in-app media proof. |

No media approach is selected yet. The smallest next feasibility test is first an invitation/control and bootstrap-response capture with the consenting peer; it distinguishes missing session delivery from missing negotiation. Then a minimal original engine experiment must establish bidirectional media before a production adapter, acceptance UI or successful-call verdict can be claimed.

## Harness prerequisites and proof boundaries

The harness reuses the existing backend account session and listener. Live diagnostics require a configured and presented local loopback token, an explicit selected action and the consenting peer; arbitrary endpoints/methods and tokenless diagnostics are rejected. The offline default must neither connect the local socket nor perform outbound requests. No second Zalo session, automatic accept, microphone/camera access, official helper execution or automatic call retries belongs in a unit test.

Before live use, arrange a second Zalo account on an official phone/desktop device that the user controls or whose owner agrees to test, exchange the precise test action, and confirm both sides can stop it. Supply identifiers and session-dependent opaque values privately at runtime. Do not derive or persist them from personal message history. A request probe may create a remote notification or ring and needs an agreed cleanup procedure. Without proven media/accept semantics it cannot complete a call.

Future interoperability cases:

| Case | Required evidence beyond request success |
| --- | --- |
| Outgoing voice | Official peer rings and accepts; two-way intelligible audio; mute changes remote audio; either side can end; capture indicators stop |
| Incoming voice | Same-listener invite; explicit accept/decline; two-way audio after accept; no capture before accept; cleanup on cancel/decline/end |
| Outgoing video | Outgoing voice behavior plus live two-way video; camera off changes remote video; rebuild/relaunch permission behavior verified on macOS |
| Incoming video | Incoming voice behavior plus video acceptance/camera behavior; denied microphone/camera permissions fail cleanly without reviving an ended call |

For each, inspect exact correlation only in memory, record allowlisted shapes/actions and ordering with synthetic aliases, and tear down subscriptions and timers. Capture/report output must omit cookies, tokens, local credentials, personal IDs/names/messages, call/session keys, RTP addresses, opaque codec/session/extendData values and raw error text. Synthetic fixtures are marked synthetic and contain no extracted official source or live capture. A parser replay, patched-listener replay, or successful request is reported at that level; none is a successful-call verdict.

The test peer and a proven original media path remain prerequisites. Windows/Linux calling, group calls, recording, screen sharing and receiving calls while the app is terminated are not established here.

## Running the harness

Install the exact dependency and listener patch with `bun install --frozen-lockfile`. Bun applies `patches/zca-js@2.2.0.patch` through `patchedDependencies`; see [Bun's patch workflow](https://bun.com/docs/pm/cli/patch). Run `bun test server/calling` for the synthetic parser, actual encrypted listener and diagnostic bridge checks. The local listener server and fake outbound transport use synthetic sessions, not a Zalo login.

`bun scripts/calls-probe.ts` replays an original synthetic control without opening a socket. Its report says `synthetic: true`, `signaling: "not-run"` and `media: "unverified"`. It does not read stdin or account files.

Live use requires the backend already running with the account signed in and `ZL_TOKEN` configured. Tauri supplies `ZL_PORT`, `ZL_TOKEN` and `ZL_DATA` to its sidecar and exposes the same local connection in that window's `window.__ZL__`. Use that existing port/token privately; starting a separate backend against the same account data would create a competing session. Plain Vite/browser development with no configured token cannot run live diagnostics.

Supply a JSON document on stdin, outside the repository and shell history. For example, after preparing a private configuration file with mode `0600`, run `bun scripts/calls-probe.ts --live < /private/path/call-probe.json`. This template contains placeholders only:

```json
{
  "endpoint": "ws://127.0.0.1:PORT/",
  "token": "PRIVATE_LOCAL_TOKEN",
  "probe": {
    "mode": "live",
    "action": "observe",
    "peerId": "CONSENTING_TEST_PEER_ID",
    "consent": true,
    "waitMs": 10000
  }
}
```

`observe` subscribes only to controls whose source-supported `data.uidN` matches the selected peer. It does not send, accept or acknowledge an invitation. Unknown/missing partner IDs cannot be safely attributed and are omitted. It does not match incoming call IDs, whose contract remains unknown.

The observer reports up to 100 ordered events during at most 30 seconds, including duplicate/late marks and value types for known opaque fields. It does not label an observed action as an established call-state transition.

Two outbound request probes are available: `requestcall` and `cancel`. Both additionally require explicit `callId` and numeric `type` fields. For `requestcall`, `type` becomes `typeRequest`; for `cancel`, it becomes `callType`. Supply those values from the controlled investigation: this harness does not generate a call ID or infer a type.

A `requestcall` probe uses the observed default codec string `"[]"`, not a negotiated codec. Numeric types `1`/`3` remain candidates at this boundary until the native mapping is proved. A `cancel` probe is an explicit separate action using the same known call ID and captured cancellation type; it is not an automatic guessed cleanup request.

Each invocation sends at most one selected HTTP request, with no retry. The total diagnostic deadline is 35 seconds. Concurrent probes on one account are rejected. Logout/reconnect ends the probe and aborts its request/subscription. A remote request may already have been processed before an abort, so agree on cleanup with the peer before sending it.

The report only says `request-returned` when the response resolver returns; it always leaves media `unverified`. There is no live `answer`, decline, busy or media probe while their native contracts remain unresolved.

The CLI accepts only a loopback WebSocket endpoint without a query or embedded credentials. It never prints connection credentials, request identifiers, opaque values or remote error text. Reports retain fixed labels, types, ordering, bounded elapsed times and counts. Keep private configuration files out of source control and remove them after use.
