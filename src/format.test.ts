import { expect, test } from "bun:test";
import { GAP_MS, dobLabel, findQuoted, gapLabel, isGap, splitMentions, voiceExt } from "./format";

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 11, 7, 12, 0);

test("gap pill label: time only today, plus the day word before today", () => {
  expect(gapLabel(at(2026, 11, 7, 9, 5), now)).toBe("09:05");
  expect(gapLabel(at(2026, 11, 6, 17, 16), now)).toBe("17:16 Hôm qua");
  expect(gapLabel(at(2026, 10, 5, 21, 30), now)).toBe("21:30 05/10/2026");
});

test("a pause counts from exactly GAP_MS", () => {
  expect(isGap(1000, 1000 + GAP_MS - 1)).toBe(false);
  expect(isGap(1000, 1000 + GAP_MS)).toBe(true);
});

test("splitMentions marks mention ranges and ignores bad ones", () => {
  const t = "Chào @Billie và @Timmy!";
  expect(splitMentions(t, [{ uid: "b", pos: 5, len: 7 }, { uid: "t", pos: 16, len: 6 }])).toEqual([
    { text: "Chào " }, { text: "@Billie", mention: true }, { text: " và " }, { text: "@Timmy", mention: true }, { text: "!" },
  ]);
  expect(splitMentions("@Billie", [{ uid: "b", pos: 0, len: 7 }])).toEqual([{ text: "@Billie", mention: true }]);
  // overlapping, empty, out of range, NaN and missing mentions all leave the text whole
  expect(splitMentions("abc", [{ uid: "x", pos: 1, len: 5 }, { uid: "x", pos: 0, len: 0 }, { uid: "x", pos: NaN, len: 1 }])).toEqual([{ text: "abc" }]);
  expect(splitMentions("abc")).toEqual([{ text: "abc" }]);
  expect(splitMentions("abcdef", [{ uid: "a", pos: 0, len: 4 }, { uid: "b", pos: 2, len: 2 }])).toEqual([{ text: "abcd", mention: true }, { text: "ef" }]);
});

test("findQuoted prefers the id and falls back to ts and sender", () => {
  const msgs = [{ id: "1", ts: 10, from: "a" }, { id: "2", ts: 20, from: "b" }, { id: "3", ts: 20, from: "c" }];
  expect(findQuoted(msgs, { id: "2", from: "x" })).toBe(msgs[1]);
  expect(findQuoted(msgs, { id: "99", ts: 20, from: "c" })).toBe(msgs[2]); // id lost precision, ts + sender still find it
  expect(findQuoted(msgs, { ts: 30, from: "a" })).toBeUndefined();
  expect(findQuoted(msgs, { from: "a" })).toBeUndefined();
});

test("voiceExt maps the recorder's type to a file extension the backend accepts", () => {
  expect(voiceExt("audio/mp4")).toBe("m4a");
  expect(voiceExt("audio/webm;codecs=opus")).toBe("webm");
  expect(voiceExt("audio/ogg;codecs=opus")).toBe("ogg");
  expect(voiceExt("")).toBe("m4a");
});

test("dobLabel writes an ISO date the way Zalo PC's account card does", () => {
  expect(dobLabel("1990-03-05")).toBe("05 tháng 03, 1990");
  expect(dobLabel("2001-12-31")).toBe("31 tháng 12, 2001");
  expect(dobLabel("")).toBe("");
  expect(dobLabel("05/03/1990")).toBe("");
});
