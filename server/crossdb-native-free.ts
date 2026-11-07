// Zalo's phone backup without Zalo PC's native library. Layer B of the container (docs/PROTOCOL.md):
// the decrypted archive "ZDB4.0": a hashed header listing the files, then one XZ stream holding them back to back.
import { createDecipheriv } from "node:crypto";
import { XzReadableStream } from "xz-decompress";

export type Entry = { name: string; data: Uint8Array };

const CHUNK = 65536;

/**
 * Layer A of a format 1 backup: AES-256-CBC in chunks of 64 KB, a zero IV restarted for every chunk, the key being the
 * first 32 characters of the upper-case hex secret. Verified on a real backup against Zalo PC's library. A trailing
 * partial block is left as it is: it lies after the hashed region, where nothing reads it.
 */
export function decryptBackup(enc: Uint8Array, secret: string): Uint8Array {
  const key = Buffer.from(secret.slice(0, 32), "latin1");
  if (key.length !== 32) throw new Error("backup key is too short");
  const out = new Uint8Array(enc.length);
  for (let o = 0; o < enc.length; o += CHUNK) {
    const chunk = enc.subarray(o, Math.min(o + CHUNK, enc.length));
    const full = chunk.length - (chunk.length % 16);
    const d = createDecipheriv("aes-256-cbc", key, Buffer.alloc(16)).setAutoPadding(false);
    out.set(Buffer.concat([d.update(chunk.subarray(0, full)), d.final()]), o);
    out.set(chunk.subarray(full), o + full);
  }
  return out;
}

/** Split a decrypted backup archive into its files. Throws on a bad magic, hash or size, never returns a partial result. */
export async function unpackArchive(p: Uint8Array): Promise<Entry[]> {
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  if (p.length < 18 || new TextDecoder("latin1").decode(p.subarray(0, 6)) !== "ZDB4.0") throw new Error("not a Zalo backup archive (bad magic)");
  const end = v.getUint32(6);
  const count = v.getUint32(14);
  if (end < 18 || end > p.length) throw new Error("backup archive header is truncated");
  if (Bun.hash.xxHash32(p.subarray(14, end), 0) >>> 0 !== v.getUint32(10)) throw new Error("backup archive header is corrupt (hash mismatch)");

  let at = 18;
  const names: { name: string; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > end) throw new Error("backup archive file list is truncated");
    const len = v.getUint32(at);
    if (len > 128 || at + 8 + len > end) throw new Error("backup archive file list is corrupt");
    const name = new TextDecoder().decode(p.subarray(at + 4, at + 4 + len));
    // Names become file names on disk: a backup is untrusted input, so refuse anything that is not a plain file name.
    if (!name || name.startsWith(".") || /[\\/\0]/.test(name)) throw new Error("backup archive has an unsafe file name");
    const size = v.getUint32(at + 4 + len);
    if (size > 2_000_000_000) throw new Error("backup archive file size is out of range");
    names.push({ name, size });
    at += 8 + len;
  }

  const xz = new Uint8Array(await new Response(new XzReadableStream(new Blob([p.slice(at, end)]).stream())).arrayBuffer());
  const total = names.reduce((n, f) => n + f.size, 0);
  if (xz.length !== total) throw new Error(`backup archive size mismatch (${xz.length} bytes, expected ${total})`);
  let off = 0;
  return names.map(({ name, size }) => ({ name, data: xz.subarray(off, (off += size)) }));
}
