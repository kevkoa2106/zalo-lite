import { expect, test } from "bun:test";
import { GAP_MS, gapLabel, isGap } from "./format";

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
