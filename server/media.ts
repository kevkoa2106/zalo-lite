// Audio the UI plays (voice messages). The backend fetches it because Zalo's file hosts serve audio as
// application/octet-stream, which Apple's webview will not play, and the webview's CSP keeps it off the network.

const HOSTS = /(^|\.)(zdn\.vn|zadn\.vn|zaloapp\.com|zalo\.me)$/;

/** Only https URLs on Zalo's own hosts: the UI hands us a URL, so this is what stops it being a general fetcher. */
export function isZaloMedia(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** Audio type from the first bytes (the servers' Content-Type cannot be trusted). */
export function sniffAudio(b: Uint8Array) {
  const s = (at: number, t: string) => [...t].every((c, i) => b[at + i] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xf6) === 0xf0) return "audio/aac"; // ADTS
  if (s(4, "ftyp")) return "audio/mp4";
  if (s(0, "#!AMR")) return "audio/amr";
  if (s(0, "ID3") || (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (s(0, "OggS")) return "audio/ogg";
  if (s(0, "RIFF")) return "audio/wav";
  return "application/octet-stream";
}

export const EXPIRED = "Tin nhắn thoại đã hết hạn trên máy chủ Zalo";

/** Download one audio file. Zalo deletes old voice files, which shows up as 403/404/410. */
export async function fetchAudio(url: string, limit = 25 * 1024 * 1024) {
  if (!isZaloMedia(url)) throw new Error("Địa chỉ âm thanh không hợp lệ");
  const res = await fetch(url, { redirect: "error" });
  if (res.status === 403 || res.status === 404 || res.status === 410) throw new Error(EXPIRED);
  if (!res.ok) throw new Error(`Không tải được tin nhắn thoại (HTTP ${res.status})`);
  if (Number(res.headers.get("content-length")) > limit) throw new Error("Tin nhắn thoại quá lớn");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > limit) throw new Error("Tin nhắn thoại quá lớn");
  return { bytes, type: sniffAudio(bytes) };
}
