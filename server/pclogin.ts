// Zalo PC's own QR login (docs/PROTOCOL.md, "PC QR login"), as seen in the 26.10.20 bundle:
//   getQRCode       GET wpa.chat.zalo.me/api/login/reqqr, params signed like getLoginInfo ("reqqr")
//   getStatusQRCode long-poll the server-given chk_wait_scan URL, then chk_wait_cfirm
//   on confirm      the reply carries zpw_sek, which Zalo PC installs as its session cookie
// The session it yields is then opened with zca-js's cookie login.
import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { CookieJar } from "tough-cookie";

const PARAM_CIPHER_KEY = "3FC4F0D2AB50057BCE0D90D9187A22B1"; // in the bundle, see ParamCipher
const API_TYPE = 30;
const API_VERSION = 694; // Zalo PC 26.10.20
const ZERO_IV = Buffer.alloc(16);
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const aes = (key: string, text: string, out: "hex" | "base64") => {
  const c = createCipheriv("aes-256-cbc", Buffer.from(key, "utf8"), ZERO_IV);
  return Buffer.concat([c.update(text, "utf8"), c.final()]).toString(out);
};
export const decrypt = (key: string, b64: string) => {
  const d = createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), ZERO_IV);
  return Buffer.concat([d.update(Buffer.from(decodeURIComponent(b64), "base64")), d.final()]).toString("utf8");
};
const split = (s: string) => [...s].reduce<[string[], string[]]>((acc, ch, i) => (acc[i % 2]!.push(ch), acc), [[], []]);

/** ParamCipher: zcid identifies the client, encryptKey is derived from zcid and a random zcid_ext. */
export function paramCipher(imei: string, firstLaunchTime = Date.now()) {
  const zcid = aes(PARAM_CIPHER_KEY, `${API_TYPE},${imei},${firstLaunchTime}`, "hex").toUpperCase();
  const zcidExt = Math.random().toString(16).slice(2, 2 + 6 + Math.floor(Math.random() * 7));
  const [even] = split(md5(zcidExt).toUpperCase());
  const [zEven, zOdd] = split(zcid);
  const encryptKey = even.slice(0, 8).join("") + zEven.slice(0, 12).join("") + zOdd.reverse().slice(0, 12).join("");
  return { zcid, zcidExt, encryptKey };
}

export const signKey = (name: string, params: Record<string, unknown>) =>
  md5("zsecure" + name + Object.keys(params).sort().map((k) => params[k]).join(""));

/**
 * encryptParam(data, name) from the bundle: encrypted data plus zcid params, type, version and signkey.
 * Verified live against wpa.chat.zalo.me: reqqr only accepts a signature computed over the query
 * INCLUDING zpw_ver and zpw_type (error 18022 otherwise), unlike getLoginInfo's web-style signing.
 */
export function signedParams(name: string, imei: string, data: Record<string, unknown>) {
  const { zcid, zcidExt, encryptKey } = paramCipher(imei);
  const params: Record<string, string | number> = {
    zcid,
    zcid_ext: zcidExt,
    enc_ver: "v2",
    params: aes(encryptKey, JSON.stringify(data), "base64"),
    type: API_TYPE,
    client_version: API_VERSION,
    zpw_ver: API_VERSION,
    zpw_type: API_TYPE,
  };
  params.signkey = signKey(name, params);
  return { params, enk: encryptKey };
}

// fetch with a cookie jar, like the Electron session Zalo PC runs in.
async function get(jar: CookieJar, url: string, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Cookie: await jar.getCookieString(url), Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  for (const c of res.headers.getSetCookie()) await jar.setCookie(c, url, { ignoreError: true });
  return res.json() as Promise<{ error_code: number; error_message?: string; data?: any }>;
}

export type PcQrEvent =
  | { type: "qr"; image: string }
  | { type: "scanned"; name: string; avatar: string }
  | { type: "expired" };

export class PcQrError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

/** Runs the whole PC QR flow. Resolves with zca-js login credentials once you confirm on the phone. */
export async function loginPcQr(emit: (e: PcQrEvent) => void, signal: AbortSignal) {
  const jar = new CookieJar();
  const imei = `${randomUUID()}-${md5(USER_AGENT)}`;
  const data = {
    language: "vi",
    client_time: Math.round(Date.now() / 1000),
    imei,
    computer_name: hostname(),
    logged_uids: "",
    self_g: 0, // no "trusted device" QR: that variant is re-rendered by native code
    qr_form: 0,
  };
  const { params, enk } = signedParams("reqqr", imei, data);
  const url = new URL("https://wpa.chat.zalo.me/api/login/reqqr");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await get(jar, url.toString());
  if (res.error_code !== 0 || !res.data) throw new PcQrError(res.error_message || "reqqr failed", res.error_code);
  // The decrypted reply is itself an envelope: {error_code, error_message, data: {base64_qr, chk_wait_*, ...}}.
  const reply = JSON.parse(decrypt(enk, res.data));
  if (reply.error_code !== 0 || !reply.data) throw new PcQrError(reply.error_message || "reqqr refused", reply.error_code);
  const qr = reply.data;
  emit({ type: "qr", image: String(qr.base64_qr ?? "") });

  // Long-poll a server-given URL until it answers 0 (done), with -20 meaning a fresh QR image.
  const wait = async (target: string) => {
    for (let i = Math.max(1, Number(qr.qr_retry) || 1); i > 0; i--) {
      if (signal.aborted) throw new PcQrError("aborted");
      let r;
      try {
        r = await get(jar, target, (Number(qr.qr_timeout) || 30) * 1000 + 5000);
      } catch (e) {
        if (signal.aborted) throw new PcQrError("aborted");
        continue; // a long-poll timeout just means "not yet"
      }
      if (r.error_code === 0 && r.data) return r.data;
      if (r.error_code === -20 && r.data?.base64_qr) emit({ type: "qr", image: String(r.data.base64_qr) });
      // Zalo PC stops only on -21 (relink failed) and 18010; anything else is another try.
      else if (r.error_code === -21 || r.error_code === 18010)
        throw new PcQrError(r.error_message || `QR login failed (${r.error_code})`, r.error_code);
    }
    emit({ type: "expired" });
    throw new PcQrError("QR expired");
  };

  if (!qr.chk_wait_scan || !qr.chk_wait_cfirm) throw new PcQrError("reqqr reply has no polling URLs");
  const scanned = await wait(String(qr.chk_wait_scan));
  emit({ type: "scanned", name: String(scanned.display_name ?? ""), avatar: String(scanned.avatar ?? "") });
  const done = await wait(String(qr.chk_wait_cfirm));
  if (!done.zpw_sek) throw new PcQrError("confirm reply has no session");
  // Zalo PC: $zelectron.setAppCookie(zpw_sek) for chat.zalo.me.
  await jar.setCookie(`zpw_sek=${done.zpw_sek}; Domain=.chat.zalo.me; Path=/; Secure; HttpOnly`, "https://chat.zalo.me");
  return { cookie: jar.toJSON()!.cookies, imei, userAgent: USER_AGENT, uid: String(done.uid ?? "") };
}
