import { expect, test } from "bun:test";
import { findMatch, fold, snippet } from "./search";
import { openStore, type Msg } from "./store";

test("fold ignores case, accents and đ", () => {
  expect(fold("Xin Chào ĐÀ Nẵng")).toBe("xin chao da nang");
  expect(fold("")).toBe("");
});

test("findMatch finds the query with or without accents and returns positions in the original text", () => {
  const t = "Hẹn gặp ở Đà Nẵng nhé";
  const m = findMatch(t, "da nang")!;
  expect(t.slice(m.start, m.end)).toBe("Đà Nẵng");
  const g = findMatch(t, "GẶP")!;
  expect(t.slice(g.start, g.end)).toBe("gặp");
  // text written with separate combining marks (NFD) still maps back to whole characters
  const nfd = "chào bạn".normalize("NFD");
  const n = findMatch(nfd, "chao")!;
  expect(nfd.slice(n.start, n.end).normalize("NFC")).toBe("chào");
  expect(findMatch(t, "hà nội")).toBeNull();
  expect(findMatch(t, "   ")).toBeNull();
});

test("snippet keeps the hit with context on one line and marks cut ends", () => {
  const t = "a".repeat(60) + "\nHIT\n" + "b".repeat(60);
  const start = t.indexOf("HIT");
  const s = snippet(t, start, start + 3, 10);
  expect(s.hit).toBe("HIT");
  expect(s.before).toBe("…" + "a".repeat(9) + " ");
  expect(s.after).toBe(" " + "b".repeat(9) + "…");
  const short = snippet("hi there", 3, 8);
  expect(short).toEqual({ before: "hi ", hit: "there", after: "" });
});

const msg = (id: string, thread: string, ts: number, text: string, over: Partial<Msg> = {}): Msg => ({
  id, cliMsgId: "", threadId: thread, type: 0, from: "u", dName: "Người thử", ts, kind: "text", text,
  attach: null, quote: null, undone: false, reactions: {}, raw: {}, ...over,
});

test("store.search finds text newest first, leaves out recalled messages, honours the limit and short queries", () => {
  const s = openStore(":memory:");
  s.putMsg(msg("1", "A", 1, "Đi ăn phở không?"));
  s.putMsg(msg("2", "B", 3, "pho bò ngon"));
  s.putMsg(msg("3", "A", 2, "phở này đã thu hồi", { undone: true }));
  s.putMsg(msg("4", "A", 4, "", { kind: "photo" }));
  const r = s.search("PHO");
  expect(r.map((x) => x.id)).toEqual(["2", "1"]);
  expect(r[1]).toMatchObject({ threadId: "A", from: "u", dName: "Người thử", ts: 1, before: "Đi ăn ", hit: "phở", after: " không?" });
  expect(s.search("pho", 1).map((x) => x.id)).toEqual(["2"]);
  expect(s.search("p")).toEqual([]);
  expect(s.search("  ")).toEqual([]);
  expect(s.search("không có gì")).toEqual([]);
});
