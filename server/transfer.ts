// Phone-to-PC message transfer (docs/PROTOCOL.md, "Phone-to-PC transfer"):
//   pull_mobile_msg -> phone prompt -> `syncmsg_info` control event -> download -> MD5 -> decrypt -> import -> clean up.
// Everything it downloads lives under the cache folder and is deleted when the import ends.
import { createHash, generateKeyPairSync } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { decodeEventData } from "../node_modules/zca-js/dist/utils.js";
import { parseBinNet } from "./binnet";
import { decryptBackup, unpackArchive } from "./crossdb-native-free";
import { backupChats, nativeLib, readChat, toRaw, unwrapKey } from "./crossdb";

export type Deps = {
  api: any;
  ownId: string;
  cacheDir: string;
  keep: number; // newest messages kept per chat: the history is a cache, not an archive
  notify: (text: string) => void;
  ingest: (raw: Record<string, any>, threadId: string, type: 0 | 1) => unknown;
  batch: (fn: () => void) => void;
  afterImport: () => Promise<void>;
  resume?: boolean; // import the already decrypted backup left in the cache folder, without asking the phone
};

// Message blobs are parsed by our own code (server/binnet.ts), identical to Zalo's library on 59,965 real blobs.
const parseBlob = (b: Uint8Array) => {
  try {
    return { result: 0, data: parseBinNet(b) };
  } catch {
    return { result: 1 };
  }
};

let running = false;
const grabbed: any = {};

const asJson = (v: unknown): Record<string, any> => {
  if (typeof v !== "string") return (v ?? {}) as Record<string, any>;
  for (const s of [() => decodeURIComponent(v), () => v]) {
    try {
      return JSON.parse(s());
    } catch {}
  }
  return {};
};

export async function phoneSync(d: Deps): Promise<{ chats: number; messages: number }> {
  if (running) throw new Error("Đang đồng bộ, vui lòng chờ");
  running = true;
  const { api } = d;
  // custom() is registered once per process and captures the context for the later calls
  if (!api.grab) api.custom("grab", ({ ctx, utils }: any) => ((grabbed.ctx = ctx), (grabbed.utils = utils), true));
  api.grab();
  const { ctx, utils } = grabbed;
  const fileHost: string = api.zpwServiceMap.file[0];
  const call = async (path: string, body: object) =>
    utils.resolve(await utils.request(utils.makeURL(`${fileHost}${path}`, { zpw_ver: 694, zpw_type: 30, nretry: 0, params: utils.encodeAES(JSON.stringify(body)) }, false), { method: "GET" }));

  const kp = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
  const publicKey = kp.publicKey.toString("base64");
  const out = join(d.cacheDir, "decrypted");
  let ok = false;
  let off = () => {};
  try {
    if (!(d.resume && existsSync(out))) {
      // The phone answers on the realtime socket as control events (cmd 601, act_type "syncmsgmb").
      const info = new Promise<Record<string, any>>((resolve, reject) => {
        const ws = api.listener.ws;
        if (!ws) return reject(new Error("chưa kết nối realtime"));
        const onMsg = async (buf: Buffer) => {
          try {
            if (buf.readUInt16LE(1) !== 601) return;
            const inner = (await decodeEventData(JSON.parse(buf.subarray(4).toString("utf8")), api.listener.cipherKey)).data;
            for (const c of inner?.controls ?? []) {
              const content = c?.content ?? c;
              if (content?.act_type !== "syncmsgmb") continue;
              if (content.act === "user_confirm") d.notify("Điện thoại đã đồng ý, đang chuẩn bị bản sao lưu…");
              if (content.act === "syncmsg_info") resolve(asJson(content.data));
              if (content.act === "transfer_error" && asJson(content.data).error_code) reject(new Error(`điện thoại báo lỗi ${asJson(content.data).error_code}`));
            }
          } catch {}
        };
        ws.on("message", onMsg);
        off = () => ws.off("message", onMsg);
        setTimeout(() => reject(new Error("điện thoại không phản hồi trong 10 phút")), 600_000).unref();
      });
      info.catch(() => {}); // a late rejection must not crash the process
      await call("/api/message/pull_mobile_msg", { pc_name: hostname(), public_key: publicKey, from_seq_id: 0, is_retry: 0, min_seq_id: 0, temp_key: "", imei: ctx.imei });
      d.notify("Đã gửi yêu cầu: hãy bấm Đồng ý trên điện thoại");

      const i = await info;
      const db = asJson(i.db_info);
      const format = Number(db.db_format) === 1 ? 1 : 0;
      d.notify(`Đang tải bản sao lưu (${Math.round(Number(i.file_size) / 1024 / 1024)} MB)…`);
      rmSync(d.cacheDir, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      const enc = join(d.cacheDir, "backup.bin");
      // trans-bin.zaloapp.com is outside the zalo.me cookie scope, so the session cookie goes in by hand.
      const res = await fetch(String(i.url), { headers: { cookie: ctx.cookie.getCookieStringSync("https://chat.zalo.me/"), "user-agent": ctx.userAgent } });
      if (!res.ok) throw new Error(`tải thất bại (HTTP ${res.status})`);
      await Bun.write(enc, res);
      const md5 = createHash("md5").update(new Uint8Array(await Bun.file(enc).arrayBuffer())).digest("hex");
      if (md5 !== String(i.checksum_code).toLowerCase()) throw new Error("bản sao lưu bị lỗi (sai MD5)");

      d.notify("Đang giải mã…");
      const secret = unwrapKey(String(i.encrypted_key), kp.privateKey as string, format);
      // Zalo's library decrypts the download in place, so the encrypted bytes must be copied before it runs.
      const fx = join(d.cacheDir, "..", "fixture");
      if (process.env.ZL_KEEP_FIXTURE === "1") {
        rmSync(fx, { recursive: true, force: true });
        mkdirSync(fx, { recursive: true, mode: 0o700 });
        copyFileSync(enc, join(fx, "backup.enc"));
      }
      // Our own decoder first (AES-256-CBC, then the archive); its header hash and size checks are the proof it worked.
      // Zalo PC's library is only the fallback, and the fixture capture always uses it so the library stays the oracle.
      let r: any = { result: 1 };
      if (format === 1 && process.env.ZL_KEEP_FIXTURE !== "1") {
        try {
          const files = await unpackArchive(decryptBackup(new Uint8Array(await Bun.file(enc).arrayBuffer()), secret.toUpperCase()));
          for (const f of files) await Bun.write(join(out, f.name), f.data);
          r = { result: 0 };
          console.log("backup: decoded without Zalo PC's library");
        } catch (e) {
          console.error("backup: own decoder failed, falling back to Zalo PC's library:", e);
          rmSync(out, { recursive: true, force: true });
          mkdirSync(out, { recursive: true });
        }
      }
      if (r.result !== 0) {
        const lib = nativeLib();
        r = format === 1 ? lib.decompressAndDecryptDb_V2(enc, out + "/", secret.toUpperCase(), () => {}) : lib.decompressAndDecryptDb(enc, join(out, "backup.db"), secret);
      }
      if (r.result !== 0) throw new Error(`giải mã thất bại (${r.result})`);
      // Dev only: keep the encrypted file, its key and Zalo's own output, to test a native-free decoder against.
      if (process.env.ZL_KEEP_FIXTURE === "1") {
        copyFileSync(enc, join(fx, "backup.dec")); // the decrypted archive (the library overwrote the download)
        cpSync(out, join(fx, "oracle"), { recursive: true });
        writeFileSync(join(fx, "key.json"), JSON.stringify({ format, secret, md5: i.checksum_code, size: i.file_size, db_info: db }), { mode: 0o600 });
        d.notify("Đã lưu mẫu thử (chỉ để phát triển)");
      }
      rmSync(enc, { force: true });

    }

    d.notify("Đang nhập tin nhắn…");
    const chats = backupChats(out);
    const rows = chats.map((c) => readChat(c.file, d.keep));
    // Short ids -> real ids, for chats and for everyone who wrote in them.
    const real = new Map<string, string>();
    const resolve = async (kind: "fids" | "gids", ids: string[]) => {
      for (let n = 0; n < ids.length; n += 300) {
        const part = ids.slice(n, n + 300);
        // ids go out as bare JSON numbers: the real ones exceed 2^53, so the body is built by hand
        const body = `{"${kind}":[${part.join(",")}]}`;
        const url = utils.makeURL("https://zwid.api.zalo.me/api/znoise", { zpw_ver: 694, zpw_type: 30 });
        const reply = await utils.resolve(await utils.request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ params: utils.encodeAES(body) }) }));
        const got: string[] = (reply?.[kind] ?? []).map(String);
        if (got.length !== part.length) throw new Error("không đổi được mã hội thoại");
        part.forEach((id, k) => real.set(`${kind}:${id}`, got[k]!.replace(/^g/, "")));
      }
    };
    await resolve("fids", [...new Set([...chats.filter((c) => !c.group).map((c) => c.id), ...rows.flat().map((r) => r.sender)])]);
    await resolve("gids", chats.filter((c) => c.group).map((c) => c.id));
    const person = (s: string) => real.get(`fids:${s}`) ?? s;

    let messages = 0;
    d.batch(() => {
      chats.forEach((c, n) => {
        const threadId = real.get(`${c.group ? "gids" : "fids"}:${c.id}`);
        if (!threadId) return;
        for (const row of rows[n]!) {
          d.ingest(toRaw(row, person, parseBlob), threadId, c.group ? 1 : 0);
          messages++;
        }
      });
    });
    await d.afterImport();
    ok = true;
    d.notify(`Đã nhập ${messages} tin nhắn từ ${chats.length} cuộc trò chuyện`);
    return { chats: chats.length, messages };
  } catch (e: any) {
    // Withdraw the request so the phone stops waiting.
    if (!d.resume) await call("/api/message/cancel_pull_mobile_msg", { pc_name: hostname(), public_key: publicKey, imei: ctx.imei }).catch(() => {});
    d.notify(`Đồng bộ thất bại: ${e?.message ?? e}`);
    throw e;
  } finally {
    off();
    if (ok && !d.resume) await call("/api/message/delete_snapshot_mobile_msg", { public_key: publicKey, imei: ctx.imei }).catch(() => {});
    // A failed import keeps its decrypted copy (resume: true retries it); everything else is cleaned up.
    if (ok || !existsSync(out)) rmSync(d.cacheDir, { recursive: true, force: true });
    running = false;
  }
}
