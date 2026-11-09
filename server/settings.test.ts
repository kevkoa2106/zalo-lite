import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS, loadSettings, sanitize, saveSettings } from "./settings";
import { isoDob, profileOf } from "./profile";

test("sanitize keeps known keys with valid values and ignores the rest", () => {
  expect(sanitize({ remember: false, cachePerChat: 5000, evil: 1 })).toEqual({ remember: false, cachePerChat: 5000 });
  expect(sanitize({ remember: "no", cachePerChat: 42 })).toEqual(DEFAULTS); // wrong types and values fall back
  expect(sanitize({ cachePerChat: 1000 }, { remember: false, cachePerChat: 3000 })).toEqual({ remember: false, cachePerChat: 1000 });
  expect(sanitize(null)).toEqual(DEFAULTS);
  expect(sanitize("x")).toEqual(DEFAULTS);
});

test("settings are saved to a private file and read back; a missing or broken file gives the defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "zl-settings-"));
  const f = join(dir, "settings.json");
  expect(loadSettings(f)).toEqual(DEFAULTS);
  saveSettings(f, { remember: false, cachePerChat: 1000 });
  expect(loadSettings(f)).toEqual({ remember: false, cachePerChat: 1000 });
  expect(statSync(f).mode & 0o777).toBe(0o600);
  writeFileSync(f, "{ not json");
  expect(loadSettings(f)).toEqual(DEFAULTS);
  expect(readFileSync(f, "utf8")).toBe("{ not json"); // loading never rewrites the file
});

test("isoDob turns Zalo's dd/mm/yyyy into YYYY-MM-DD, with a seconds fallback", () => {
  expect(isoDob("05/03/1990", 0)).toBe("1990-03-05");
  expect(isoDob("5/3/1990", 0)).toBe("1990-03-05");
  expect(isoDob("", Date.UTC(1990, 2, 4, 17, 0, 0) / 1000)).toBe("1990-03-05"); // Vietnam midnight is 17:00 UTC the day before
  expect(isoDob("", 0)).toBe("");
  expect(isoDob(undefined, undefined)).toBe("");
  expect(isoDob("1990-03-05", 0)).toBe(""); // not Zalo's format and no usable seconds
});

test("profileOf maps zca-js's profile and survives missing fields", () => {
  const p = profileOf({ displayName: "Người dùng thử", avatar: "https://a/b.jpg", cover: "https://c/d.jpg", gender: 1, sdob: "01/02/1991", phoneNumber: "+84900000000" }, "100");
  expect(p).toEqual({ id: "100", name: "Người dùng thử", avatar: "https://a/b.jpg", cover: "https://c/d.jpg", gender: 1, dob: "1991-02-01", phone: "+84900000000" });
  expect(profileOf({}, "7")).toEqual({ id: "7", name: "", avatar: "", cover: "", gender: 0, dob: "", phone: "" });
  expect(profileOf({ zaloName: "Z", gender: 5 }, "7").gender).toBe(0);
});
