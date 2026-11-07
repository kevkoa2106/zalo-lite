// Zalo's phone backup without Zalo PC's native library. Layer B of the container (docs/PROTOCOL.md):
// the decrypted archive "ZDB4.0": a hashed header listing the files, then one XZ stream holding them back to back.
import { XzReadableStream } from "xz-decompress";

export type Entry = { name: string; data: Uint8Array };

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
