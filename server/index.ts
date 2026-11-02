// Local backend for the Tauri UI. Talks to Zalo through zca-js (see docs/PROTOCOL.md)
// and exposes one WebSocket on 127.0.0.1 that the UI uses for requests and live events.
import { Zalo, ThreadType, LoginQRCallbackEventType, CloseReason, type API } from "zca-js";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ServerWebSocket } from "bun";
import { openStore, type Msg, type Store, type Thread } from "./store";
import { normalize, previewOf } from "./normalize";

const PORT = Number(process.env.ZL_PORT ?? 17789);
const TOKEN = process.env.ZL_TOKEN ?? "";
const DATA = process.env.ZL_DATA ?? join(homedir(), "Library", "Application Support", "zalo-lite");
const SESSION = join(DATA, "session.json");
const ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420"]);
mkdirSync(DATA, { recursive: true });

type State =
  | { state: "boot" | "logged_out" }
  | { state: "qr"; qr: string }
  | { state: "qr_expired" }
  | { state: "scanned"; name: string; avatar: string }
  | { state: "ready"; me: { id: string; name: string; avatar: string } }
  | { state: "kicked" | "error"; error?: string };

let state: State = { state: "boot" };
let api: API | null = null;
let store: Store | null = null;
let me = { id: "", name: "", avatar: "" };
let qrActions: { retry: () => unknown; abort: () => unknown } | null = null;
let activeThread = "";
const clients = new Set<ServerWebSocket<unknown>>();

const send = (ws: ServerWebSocket<unknown>, data: unknown) => ws.send(JSON.stringify(data));
const broadcast = (data: unknown) => {
  const s = JSON.stringify(data);
  for (const ws of clients) ws.send(s);
};
const setState = (s: State) => broadcast({ ev: "state", ...(state = s) });

// ---------- session ----------

const zalo = () => new Zalo({ selfListen: true, logging: false, checkUpdate: false });

async function resume() {
  if (!existsSync(SESSION)) return setState({ state: "logged_out" });
  try {
    await ready(await zalo().login(await Bun.file(SESSION).json()));
  } catch (e) {
    console.error("resume failed", e);
    setState({ state: "logged_out" });
  }
}

async function loginQR() {
  qrActions?.abort();
  try {
    const a = await zalo().loginQR({}, async (ev) => {
      if (ev.actions) qrActions = ev.actions;
      switch (ev.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          return setState({ state: "qr", qr: ev.data.image });
        case LoginQRCallbackEventType.QRCodeExpired:
          return setState({ state: "qr_expired" });
        case LoginQRCallbackEventType.QRCodeScanned:
          return setState({ state: "scanned", name: ev.data.display_name, avatar: ev.data.avatar });
        case LoginQRCallbackEventType.QRCodeDeclined:
          return setState({ state: "qr_expired" });
        case LoginQRCallbackEventType.GotLoginInfo:
          await Bun.write(SESSION, JSON.stringify(ev.data));
      }
    });
    qrActions = null;
    if (a) await ready(a);
  } catch (e) {
    console.error("qr login failed", e);
    setState({ state: "error", error: String(e) });
  }
}

async function logout() {
  api?.listener.stop();
  api = null;
  store?.close();
  store = null;
  rmSync(SESSION, { force: true });
  setState({ state: "logged_out" });
}

// ---------- sync ----------

async function ready(a: API) {
  api = a;
  me.id = a.getOwnId();
  try {
    const { profile } = await a.fetchAccountInfo();
    me = { id: me.id, name: profile.displayName || profile.zaloName, avatar: profile.avatar };
  } catch {}
  store = openStore(join(DATA, `${me.id}.db`));
  store.putPerson(me.id, me.name, me.avatar);
  // Zalo's My Documents is its own account and arrives like any other chat; drop the
  // self-chat placeholder that earlier versions created under your own id.
  store.delThread(me.id);

  const l = a.listener;
  // Offline sync, as Zalo PC does it (docs/PROTOCOL.md): cmd 510/511 from the last stored
  // action id ("1" on a fresh install), then keep paging while pages come back. It must wait
  // for the cipher key: requests sent before it are dropped by the server.
  const pages = { [ThreadType.User]: 0, [ThreadType.Group]: 0 };
  l.on("cipher_key", () => {
    for (const t of [ThreadType.User, ThreadType.Group]) {
      pages[t] = 0;
      l.requestOldMessages(t, store?.get(`sync:${t}`) ?? "1");
    }
  });
  l.on("message", (m) => ingest(m.data, m.threadId, m.type, true));
  l.on("old_messages", (ms, type) => {
    console.log(`history sync: ${ms.length} ${type === ThreadType.User ? "1:1" : "group"} messages`);
    // Push synced messages too, so a chat that is already open fills in without reopening it.
    broadcast({ ev: "msgs", msgs: ms.map((m) => ingest(m.data, m.threadId, m.type, false)).filter(Boolean) });
    broadcast({ ev: "threads", threads: threadList() });
    // ponytail: zca-js hides the server's `more`/`lastActionId`, so page on the batch's highest
    // actionId and stop on an empty or non-advancing page; cap guards against a server that loops.
    const last = ms.reduce((max, m) => (BigInt(m.data.actionId || 0) > max ? BigInt(m.data.actionId) : max), 0n);
    const prev = BigInt(store?.get(`sync:${type}`) ?? "0");
    if (!store || !ms.length || last <= prev) return;
    store.set(`sync:${type}`, String(last));
    if (++pages[type] < 200)
      l.sendWs({ version: 1, cmd: type === ThreadType.User ? 510 : 511, subCmd: 1, data: { first: false, lastId: String(last), preIds: [] } });
  });
  l.on("typing", (t) => broadcast({ ev: "typing", threadId: t.threadId, uid: (t.data as any).uid }));
  l.on("reaction", (r) => {
    const d = r.data as any;
    const target = store?.msg(String(d.content?.rMsg?.[0]?.gMsgID ?? ""));
    if (!target) return;
    const uid = r.isSelf ? me.id : String(d.uidFrom);
    if (d.content.rType === -1 || !d.content.rIcon) delete target.reactions[uid];
    else target.reactions[uid] = d.content.rIcon;
    store!.putMsg(target);
    broadcast({ ev: "msg", msg: target });
  });
  l.on("undo", (u) => {
    const target = store?.msg(String((u.data as any).content?.globalMsgId ?? ""));
    if (!target) return;
    target.undone = true;
    store!.putMsg(target);
    touchThread(target);
    broadcast({ ev: "msg", msg: target });
  });
  l.on("seen_messages", (ms) => broadcast({ ev: "seen", items: ms.map((m) => ({ threadId: m.threadId, data: m.data })) }));
  l.on("connected", () => console.log("realtime connected"));
  l.on("closed", (code, reason) => {
    console.error(`realtime closed: ${code} ${reason}`);
    if (code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection) setState({ state: "kicked" });
  });
  l.on("error", (e) => console.error("listener error", e));
  l.start({ retryOnClose: true });

  setState({ state: "ready", me });
  syncContacts().catch((e) => console.error("contacts sync failed", e));
}

// Each step runs on its own: one failing call must not hide what the others found.
// The list is pushed to the window after every step.
async function syncContacts() {
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      console.log(`sync ${name}: ${await fn()}`);
    } catch (e) {
      console.error(`sync ${name} failed:`, e);
    }
    if (!store) return;
    broadcast({ ev: "threads", threads: threadList() });
    broadcast({ ev: "contacts", contacts: contacts() });
  };
  let ids: string[] = [];
  await step("friends", async () => {
    const friends = await api!.getAllFriends();
    for (const f of friends) store!.putPerson(f.userId, f.displayName || f.zaloName, f.avatar, true);
    return friends.length;
  });
  await step("groups", async () => {
    ids = Object.keys((await api!.getAllGroups()).gridVerMap);
    groupIds = new Set(ids);
    return ids.length;
  });
  await step("conversations", () => preloadConversations());
  await step("group messages", async () => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 6)
      await Promise.all(
        ids.slice(i, i + 6).map((id) =>
          groupCloud(id, "0", 30)
            .then((ms) => (n += ms.length))
            .catch((e) => console.error(`group ${id} cloud history failed:`, e?.message ?? e)),
        ),
      );
    return `${n} messages across ${ids.length} groups`;
  });
  await step("group info", async () => {
    // ponytail: sequential 50-id chunks; parallelise if accounts with thousands of groups feel slow.
    for (let i = 0; i < ids.length; i += 50) {
      const info = await api!.getGroupInfo(ids.slice(i, i + 50));
      for (const [id, g] of Object.entries(info.gridInfoMap) as [string, any][]) {
        const t = store!.thread(id) ?? blankThread(id, 1);
        store!.putThread({ ...t, name: g.name, avatar: g.fullAvt || g.avt, members: g.totalMember ?? 0 });
      }
    }
    return ids.length;
  });
  await step("names", async () => {
    const unknown = store!.threads().filter((t) => t.type === 0 && !store!.person(t.id)).map((t) => t.id);
    for (let i = 0; i < unknown.length; i += 50) await fetchPeople(unknown.slice(i, i + 50));
    for (const t of store!.threads()) if (t.type === 0) applyPerson(t);
    return unknown.length;
  });
}

let groupIds = new Set<string>();

// The conversation list: latest message of every conversation, groups included.
// Same call Zalo PC makes at startup (getLastMessagesForPreview → /api/preloadconvers/get-last-msgs).
// Group history from the group-cloud service, as Zalo PC loads it (observed in the bundle):
// GET /api/cm/getrecentv2 (newest, globalMsgId "0") or /api/cm/getoldv2 (older than globalMsgId)
// with {groupId, globalMsgId, count, msgIds, imei, src}; reply carries `groupMsgs`.
async function groupCloud(groupId: string, globalMsgId: string, count: number, old = false) {
  const a = api as any;
  if (!a.groupCloud)
    api!.custom("groupCloud", async ({ ctx, utils, props }) => {
      const host = a.zpwServiceMap?.group_cloud_message?.[0];
      if (!host) throw new Error("no group_cloud_message service in login info");
      const params = utils.encodeAES(
        JSON.stringify({ groupId: props.groupId, globalMsgId: props.globalMsgId, count: props.count, msgIds: [], imei: ctx.imei, src: -1 }),
      );
      if (!params) throw new Error("encrypt failed");
      const url = utils.makeURL(`${host}/api/cm/${props.old ? "getoldv2" : "getrecentv2"}`, { params });
      return utils.resolve(await utils.request(url, { method: "GET" }));
    });
  let data = await a.groupCloud({ groupId, globalMsgId, count, old });
  if (typeof data === "string") data = JSON.parse(data);
  const msgs: Record<string, any>[] = data?.groupMsgs ?? [];
  return msgs.map((m) => ingest(m, groupId, ThreadType.Group, false)).filter((m): m is Msg => !!m);
}

async function preloadConversations() {
  const a = api as any;
  if (!a.preloadLastMsgs)
    api!.custom("preloadLastMsgs", async ({ ctx, utils }) => {
      const params = utils.encodeAES(JSON.stringify({ threadIdLocalMsgId: JSON.stringify({}), imei: ctx.imei }));
      if (!params) throw new Error("encrypt failed");
      // zca-js keeps the service map on the api object, not on ctx.
      const host = a.zpwServiceMap?.conversation?.[0];
      if (!host) throw new Error("no conversation service in login info");
      const url = utils.makeURL(`${host}/api/preloadconvers/get-last-msgs`, { params });
      return utils.resolve(await utils.request(url, { method: "GET" }));
    });
  let data = await a.preloadLastMsgs();
  if (typeof data === "string") data = JSON.parse(data);
  // Zalo PC merges three arrays into its local `allmsgs` (observed in the bundle): `msgs` are 1:1
  // chats, `groupMsgs` are keyed by the group id in idTo, `pageMsgs` are Official Account chats.
  const user = (m: Record<string, any>) => {
    const self = m.uidFrom === "0" || m.uidFrom === me.id;
    // idTo "0" from "0" is your chat with yourself.
    const thread = self ? (m.idTo === "0" ? me.id : String(m.idTo)) : String(m.uidFrom);
    ingest(m, thread, ThreadType.User, false);
  };
  const one: Record<string, any>[] = data?.msgs ?? [];
  const grp: Record<string, any>[] = data?.groupMsgs ?? [];
  const page: Record<string, any>[] = data?.pageMsgs ?? [];
  one.forEach(user);
  page.forEach(user);
  for (const m of grp) ingest(m, String(m.idTo), ThreadType.Group, false);
  return `${one.length} chats, ${grp.length} groups, ${page.length} official accounts`;
}

async function fetchPeople(ids: string[]) {
  const res = await api!.getUserInfo(ids);
  for (const [id, p] of Object.entries(res.changed_profiles ?? {}) as [string, any][])
    store!.putPerson(id.split("_")[0]!, p.displayName || p.zaloName, p.avatar);
}

function applyPerson(t: Thread) {
  if (t.id === me.id) return;
  const p = store!.person(t.id);
  if (p && (p.name !== t.name || p.avatar !== t.avatar)) store!.putThread({ ...t, name: p.name, avatar: p.avatar });
}

const blankThread = (id: string, type: 0 | 1): Thread => ({
  id, type, name: id, avatar: "", unread: 0, lastTs: 0, preview: "", previewKind: "text", previewFrom: "", members: 0,
});

const pendingPeople = new Set<string>();
function ingest(raw: Record<string, any>, threadId: string, type: ThreadType, live: boolean) {
  if (!store) return;
  const m = normalize(raw, threadId, type as 0 | 1, me.id);
  const prev = store.msg(m.id);
  if (prev) m.reactions = prev.reactions;
  store.putMsg(m);
  if (m.from !== me.id && m.dName && !store.person(m.from)) store.putPerson(m.from, m.dName, "");
  const t = touchThread(m, live && !prev && m.from !== me.id && threadId !== activeThread);
  if (type === 0 && t.name === t.id && !pendingPeople.has(t.id)) {
    pendingPeople.add(t.id);
    fetchPeople([t.id]).then(() => {
      applyPerson(store!.thread(t.id)!);
      broadcast({ ev: "thread", thread: store!.thread(t.id) });
    }).catch(() => {});
  }
  if (live) broadcast({ ev: "msg", msg: m, thread: store.thread(threadId) });
  return m;
}

function touchThread(m: Msg, unread = false) {
  const t = store!.thread(m.threadId) ?? blankThread(m.threadId, m.type);
  if (m.type === 0 && t.name === t.id && t.id !== me.id) {
    const p = store!.person(m.threadId);
    if (p) Object.assign(t, { name: p.name, avatar: p.avatar || t.avatar });
  }
  if (m.ts && m.ts >= (t.lastTs || 0)) {
    t.lastTs = m.ts;
    t.preview = previewOf(m);
    t.previewKind = m.undone ? "text" : m.kind;
    t.previewFrom = m.from === me.id ? "Bạn" : m.type === 1 ? m.dName : "";
  }
  if (unread) t.unread++;
  store!.putThread(t);
  return t;
}

// Conversations with at least one message, newest first.
const threadList = () =>
  store!.threads().filter((t) => t.lastTs > 0).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
const contacts = () => [
  ...store!.people().filter((p) => p.id !== me.id).map((p) => ({ id: p.id, type: 0, name: p.name, avatar: p.avatar, friend: !!p.friend })),
  ...store!.threads().filter((t) => t.type === 1).map((t) => ({ id: t.id, type: 1, name: t.name, avatar: t.avatar, friend: false })),
];

// ---------- requests from the UI ----------

type Req = { op: string; rid?: number; [k: string]: any };

async function handle(r: Req): Promise<unknown> {
  switch (r.op) {
    case "login_qr": return void loginQR();
    case "qr_retry": return void (qrActions ? qrActions.retry() : loginQR());
    case "logout": return logout();
    case "reconnect":
      api?.listener.stop();
      store?.close();
      store = null;
      return resume();
  }
  if (!api || !store) throw new Error("not logged in");
  const msg = (id: string) => {
    const m = store!.msg(id);
    if (!m) throw new Error("unknown message");
    return m;
  };
  switch (r.op) {
    case "bootstrap":
      return { threads: threadList(), contacts: contacts() };
    case "open": {
      activeThread = r.threadId;
      const t = store.thread(r.threadId) ?? blankThread(r.threadId, r.type);
      if (t.unread) store.putThread({ ...t, unread: 0 });
      if (t.type === 1) {
        try {
          if (!r.before) await groupCloud(r.threadId, "0", 50);
          else if (store.page(r.threadId, r.before).length < 50) {
            // Ran out of local messages: ask the server for the page before the oldest one we have.
            const oldest = store.oldest(r.threadId);
            if (oldest) await groupCloud(r.threadId, oldest.id, 50, true);
          }
        } catch (e) {
          console.error("group cloud history failed:", e);
        }
      }
      markSeen(r.threadId, t.type);
      return { thread: store.thread(r.threadId) ?? t, messages: store.page(r.threadId, r.before) };
    }
    case "close":
      activeThread = "";
      return;
    case "send": {
      const quote = r.quoteId ? msg(r.quoteId).raw : undefined;
      const res = await api.sendMessage({ msg: r.text, quote: quote as any }, r.threadId, r.type);
      return echo(r, res.message?.msgId, r.text, r.quoteId);
    }
    case "files": {
      const dir = join(tmpdir(), "zalo-lite-upload", crypto.randomUUID());
      mkdirSync(dir, { recursive: true });
      const paths: string[] = [];
      for (const f of r.files as { name: string; b64: string }[]) {
        const name = basename(f.name.replace(/\\/g, "/"));
        const p = join(dir, name && name !== "." && name !== ".." ? name : `file-${paths.length}`);
        await Bun.write(p, Buffer.from(f.b64, "base64"));
        paths.push(p);
      }
      try {
        await api.sendMessage({ msg: r.text ?? "", attachments: paths }, r.threadId, r.type);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return;
    }
    case "react": {
      const m = msg(r.msgId);
      await api.addReaction(r.icon, { data: { msgId: m.id, cliMsgId: m.cliMsgId }, threadId: m.threadId, type: m.type as ThreadType });
      m.reactions[me.id] = r.icon;
      store.putMsg(m);
      broadcast({ ev: "msg", msg: m });
      return;
    }
    case "undo": {
      const m = msg(r.msgId);
      await api.undo({ msgId: m.id, cliMsgId: m.cliMsgId }, m.threadId, m.type as ThreadType);
      m.undone = true;
      store.putMsg(m);
      touchThread(m);
      broadcast({ ev: "msg", msg: m, thread: store.thread(m.threadId) });
      return;
    }
    case "delete": {
      const m = msg(r.msgId);
      await api.deleteMessage({ data: { cliMsgId: m.cliMsgId, msgId: m.id, uidFrom: m.from }, threadId: m.threadId, type: m.type as ThreadType }, true);
      store.delMsg(m.id);
      broadcast({ ev: "deleted", msgId: m.id, threadId: m.threadId });
      return;
    }
    case "typing":
      return api.sendTypingEvent(r.threadId, r.type);
    case "members": {
      const info = await api.getGroupInfo(r.threadId);
      const g = (info.gridInfoMap as any)[r.threadId];
      const ids: string[] = g?.memVerList?.map((s: string) => s.split("_")[0]) ?? [];
      const missing = ids.filter((id) => !store!.person(id));
      if (missing.length) await fetchPeople(missing);
      return ids.map((id) => ({ id, ...(store!.person(id) ?? { name: id, avatar: "" }) }));
    }
  }
  throw new Error(`unknown op ${r.op}`);
}

// The server confirms a send with only the msgId; store a local copy so the
// bubble shows immediately. The selfListen echo later overwrites it with full data.
function echo(r: Req, msgId: number | undefined, text: string, quoteId?: string) {
  if (!msgId) return;
  const q = quoteId ? store!.msg(quoteId) : null;
  const m: Msg = {
    id: String(msgId), cliMsgId: "", threadId: r.threadId, type: r.type, from: me.id, dName: me.name, ts: Date.now(),
    kind: "text", text, attach: null, undone: false, reactions: {},
    quote: q ? { from: q.from, dName: q.dName, text: previewOf(q) } : null,
    raw: { msgId: String(msgId), uidFrom: "0", msgType: "webchat", content: text, ts: String(Date.now()) },
  };
  if (!store!.msg(m.id)) {
    store!.putMsg(m);
    touchThread(m);
  }
  const saved = store!.msg(m.id)!;
  broadcast({ ev: "msg", msg: saved, thread: store!.thread(r.threadId) });
  return saved;
}

function markSeen(threadId: string, type: 0 | 1) {
  const unseen = store!.page(threadId, undefined, 20).filter((m) => m.from !== me.id).map((m) => m.raw as any);
  if (!unseen.length) return;
  api!.sendSeenEvent(type === 1 ? unseen : unseen.slice(-1), type as ThreadType).catch(() => {});
}

// ---------- local socket ----------

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (TOKEN && url.searchParams.get("token") !== TOKEN) return new Response("forbidden", { status: 403 });
    // Browsers always send Origin; refusing foreign ones stops any website from reading chats via localhost.
    const origin = req.headers.get("origin");
    if (origin && !ORIGINS.has(origin)) return new Response("forbidden", { status: 403 });
    if (server.upgrade(req)) return;
    return new Response("zalo-lite backend");
  },
  websocket: {
    maxPayloadLength: 128 * 1024 * 1024,
    open(ws) {
      clients.add(ws);
      send(ws, { ev: "state", ...state });
    },
    close(ws) {
      clients.delete(ws);
    },
    async message(ws, data) {
      let r: Req;
      try {
        r = JSON.parse(String(data));
      } catch {
        return;
      }
      try {
        send(ws, { rid: r.rid, ok: true, data: await handle(r) });
      } catch (e) {
        console.error(`${r.op} failed:`, e);
        send(ws, { rid: r.rid, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    },
  },
});

console.log(`zalo-lite backend on 127.0.0.1:${PORT}`);
resume();
