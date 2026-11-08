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
