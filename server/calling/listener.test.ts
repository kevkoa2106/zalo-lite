import { expect, test } from "bun:test";
import { once } from "node:events";
import { CookieJar } from "tough-cookie";
import type { ServerWebSocket } from "bun";
import { Listener } from "../../node_modules/zca-js/dist/apis/listen.js";
import { createContext, isContextSession, type ContextSession } from "../../node_modules/zca-js/dist/context.js";
import { CallControls, type CallObservation } from "./protocol";

// Synthetic session and frames matching zca-js's cmd601 decoder; no account or remote server is used.
const key = Buffer.alloc(32, 7);
const frame = (cmd: number, subCmd: number, payload: unknown) => {
  const header = Buffer.alloc(4);
  header[0] = 1;
  header.writeUInt16LE(cmd, 1);
  header[3] = subCmd;
  return Buffer.concat([header, Buffer.from(JSON.stringify(payload))]);
};

async function withListener(run: (ctx: ContextSession, listener: Listener, send: (controls: unknown[]) => Promise<void>, malformed: () => void) => Promise<void>) {
  const ctx = createContext();
  Object.assign(ctx, {
    uid: "1001", imei: "synthetic-device", secretKey: key.toString("base64"), cookie: new CookieJar(), userAgent: "Zalo Lite synthetic listener test",
    settings: { features: { socket: { retries: {}, close_and_retry_codes: [], rotate_error_codes: [], ping_interval: 60_000 } } },
    uploadCallbacks: new Map(),
  });
  ctx.options.logging = false;
  ctx.options.selfListen = true;
  if (!isContextSession(ctx)) throw new Error("synthetic session missing");
  let socket: ServerWebSocket<unknown> | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req, server) { if (server.upgrade(req)) return; return new Response("upgrade required", { status: 400 }); },
    websocket: {
      open(ws) { socket = ws; ws.send(frame(1, 1, { key: key.toString("base64") })); },
      message() {},
    },
  });
  const listener = new Listener(ctx, [`ws://127.0.0.1:${server.port}`]);
  const send = async (controls: unknown[]) => {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const aad = new Uint8Array(16);
    const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, cryptoKey, Buffer.from(JSON.stringify({ data: { controls } })));
    socket!.send(frame(601, 0, { encrypt: 3, data: encodeURIComponent(Buffer.concat([iv, aad, new Uint8Array(encrypted)]).toString("base64")) }));
  };
  try {
    const ready = once(listener, "cipher_key");
    listener.start();
    await ready;
    await run(ctx, listener, send, () => socket!.send(frame(601, 0, { encrypt: 0, data: "not JSON" })));
  } finally {
    listener.stop();
    await server.stop(true);
  }
}

test("actual listener keeps file, group and friend control dispatch", async () => {
  await withListener(async (ctx, listener, send) => {
    let uploaded: unknown;
    ctx.uploadCallbacks.set("synthetic-file", (data) => uploaded = data);
    const upload = once(listener, "upload_attachment");
    const group = once(listener, "group_event");
    const friend = once(listener, "friend_event");
    await send([
      { content: { act_type: "file_done", fileId: "synthetic-file", data: { url: "https://synthetic.invalid/file" } } },
      { content: { act_type: "group", act: "join", data: JSON.stringify({ groupId: "synthetic-group", sourceId: "2002", updateMembers: [] }) } },
      { content: { act_type: "fr", act: "add", data: "2002" } },
    ]);
    const [file, grp, fr] = await Promise.all([upload, group, friend]);
    expect(file[0]).toEqual({ fileUrl: "https://synthetic.invalid/file", fileId: "synthetic-file" });
    expect(uploaded).toEqual(file[0]);
    expect(ctx.uploadCallbacks.has("synthetic-file")).toBe(false);
    expect(grp[0].threadId).toBe("synthetic-group");
    expect(fr[0].threadId).toBe("2002");
  });
});

test("actual patched listener decrypts voip into the production consumer", async () => {
  await withListener(async (_ctx, listener, send, malformed) => {
    const consumer = new CallControls();
    const received = Promise.withResolvers<CallObservation>();
    const unsubscribe = consumer.subscribe(received.resolve);
    listener.on("voip_control", (control) => consumer.receive(control, 100001));
    try {
      const error = once(listener, "error");
      malformed();
      expect((await error)[0]).toBeInstanceOf(Error);
      const data = { uidN: "2002", ts: "100000", codec: "synthetic-codec", session: "synthetic-session", status: 777 };
      await send([{ content: { act_type: "voip", act: "request", data: JSON.stringify(data), producerField: "retained" } }]);
      const event = await received.promise;
      expect(event.action).toBe("request");
      expect(event.peerId).toBe("2002");
      expect(event.data).toEqual(data);
      expect(event.content.producerField).toBe("retained");
      expect(event.duplicate).toBe(false);
      expect(event.late).toBe(false);
    } finally {
      unsubscribe();
    }
  });
});
