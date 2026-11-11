import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupChats, readChat, toRaw } from "./crossdb";
import { normalize, previewOf } from "./normalize";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "crossdb-"));
  const db = new Database(join(dir, "group_123456789.db"));
  db.run(`CREATE TABLE ChatContent (SenderId INTEGER, CliMsgId INTEGER, GlbMsgId INTEGER, MsgStatus INTEGER, MsgType INTEGER, TimeStamp INTEGER, TTL INTEGER, MsgContent TEXT, RefCliMsgId INTEGER, BinNet BLOB, LocalPath TEXT, SeqId INTEGER, FLStatus INTEGER, E2EE TEXT)`);
  const put = db.prepare("INSERT INTO ChatContent (SenderId, CliMsgId, GlbMsgId, MsgStatus, MsgType, TimeStamp, MsgContent, BinNet) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  put.run(111111111, 1, 8000000000001, 3, 0, 1000, "xin chào", new Uint8Array([1]));
  put.run(222222222, 2, 8000000000002, 3, 12, 2000, "", new Uint8Array([2]));
  put.run(222222222, 3, 8000000000003, 3, 20, 3000, "group notice", null); // skipped type
  put.run(222222222, 4, 8000000000004, 0, 0, 4000, "removed", null); // MsgStatus 0
  db.close();
  return dir;
}

test("reads newest readable rows and keeps ids exact", () => {
  const dir = fixture();
  expect(backupChats(dir)).toMatchObject([{ id: "123456789", group: true }]);
  const rows = readChat(join(dir, "group_123456789.db"), 10);
  expect(rows.map((r) => r.glb)).toEqual(["8000000000002", "8000000000001"]);
  expect(readChat(join(dir, "group_123456789.db"), 1)).toHaveLength(1);
});

test("rows become messages the app understands, calls included", () => {
  const dir = fixture();
  const rows = readChat(join(dir, "group_123456789.db"), 10);
  const parse = (b: Uint8Array) =>
    b[0] === 2
      ? { result: 0, data: { attachs: [{ childNumber: 0, action: "recommened.calltime", params: { duration: 17, calltype: 0, isCaller: false } }] } }
      : { result: 0, data: { attachs: [{ childNumber: 0 }] } };
  const real = (s: string) => ({ "111111111": "me", "222222222": "peer" })[s] ?? s;
  const [call, text] = rows.map((r) => normalize(toRaw(r, real, parse), "g", 1, "me"));
  expect(text).toMatchObject({ kind: "text", text: "xin chào", from: "me", ts: 1000 });
  expect(call).toMatchObject({ kind: "call", from: "peer" });
  expect(previewOf(call!)).toBe("[Cuộc gọi thoại đến]");
  expect((call!.attach!.call as any).detail).toBe("0 phút 17 giây");
});

test("mentions in a backup row's BinNet reach the message", () => {
  const row = { sender: "1", glb: "9", cli: "1", type: 0, ts: 1, text: "@An ơi", bin: new Uint8Array([1]) };
  const parse = () => ({ result: 0, data: { mentions: [{ type: 0, uid: 42, pos: 0, len: 3 }] } });
  expect(normalize(toRaw(row, (s) => s, parse), "g", 1, "me").mentions).toEqual([{ uid: "42", pos: 0, len: 3 }]);
});

test("a backup row's quote reaches the message, with the quoted sender's real id", () => {
  const row = { sender: "1", glb: "9", cli: "1", type: 0, ts: 1, text: "ok", bin: new Uint8Array([1]) };
  const parse = () => ({ result: 0, data: { quote: { ownerId: 7, cliMsgId: 5, globalMsgId: 123, cliMsgType: 1, ts: 100, msg: "hi", fromD: "An" } } });
  expect(normalize(toRaw(row, (s) => `real${s}`, parse), "g", 1, "me").quote).toMatchObject({ from: "real7", dName: "An", text: "hi", id: "123", ts: 100 });
});
