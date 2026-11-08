import { afterEach, expect, test } from "bun:test";
import { EXPIRED, fetchAudio, isZaloMedia, sniffAudio } from "./media";

const real = globalThis.fetch;
afterEach(() => void (globalThis.fetch = real));
const stub = (res: Response) => void (globalThis.fetch = (async () => res) as unknown as typeof fetch);

test("only https URLs on Zalo's own hosts are fetched", () => {
  expect(isZaloMedia("https://voice-aac-dl.zdn.vn/a/b.aac")).toBe(true);
  expect(isZaloMedia("https://f41-zfcloud.zdn.vn/x")).toBe(true);
  expect(isZaloMedia("http://f41-zfcloud.zdn.vn/x")).toBe(false);
  expect(isZaloMedia("https://zdn.vn.evil.com/x")).toBe(false);
  expect(isZaloMedia("https://evilzdn.vn/x")).toBe(false);
  expect(isZaloMedia("http://127.0.0.1:1234/x")).toBe(false);
  expect(isZaloMedia("not a url")).toBe(false);
});

test("audio type comes from the bytes", () => {
  expect(sniffAudio(Uint8Array.of(0xff, 0xf1, 0x60, 0x40))).toBe("audio/aac");
  expect(sniffAudio(Uint8Array.of(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70))).toBe("audio/mp4");
  expect(sniffAudio(new TextEncoder().encode("#!AMR\n"))).toBe("audio/amr");
  expect(sniffAudio(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3))).toBe("audio/webm");
  expect(sniffAudio(new TextEncoder().encode("RIFF....WAVE"))).toBe("audio/wav");
  expect(sniffAudio(Uint8Array.of(1, 2, 3))).toBe("application/octet-stream");
  expect(sniffAudio(Uint8Array.of())).toBe("application/octet-stream");
});

test("fetchAudio returns bytes and type; expired files and other hosts are refused", async () => {
  stub(new Response(Uint8Array.of(0xff, 0xf1, 1, 2), { headers: { "content-type": "application/octet-stream" } }));
  const ok = await fetchAudio("https://f41-zfcloud.zdn.vn/x");
  expect(ok.type).toBe("audio/aac");
  expect(ok.bytes.length).toBe(4);

  stub(new Response("gone", { status: 404 }));
  await expect(fetchAudio("https://voice-aac-dl.zdn.vn/x")).rejects.toThrow(EXPIRED);
  stub(new Response("err", { status: 500 }));
  await expect(fetchAudio("https://voice-aac-dl.zdn.vn/x")).rejects.toThrow("HTTP 500");
  stub(new Response(new Uint8Array(20)));
  await expect(fetchAudio("https://voice-aac-dl.zdn.vn/x", 10)).rejects.toThrow("quá lớn");
  await expect(fetchAudio("https://example.com/x")).rejects.toThrow("không hợp lệ");
});
