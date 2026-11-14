import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import type { API } from "zca-js";
import { CookieJar } from "tough-cookie";
import { customFactory } from "../../node_modules/zca-js/dist/apis/custom.js";
import { createContext, isContextSession } from "../../node_modules/zca-js/dist/context.js";
import { decodeAES, encodeAES } from "../../node_modules/zca-js/dist/utils.js";
import { CallControls } from "./protocol";
import { runProbe } from "./probe";

const planted = "PRIVATE_SYNTHETIC_CREDENTIAL_AND_MESSAGE";
const ownId = "1001";
const peerId = "2002";
const live = { mode: "live", action: "requestcall", peerId, consent: true, callId: "synthetic-call", type: 1 };

function fixture(reply: unknown = { session: planted, name: planted }) {
  const ctx = createContext(30, 694);
  Object.assign(ctx, { uid: ownId, imei: "synthetic-device", userAgent: "synthetic-agent", cookie: new CookieJar(), secretKey: Buffer.alloc(32, 9).toString("base64") });
  ctx.options.logging = false;
  if (!isContextSession(ctx)) throw new Error("missing synthetic context");
  const writes: { url: URL; options?: RequestInit; body: unknown }[] = [];
  ctx.options.polyfill = (async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input));
    writes.push({ url, options, body: JSON.parse(decodeAES(ctx.secretKey, url.searchParams.get("params")!)!) });
    if (typeof reply === "function") return reply(options);
    if (reply instanceof Error) throw reply;
    return Response.json({ error_code: 0, data: encodeAES(ctx.secretKey, JSON.stringify({ error_code: 0, data: reply })) });
  }) as typeof fetch;
  const api = { getOwnId: () => ownId, zpwServiceMap: { voice_call: ["https://synthetic.invalid"] }, custom: undefined as unknown as API["custom"] };
  api.custom = customFactory(ctx, api as unknown as API);
  const stop = new AbortController();
  const deps = { api: api as unknown as API, controls: new CallControls(), authenticated: true, signal: stop.signal };
  return { deps, writes, stop };
}

test("offline replay never touches the supplied session or outbound transport", async () => {
  const { deps, writes } = fixture();
  const result = await runProbe({}, deps);
  expect(result).toMatchObject({ mode: "offline", signaling: "not-run", synthetic: true, media: "unverified" });
  expect(result.events).toHaveLength(1);
  expect(writes).toHaveLength(0);
  expect(Object.hasOwn(deps.api, "callingProbe")).toBe(false);
  expect(JSON.stringify(result)).not.toContain("900000000000000001");
});

test("explicit live probe uses the existing custom API's encrypted session request", async () => {
  const { deps, writes } = fixture();
  const result = await runProbe(live, deps);
  expect(writes).toHaveLength(1);
  const write = writes[0]!;
  expect(write.url.origin).toBe("https://synthetic.invalid");
  expect(write.url.pathname).toBe("/api/voicecall/requestcall");
  expect(write.url.searchParams.get("zpw_ver")).toBe("694");
  expect(write.url.searchParams.get("zpw_type")).toBe("30");
  expect(write.options?.method).toBe("GET");
  expect(write.body).toEqual({ calleeId: peerId, callId: "synthetic-call", codec: "[]", typeRequest: 1, imei: "synthetic-device" });
  expect(result).toMatchObject({ mode: "live", signaling: "request-returned", response: "object", media: "unverified" });
  expect(JSON.stringify(result)).not.toContain(planted);
  await runProbe({ ...live, action: "cancel", type: 7 }, deps);
  expect(writes[1]!.url.pathname).toBe("/api/voicecall/cancel");
  expect(writes[1]!.body).toEqual({ callerId: peerId, callId: "synthetic-call", callType: 7, status: 0, imei: "synthetic-device" });
});

test("invalid, tokenless and ended-session probes cannot reach outbound transport", async () => {
  const { deps, writes, stop } = fixture();
  for (const raw of [null, [], { ...live, endpoint: "https://synthetic.invalid" }, { ...live, method: "POST" }, { ...live, action: "answer" }, { ...live, peerId: ownId }, { ...live, peerId: "2e3" }, { ...live, peerId: 2002 }, { ...live, consent: false }, { ...live, callId: "" }, { ...live, type: undefined }, { ...live, type: -1 }, { ...live, waitMs: 30_001 }, { mode: "offline", action: "requestcall" }, { ...live, action: "observe" }]) {
    await expect(runProbe(raw, deps)).rejects.toThrow();
  }
  await expect(runProbe(live)).rejects.toThrow("authenticated");
  await expect(runProbe(live, { ...deps, authenticated: false })).rejects.toThrow("authenticated");
  stop.abort();
  await expect(runProbe(live, deps)).rejects.toThrow("session ended");
  expect(writes).toHaveLength(0);
});

test("live observations filter the peer, keep unknown IDs opaque and sanitize every data field", async () => {
  const { deps, writes } = fixture();
  const pending = runProbe({ mode: "live", action: "observe", peerId, consent: true, waitMs: 20 }, deps);
  const payload = { uidN: peerId, ts: Date.now() - 60_001, callId: planted, accountId: planted, codec: planted, session: planted, session_id: planted, rtpAddress: planted, rtcpAddress: planted, extendData: { token: planted }, status: planted, name: planted, message: planted };
  deps.controls.receive({ act_type: "voip", act: "request", data: { ...payload, uidN: "3003" } });
  deps.controls.receive({ act_type: "voip", act: "request", data: payload });
  deps.controls.receive({ act_type: "voip", act: "request", data: payload });
  deps.controls.receive({ act_type: "voip", act: planted, data: { ...payload, callId: "another-untrusted-call" } });
  const result = await pending;
  expect(result.events).toHaveLength(3);
  expect(result.events[0]).toMatchObject({ order: 1, action: "request", late: true, duplicate: false });
  expect(result.events[1]).toMatchObject({ order: 2, duplicate: true });
  expect(result.events[2]).toMatchObject({ order: 3, action: "unknown" });
  expect(result.events[0]!.fields).toMatchObject({ session: "string", extendData: "object", callId: "string" });
  const output = JSON.stringify(result);
  for (const secret of [planted, peerId, "3003", "another-untrusted-call", "accountId", "message"]) expect(output).not.toContain(secret);
  expect(writes).toHaveLength(0);
  deps.controls.receive({ act_type: "voip", act: "answer", data: payload });
  expect(result.events).toHaveLength(3);
});

test("probe capture is bounded and abort releases its observer and busy guard", async () => {
  const { deps, stop } = fixture();
  const raw = { mode: "live", action: "observe", peerId, consent: true, waitMs: 20 };
  const first = runProbe(raw, deps);
  await expect(runProbe(raw, deps)).rejects.toThrow("already running");
  for (let i = 0; i < 103; i++) deps.controls.receive({ act_type: "voip", act: "answer", data: { uidN: peerId, marker: i } });
  const result = await first;
  expect(result.events).toHaveLength(100);
  expect(result).toMatchObject({ dropped: 3 });
  const aborted = runProbe({ ...raw, waitMs: 30_000 }, deps);
  stop.abort();
  await expect(aborted).rejects.toThrow("session ended");
  const next = await runProbe({ ...raw, waitMs: 0 }, { ...deps, signal: new AbortController().signal });
  expect(next.events).toHaveLength(0);
});

test("outbound exceptions cannot leak remote errors or credentials into the report", async () => {
  const { deps } = fixture(new Error(planted));
  await expect(runProbe(live, deps)).rejects.toThrow("call probe transport failed");
  try { await runProbe(live, deps); } catch (error) { expect(String(error)).not.toContain(planted); }
});

function pendingRequest() {
  const reached = Promise.withResolvers<AbortSignal | null | undefined>();
  const cancelled = Promise.withResolvers<void>();
  const f = fixture((options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    reached.resolve(options?.signal);
    options?.signal?.addEventListener("abort", () => { cancelled.resolve(); reject(new Error(planted)); }, { once: true });
  }));
  let released = 0;
  const subscribe = f.deps.controls.subscribe.bind(f.deps.controls);
  const subscription = spyOn(f.deps.controls, "subscribe").mockImplementation((listener) => {
    const off = subscribe(listener);
    return () => { released++; off(); };
  });
  return { ...f, reached: reached.promise, cancelled: cancelled.promise, released: () => released, restore: () => subscription.mockRestore() };
}

test("session end aborts the outstanding outbound request and releases the probe", async () => {
  const f = pendingRequest();
  const pending = runProbe(live, f.deps);
  pending.catch(() => {});
  try {
    const signal = await f.reached;
    expect(f.writes).toHaveLength(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    f.stop.abort();
    await expect(pending).rejects.toThrow("session ended");
    expect(signal!.aborted).toBe(true);
    await f.cancelled;
    expect(f.released()).toBe(1);
    await expect(runProbe({ mode: "live", action: "observe", peerId, consent: true, waitMs: 0 }, { ...f.deps, signal: new AbortController().signal })).resolves.toMatchObject({ events: [] });
  } finally {
    f.stop.abort();
    await pending.catch(() => {});
    f.restore();
  }
});

test("deadline expiry aborts the outstanding outbound request and releases the probe", async () => {
  const f = pendingRequest();
  const timeout = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay === 35_000) expire = () => callback(...args);
    return timeout(callback, delay, ...args);
  }) as typeof setTimeout);
  const pending = runProbe(live, f.deps);
  pending.catch(() => {});
  try {
    const signal = await f.reached;
    expect(f.writes).toHaveLength(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    expect(expire).toBeFunction();
    expire!();
    await expect(pending).rejects.toThrow("timed out");
    expect(signal!.aborted).toBe(true);
    await f.cancelled;
    expect(f.released()).toBe(1);
    await expect(runProbe({ mode: "live", action: "observe", peerId, consent: true, waitMs: 0 }, f.deps)).resolves.toMatchObject({ events: [] });
  } finally {
    timer.mockRestore();
    f.stop.abort();
    await pending.catch(() => {});
    f.restore();
  }
});

const cli = resolve("scripts/calls-probe.ts");
async function cliRun(args: string[] = [], config?: unknown) {
  const child = Bun.spawn([process.execPath, cli, ...args], { stdin: config === undefined ? "ignore" : new Response(JSON.stringify(config)), stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

test("CLI defaults to inert replay and rebuilds live output without personal server fields", async () => {
  const offline = await cliRun();
  expect(offline.code).toBe(0);
  expect(JSON.parse(offline.stdout)).toMatchObject({ mode: "offline", signaling: "not-run" });
  let request: any;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req, server) { if (server.upgrade(req)) return; return new Response("upgrade required", { status: 400 }); },
    websocket: { message(ws, data) {
      request = JSON.parse(String(data));
      ws.send(JSON.stringify({ rid: 1, ok: true, data: { mode: "live", action: "observe", response: planted, token: planted, media: planted, dropped: 0, events: [{ action: planted, data: planted, fields: { codec: planted, token: planted }, message: planted }] } }));
    } },
  });
  try {
    const result = await cliRun(["--live"], { endpoint: `ws://127.0.0.1:${server.port}/`, token: planted, probe: { mode: "live", action: "observe", peerId, consent: true, waitMs: 0 } });
    expect(result.code).toBe(0);
    expect(request).toMatchObject({ op: "call_probe", probe: { mode: "live", action: "observe" } });
    expect(result.stdout + result.stderr).not.toContain(planted);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: "live", media: "unverified", events: [{ action: "unknown" }] });
    const rejected = await cliRun(["--live"], { endpoint: `ws://127.0.0.1:${server.port}/?token=${planted}`, token: planted, probe: live });
    expect(rejected.code).toBe(1);
    expect(rejected.stdout + rejected.stderr).not.toContain(planted);
  } finally { await server.stop(true); }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const syntheticLogin = `
import { mock } from "bun:test";
import EventEmitter from "node:events";
import * as real from ${JSON.stringify(resolve("node_modules/zca-js/dist/index.js"))};
mock.module(${JSON.stringify(resolve("node_modules/zca-js/dist/index.js"))}, () => ({ ...real, Zalo: class {
  async login(session) {
    if (session.synthetic !== true) throw new Error("synthetic session required");
    const listener = new EventEmitter();
    let timer;
    listener.start = () => {
      timer = setInterval(() => listener.emit("voip_control", { act_type: "voip", act: "request", data: { uidN: "${peerId}", ts: Date.now() } }), 5);
    };
    listener.stop = () => clearInterval(timer);
    return {
      listener, getOwnId: () => "${ownId}",
      fetchAccountInfo: async () => ({ profile: { displayName: "Synthetic account", avatar: "" } }),
      getAllFriends: async () => [], getAllGroups: async () => ({ gridVerMap: {} }),
      custom(name) {
        if (name !== "preloadLastMsgs") throw new Error("unexpected synthetic API request");
        this[name] = async () => ({ msgs: [], groupMsgs: [], pageMsgs: [] });
      }
    };
  }
} }));
`;

async function bridge(token: string, run: (endpoint: string, log: () => string) => Promise<void>, loggedIn = false) {
  const scratch = mkdtempSync(join(tmpdir(), "zl-probe-bridge-"));
  const port = await freePort();
  let log = "";
  const args = [resolve("server/index.ts")];
  if (loggedIn) {
    writeFileSync(join(scratch, "session.json"), JSON.stringify({ synthetic: true, pc: true }));
    const preload = join(scratch, "login.ts");
    writeFileSync(preload, syntheticLogin);
    args.unshift("--preload", preload);
  }
  const child = spawn(process.execPath, args, { detached: true, env: { ...process.env, ZL_PORT: String(port), ZL_TOKEN: token, ZL_DATA: scratch }, stdio: ["ignore", "pipe", "pipe"], timeout: 8000 });
  child.stdout.on("data", (v) => log += String(v));
  child.stderr.on("data", (v) => log += String(v));
  const ended = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  try {
    const deadline = Date.now() + 4000;
    while (!log.includes(`backend on 127.0.0.1:${port}`)) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`isolated backend did not start: ${log}`);
      await Bun.sleep(10);
    }
    await run(`http://127.0.0.1:${port}/`, () => log);
  } finally {
    if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await ended;
    writeFileSync(join(scratch, "backend.log"), log);
    try { const socket = Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, error() {} } }); await socket; throw new Error("backend test port still held"); } catch (error) { if (error instanceof Error && error.message === "backend test port still held") throw error; }
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function rejectedProbe(endpoint: string) {
  const ws = new WebSocket(endpoint.replace(/^http/, "ws"));
  try {
    return await new Promise<any>((resolve, reject) => {
      ws.onerror = () => reject(new Error("isolated bridge socket failed"));
      ws.onopen = () => ws.send(JSON.stringify({ op: "call_probe", rid: 17, probe: live }));
      ws.onmessage = (e) => { const data = JSON.parse(String(e.data)); if (data.rid === 17) resolve(data); };
    });
  } finally { ws.close(); }
}

test("actual empty-data backend rejects wrong tokens, foreign origins and logged-out probes", async () => {
  await bridge("synthetic-local-token", async (endpoint, log) => {
    expect((await fetch(endpoint + "?token=wrong")).status).toBe(403);
    const valid = endpoint + "?token=synthetic-local-token";
    expect((await fetch(valid, { headers: { origin: "https://foreign.invalid" } })).status).toBe(403);
    expect((await fetch(valid, { headers: { origin: "tauri://localhost" } })).status).toBe(200);
    const reply = await rejectedProbe(valid);
    expect(reply).toMatchObject({ rid: 17, ok: false, error: "call probe rejected or failed" });
    expect(log()).not.toContain("synthetic-local-token");
    expect(log()).not.toContain("call_probe failed");
  });
  await bridge("", async (endpoint) => {
    const reply = await rejectedProbe(endpoint);
    expect(reply).toMatchObject({ ok: false, error: "call probe rejected or failed" });
  });
}, 15_000);

async function bridgeClient(endpoint: string) {
  const ws = new WebSocket(endpoint.replace(/^http/, "ws"));
  const ready = Promise.withResolvers<void>();
  const waiting = new Map<number, { resolve: (data: any) => void; timer: ReturnType<typeof setTimeout> }>();
  let rid = 0;
  const timer = setTimeout(() => ready.reject(new Error("synthetic account did not become ready")), 1000);
  ws.onerror = () => ready.reject(new Error("synthetic bridge socket failed"));
  ws.onmessage = (e) => {
    const data = JSON.parse(String(e.data));
    if (data.ev === "state" && data.state === "ready") ready.resolve();
    const pending = waiting.get(data.rid);
    if (pending) { clearTimeout(pending.timer); waiting.delete(data.rid); pending.resolve(data); }
  };
  try { await ready.promise; } catch (error) { ws.close(); throw error; } finally { clearTimeout(timer); }
  return {
    request(op: string, args: Record<string, unknown> = {}) {
      return new Promise<any>((resolve, reject) => {
        const id = ++rid;
        waiting.set(id, { resolve, timer: setTimeout(() => { waiting.delete(id); reject(new Error("synthetic bridge request timed out")); }, 1000) });
        ws.send(JSON.stringify({ op, rid: id, ...args }));
      });
    },
    close() { for (const pending of waiting.values()) clearTimeout(pending.timer); waiting.clear(); ws.close(); },
  };
}

test("logged-in backend forwards its existing listener controls to the probe", async () => {
  await bridge("synthetic-local-token", async (endpoint) => {
    const client = await bridgeClient(endpoint + "?token=synthetic-local-token");
    try {
      expect((await client.request("bootstrap")).ok).toBe(true);
      const reply = await client.request("call_probe", { probe: { mode: "live", action: "observe", peerId, consent: true, waitMs: 40 } });
      expect(reply).toMatchObject({ ok: true, data: { mode: "live", action: "observe", media: "unverified" } });
      expect(reply.data.events.length).toBeGreaterThan(0);
      expect(reply.data.events[0]).toMatchObject({ action: "request", peer: "present" });
    } finally { client.close(); }
  }, true);
});

test("logged-in tokenless backend refuses diagnostics after normal account requests", async () => {
  await bridge("", async (endpoint) => {
    const client = await bridgeClient(endpoint);
    try {
      expect((await client.request("bootstrap")).ok).toBe(true);
      expect(await client.request("call_probe", { probe: { mode: "live", action: "observe", peerId, consent: true, waitMs: 0 } })).toMatchObject({ ok: false, error: "call probe rejected or failed" });
    } finally { client.close(); }
  }, true);
});

for (const op of ["logout", "reconnect"]) test(`logged-in ${op} terminates a pending probe`, async () => {
  await bridge("synthetic-local-token", async (endpoint) => {
    const client = await bridgeClient(endpoint + "?token=synthetic-local-token");
    const probe = { mode: "live", action: "observe", peerId, consent: true, waitMs: 30_000 };
    try {
      const pending = client.request("call_probe", { probe });
      pending.catch(() => {});
      expect(await client.request("call_probe", { probe: { ...probe, waitMs: 0 } })).toMatchObject({ ok: false });
      expect((await client.request(op)).ok).toBe(true);
      expect(await pending).toMatchObject({ ok: false, error: "call probe rejected or failed" });
      if (op === "reconnect") expect(await client.request("call_probe", { probe: { ...probe, waitMs: 0 } })).toMatchObject({ ok: true });
    } finally { client.close(); }
  }, true);
});
