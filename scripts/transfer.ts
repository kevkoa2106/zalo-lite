// Phone-to-PC message transfer, end to end (docs/PROTOCOL.md, "Phone-to-PC transfer").
//   bun scripts/transfer.ts          ask the phone, download the backup, decrypt it into the cache folder
//   bun scripts/transfer.ts --self   offline check of the key and library steps
// Prints sizes, counts and file names only: never links, keys or message text.
import { Zalo } from "zca-js";
import { constants, createHash, generateKeyPairSync, privateDecrypt, publicEncrypt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { decodeEventData } from "../node_modules/zca-js/dist/utils.js";

const DATA = process.env.ZL_DATA ?? join(homedir(), "Library", "Application Support", "zalo-lite");
export const CACHE = join(DATA, "cache", "transfer"); // a cache: deleted after import, never inside the repo
const LIB = "/Applications/Zalo.app/Contents/Resources/app.asar.unpacked/native/nativelibs/db-cross-v4/prebuilt/darwin/electron";

const newKey = () => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });

/** encrypted_key -> the secret Zalo's db library wants: RSA-PKCS1 private decrypt, hex for format 1, else base64. */
export function unwrapKey(encrypted: string, privatePem: string, format: number) {
  // Newer runtimes refuse RSA_PKCS1_PADDING for private decryption, so decrypt raw and strip the 00 02 <random> 00 padding here.
  const raw = privateDecrypt({ key: privatePem, padding: constants.RSA_NO_PADDING }, Buffer.from(encrypted, "base64"));
  if (raw[0] !== 0 || raw[1] !== 2) throw new Error("encrypted_key is not PKCS#1 v1.5 padded for our key");
  return raw.subarray(raw.indexOf(0, 2) + 1).toString(format === 1 ? "hex" : "base64");
}

function nativeLib() {
  const file = join(LIB, process.arch === "arm64" ? "arm64" : "x64", "db-cross-v4-native.node");
  if (!existsSync(file)) throw new Error("Zalo PC's db-cross-v4 library not found: install Zalo.app");
  const m: any = { exports: {} };
  process.dlopen(m, file);
  return m.exports as {
    decompressAndDecryptDb(inp: string, out: string, key: string): { result: number; err_message?: string };
    decompressAndDecryptDb_V2(inp: string, outDir: string, key: string, progress: () => void): { result: number; inner_error?: number; error_message?: string };
  };
}

if (process.argv.includes("--self")) {
  const kp = newKey();
  const pub = `-----BEGIN PUBLIC KEY-----\n${kp.publicKey.toString("base64")}\n-----END PUBLIC KEY-----`;
  const secret = Buffer.from("0123456789abcdef0123456789abcdef");
  const wrapped = publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_PADDING }, secret).toString("base64");
  const good = unwrapKey(wrapped, kp.privateKey as string, 1) === secret.toString("hex") && unwrapKey(wrapped, kp.privateKey as string, 0) === secret.toString("base64");
  console.log("key unwrap:", good ? "ok" : "FAIL");
  console.log("native library:", Object.keys(nativeLib()).join(", "));
  process.exit(good ? 0 : 1);
}

const sessionFile = [join(DATA, "session.json"), join(homedir(), "Library/Application Support/dev.khoa.zalolite/session.json")].find(existsSync);
if (!sessionFile) throw new Error("no saved session: sign in to Zalo Lite first");
const session = await Bun.file(sessionFile).json();
const api: any = await new Zalo({ logging: false, checkUpdate: false, selfListen: false, apiType: 30, apiVersion: 694 }).login({ cookie: session.cookie, imei: session.imei, userAgent: session.userAgent });
const box: any = {};
api.custom("grab", ({ ctx, utils }: any) => ((box.ctx = ctx), (box.utils = utils), true));
api.grab();
const { ctx, utils } = box;
const fileHost = api.zpwServiceMap.file[0];

const call = async (path: string, body: object) => {
  const url = utils.makeURL(`${fileHost}${path}`, { zpw_ver: 694, zpw_type: 30, nretry: 0, params: utils.encodeAES(JSON.stringify(body)) }, false);
  await utils.resolve(await utils.request(url, { method: "GET" }));
};

const kp = newKey();
const publicKey = kp.publicKey.toString("base64");
const asJson = (v: unknown) => {
  let s = v;
  if (typeof s === "string") {
    try { s = JSON.parse(decodeURIComponent(s)); } catch { try { s = JSON.parse(s as string); } catch {} }
  }
  return s as Record<string, any>;
};

// The phone answers on the realtime socket: user_confirm (accepted), syncmsg_info (backup ready), transfer_error.
const listener = api.listener;
listener.on("error", () => {});
listener.start({ retryOnClose: false });
for (let i = 0; i < 50 && !listener.ws; i++) await Bun.sleep(100);
let onInfo: (i: Record<string, any>) => void = () => {};
const info = new Promise<Record<string, any>>((r) => (onInfo = r));
listener.ws?.on("message", async (buf: Buffer) => {
  try {
    if (buf.readUInt16LE(1) !== 601) return;
    const parsed = JSON.parse(buf.subarray(4).toString("utf8"));
    const inner = (await decodeEventData(parsed, (listener as any).cipherKey)).data;
    for (const c of inner?.controls ?? []) {
      const content = c?.content ?? c;
      if (content?.act_type !== "syncmsgmb") continue;
      if (content.act === "user_confirm") console.log("phone: accepted");
      if (content.act === "transfer_error") console.log("phone: transfer_error", JSON.stringify({ can_retry: asJson(content.data)?.can_retry, error_code: asJson(content.data)?.error_code }));
      if (content.act === "syncmsg_info") onInfo(asJson(content.data));
    }
  } catch {}
});
await Bun.sleep(1500);

console.log(">>> asking your phone now: accept the Zalo sync prompt (waiting up to 10 minutes)");
await call("/api/message/pull_mobile_msg", { pc_name: hostname(), public_key: publicKey, from_seq_id: 0, is_retry: 0, min_seq_id: 0, temp_key: "", imei: ctx.imei });

let ok = false;
try {
  const timeout = Bun.sleep(600_000).then(() => Promise.reject(new Error("the phone did not accept in time")));
  const i = await Promise.race([info, timeout]);
  const db = i.db_info ?? {};
  console.log("backup ready:", JSON.stringify({ file_size: i.file_size, format: db.db_format, is_full: i.is_full_transfer, msgs: db.backup_db?.msg_total, threads: db.backup_db?.msg_thread, min_time: db.min_time_msg_at_all, device: i.device_name }));
  mkdirSync(CACHE, { recursive: true });
  const enc = join(CACHE, String(i.file_name).replace(/[^\w.-]/g, "_"));
  const out = join(CACHE, "decrypted");
  rmSync(out, { recursive: true, force: true });

  const res = await fetch(String(i.url), { headers: { cookie: ctx.cookie.getCookieStringSync(String(i.url)), "user-agent": ctx.userAgent } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await Bun.write(enc, res);
  const md5 = createHash("md5").update(new Uint8Array(await Bun.file(enc).arrayBuffer())).digest("hex");
  console.log("downloaded", statSync(enc).size, "bytes; md5", md5 === String(i.checksum_code).toLowerCase() ? "matches" : "DIFFERS");

  const format = Number(db.db_format) === 1 ? 1 : 0;
  const secret = unwrapKey(String(i.encrypted_key), kp.privateKey as string, format);
  const lib = nativeLib();
  mkdirSync(out, { recursive: true });
  const r: any = format === 1 ? lib.decompressAndDecryptDb_V2(enc, out, secret.toUpperCase(), () => {}) : lib.decompressAndDecryptDb(enc, join(out, "backup.db"), secret);
  console.log("decrypt result:", JSON.stringify({ result: r.result, inner: r.inner_error, message: r.error_message ?? r.err_message }));
  rmSync(enc, { force: true }); // the encrypted download is no longer needed
  console.log("decrypted files:", readdirSync(out).slice(0, 20).map((f) => `${f} (${statSync(join(out, f)).size} B)`).join(", "));
  ok = r.result === 0;
} catch (e: any) {
  console.log("transfer failed:", e?.message ?? e);
} finally {
  // Remove the phone-side snapshot only once everything worked; a failed run starts over from a new request.
  const done = ok ? ["/api/message/delete_snapshot_mobile_msg", { public_key: publicKey, imei: ctx.imei }] : ["/api/message/cancel_pull_mobile_msg", { pc_name: hostname(), public_key: publicKey, imei: ctx.imei }];
  await call(done[0] as string, done[1] as object).catch((e: any) => console.log("cleanup:", e?.code, e?.message));
  listener.stop();
  process.exit(ok ? 0 : 1);
}
