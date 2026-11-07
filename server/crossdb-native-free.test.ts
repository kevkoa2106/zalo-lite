import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { unpackArchive } from "./crossdb-native-free";

// An XZ stream of the five bytes "hello", made with Python's lzma module.
const XZ_HELLO = Buffer.from("/Td6WFoAAAFpIt42AgAhARYAAAB0L+WjAQAEaGVsbG8AAAAAhqYQNgABGQW86OzLkEKZDQEAAAAAAVla", "base64");

function archive(files: [string, number][], xz: Uint8Array, corruptHash = false) {
  const entries = files.map(([n, size]) => {
    const name = Buffer.from(n);
    const b = Buffer.alloc(8 + name.length);
    b.writeUInt32BE(name.length, 0);
    name.copy(b, 4);
    b.writeUInt32BE(size, 4 + name.length);
    return b;
  });
  const head = Buffer.concat([Buffer.alloc(4), ...entries]); // bytes 14.. : file count, then the entries
  head.writeUInt32BE(files.length, 0);
  const end = 14 + head.length + xz.length; // the length field and the hash both cover the XZ payload too
  const hash = Bun.hash.xxHash32(Buffer.concat([head, xz]), 0) >>> 0;
  const fixed = Buffer.alloc(14);
  fixed.write("ZDB4.0\0");
  fixed.writeUInt32BE(end, 6);
  fixed.writeUInt32BE(corruptHash ? (hash ^ 1) >>> 0 : hash, 10);
  return new Uint8Array(Buffer.concat([fixed, head, xz]));
}

test("splits the XZ payload into the listed files", async () => {
  const out = await unpackArchive(archive([["a.db", 3], ["group_1.db", 2]], XZ_HELLO));
  expect(out.map((f) => f.name)).toEqual(["a.db", "group_1.db"]);
  expect(Buffer.from(out[0]!.data).toString()).toBe("hel");
  expect(Buffer.from(out[1]!.data).toString()).toBe("lo");
});

test("rejects a bad magic, a corrupt header hash and a size mismatch", async () => {
  await expect(unpackArchive(new Uint8Array(40))).rejects.toThrow("bad magic");
  await expect(unpackArchive(archive([["a.db", 5]], XZ_HELLO, true))).rejects.toThrow("hash mismatch");
  await expect(unpackArchive(archive([["a.db", 6]], XZ_HELLO))).rejects.toThrow("size mismatch");
});

// Against a real backup, when one was captured with ZL_KEEP_FIXTURE=1 (never committed). Zalo's own output is the oracle.
const fx = `${process.env.HOME}/Library/Application Support/dev.khoa.zalolite/cache/fixture`;
test.skipIf(!existsSync(`${fx}/backup.dec`))("matches Zalo's own output byte for byte on a real backup", async () => {
  const out = await unpackArchive(readFileSync(`${fx}/backup.dec`));
  expect(out.length).toBeGreaterThan(0);
  for (const f of out) expect(Buffer.compare(Buffer.from(f.data), readFileSync(`${fx}/oracle/${f.name}`))).toBe(0);
});
