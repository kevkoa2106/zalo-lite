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

test("recentOf returns newest of a kind", () => {
  const s = openStore(":memory:");
  s.putMsg(msg("1", "A", 1, "sticker"));
  s.putMsg(msg("2", "A", 2));
  s.putMsg(msg("3", "A", 3, "sticker"));
  expect(s.recentOf("sticker", 5).map((m) => m.id)).toEqual(["3", "1"]);
});
