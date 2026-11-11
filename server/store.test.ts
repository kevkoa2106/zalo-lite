import { expect, test } from "bun:test";
import { openStore, type Msg } from "./store";

const msg = (id: string, thread: string, ts: number, kind: Msg["kind"] = "text"): Msg =>
  ({ id, cliMsgId: "", threadId: thread, type: 0, from: "u", dName: "", ts, kind, text: "", attach: null, quote: null, undone: false, reactions: {}, raw: {} });

test("prune keeps the newest messages of each chat", () => {
  const s = openStore(":memory:");
  for (let i = 1; i <= 5; i++) (s.putMsg(msg(`a${i}`, "A", i)), s.putMsg(msg(`b${i}`, "B", i)));
  expect(s.prune(2)).toBe(6);
  expect(s.page("A").map((m) => m.id)).toEqual(["a4", "a5"]);
  expect(s.page("B").map((m) => m.id)).toEqual(["b4", "b5"]);
});

test("slim keeps the newest raw copies, empties older ones, and is idempotent", () => {
  const s = openStore(":memory:");
  const full = (id: string, ts: number, content: unknown): Msg => ({
    ...msg(id, "A", ts), text: `t${id}`,
    raw: { msgId: id, cliMsgId: `c${id}`, uidFrom: "u", idTo: "x", msgType: "webchat", ts: String(ts), ttl: 0, content, junk: "x".repeat(500) },
  });
  s.putMsg(full("1", 1, "old text"));
  s.putMsg(full("2", 2, { title: "photo", params: "p".repeat(500) }));
  s.putMsg(full("3", 3, "newest"));
  expect(s.slim(1)).toBe(2);
  expect(s.slim(1)).toBe(0);
  expect(s.msg("3")!.raw).toHaveProperty("junk"); // newest keeps its full copy
  expect(s.msg("1")!.raw).toEqual({ slim: 1 });
  expect(s.msg("2")!.raw).toEqual({ slim: 1 });
  expect(s.msg("2")!.text).toBe("t2"); // the message itself is untouched
});

test("recentOf returns newest of a kind", () => {
  const s = openStore(":memory:");
  s.putMsg(msg("1", "A", 1, "sticker"));
  s.putMsg(msg("2", "A", 2));
  s.putMsg(msg("3", "A", 3, "sticker"));
  expect(s.recentOf("sticker", 5).map((m) => m.id)).toEqual(["3", "1"]);
});

test("a recall is remembered: it applies to an original that arrives later, and to one already stored", () => {
  const s = openStore(":memory:");
  s.putMsg(msg("1", "A", 1));
  expect(s.recall("1")?.undone).toBe(true); // stored message flips
  expect(s.msg("1")!.undone).toBe(true);
  expect(s.recall("1")).toBeNull(); // nothing changes the second time
  expect(s.recall("2")).toBeNull(); // not stored yet: only remembered
  expect(s.recalled("2")).toBe(true);
  expect(s.recalled("3")).toBe(false);
});

test("a delete-for-me is remembered", () => {
  const s = openStore(":memory:");
  s.putMsg(msg("1", "A", 1));
  s.delMsg("1");
  s.markDeleted("1");
  expect(s.msg("1")).toBeNull();
  expect(s.deleted("1")).toBe(true);
  expect(s.deleted("2")).toBe(false);
});

test("recallNotices finds stored recall notices and the message each recalls, not recalled media", () => {
  const s = openStore(":memory:");
  s.putMsg({ ...msg("n1", "A", 5, "other"), undone: true, attach: { globalMsgId: "1", cliMsgId: "9" } });
  s.putMsg({ ...msg("v1", "A", 6, "voice"), undone: true, attach: { href: "x" } });
  s.putMsg(msg("1", "A", 1));
  expect(s.recallNotices()).toEqual([{ id: "n1", target: "1" }]);
});

test("missingMentions finds messages whose raw has mentions the stored message lacks", () => {
  const s = openStore(":memory:");
  const m = [{ uid: "u2", pos: 0, len: 3 }];
  s.putMsg({ ...msg("old", "A", 1), raw: { mentions: m } });
  s.putMsg({ ...msg("ok", "A", 2), raw: { mentions: m }, mentions: m });
  s.putMsg({ ...msg("empty", "A", 3), raw: { mentions: [] } });
  s.putMsg({ ...msg("slim", "A", 4), raw: { slim: 1 } });
  expect(s.missingMentions().map((x) => x.id)).toEqual(["old"]);
});

test("missingQuoteIds finds messages whose stored quote lacks the target's id and time", () => {
  const s = openStore(":memory:");
  const q = { from: "u2", dName: "B", text: "hi" };
  s.putMsg({ ...msg("old", "A", 1), raw: { quote: { globalMsgId: 5 } }, quote: q });
  s.putMsg({ ...msg("ok", "A", 2), raw: { quote: { globalMsgId: 5 } }, quote: { ...q, id: "5" } });
  s.putMsg({ ...msg("none", "A", 3), raw: {} });
  s.putMsg({ ...msg("slim", "A", 4), raw: { slim: 1 }, quote: q });
  expect(s.missingQuoteIds().map((x) => x.id)).toEqual(["old"]);
});

test("count returns the number of stored messages", () => {
  const s = openStore(":memory:");
  expect(s.count()).toBe(0);
  s.putMsg(msg("1", "A", 1));
  s.putMsg(msg("2", "B", 2));
  expect(s.count()).toBe(2);
});
