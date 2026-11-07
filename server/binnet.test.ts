import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { parseBinNet } from "./binnet";
import { nativeLib } from "./crossdb";

function tlv(tag: number, value: Buffer) {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(tag, 0);
  h.writeUInt32BE(value.length, 4);
  return Buffer.concat([h, value]);
}
const int = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

test("parses a sticker-shaped blob: property, attachment, nested records", () => {
  const blob = Buffer.concat([
    tlv(5, Buffer.concat([tlv(30, int(0)), tlv(31, int(0)), tlv(32, int(1)), tlv(33, Buffer.from('{"a":0}'))])),
    tlv(6, Buffer.concat([tlv(40, Buffer.from("3")), tlv(41, int(11031)), tlv(42, int(32050)), tlv(44, int(-1))])),
  ]);
  expect(parseBinNet(blob)).toEqual({
    property: { size: 0, subType: 0, type: 1, ext: '{"a":0}' },
    attachs: [{ type: "3", catId: 11031, id: 32050, childNumber: -1 }],
  });
});

test("keeps several attachments in order, ignores unknown tags, rejects a truncated blob", () => {
  const two = Buffer.concat([tlv(6, tlv(47, Buffer.from("a"))), tlv(99, Buffer.from("x")), tlv(6, tlv(47, Buffer.from("b")))]);
  expect(parseBinNet(two).attachs).toEqual([{ title: "a" }, { title: "b" }]);
  expect(() => parseBinNet(two.subarray(0, two.length - 1))).toThrow("not a BinNet blob");
});

// Against Zalo's own library on a real captured backup (never committed); skipped when either is missing.
const fx = `${process.env.HOME}/Library/Application Support/dev.khoa.zalolite/cache/fixture/oracle`;
let haveLib = true;
try {
  nativeLib();
} catch {
  haveLib = false;
}
test.skipIf(!existsSync(fx) || !haveLib)("matches Zalo's library on every blob of a real backup", () => {
  const lib = nativeLib();
  let n = 0;
  for (const f of readdirSync(fx).filter((x) => x.endsWith(".db"))) {
    const db = new Database(`${fx}/${f}`);
    for (const r of db.query("SELECT BinNet b FROM ChatContent WHERE BinNet IS NOT NULL").all() as { b: Uint8Array }[]) {
      const theirs = lib.parseBinNet(new Uint8Array(r.b));
      if (theirs.result !== 0) continue;
      expect(parseBinNet(new Uint8Array(r.b))).toEqual(theirs.data as object);
      n++;
    }
    db.close();
  }
  expect(n).toBeGreaterThan(0);
});
