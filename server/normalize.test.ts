import { expect, test } from "bun:test";
import { callInfo, normalize, previewOf } from "./normalize";

test("text from self", () => {
  const m = normalize({ msgId: "1", cliMsgId: "2", uidFrom: "0", msgType: "webchat", content: "chào", ts: "1700000000000" }, "t", 0, "me");
  expect(m).toMatchObject({ id: "1", from: "me", kind: "text", text: "chào", ts: 1700000000000 });
  expect(previewOf(m)).toBe("chào");
});

test("photo with params and quote", () => {
  const m = normalize(
    {
      msgId: "3", uidFrom: "u9", dName: "Gia Minh", msgType: "chat.photo", ts: "1",
      content: { href: "https://x/p.jpg", thumb: "https://x/t.jpg", params: '{"width":800,"height":600}', description: "" },
      quote: { ownerId: "me", fromD: "Khoa", msg: "hi", cliMsgType: 1 },
    },
    "g", 1, "me",
  );
  expect(m.kind).toBe("photo");
  expect(m.attach?.params).toEqual({ width: 800, height: 600 });
  expect(m.quote).toEqual({ from: "me", dName: "Khoa", text: "hi" });
  expect(previewOf(m)).toBe("Hình ảnh");
});

test("recalled and unknown types", () => {
  expect(normalize({ msgId: "4", uidFrom: "u", msgType: "chat.undo", content: {}, ts: "1" }, "t", 0, "me").undone).toBe(true);
  expect(normalize({ msgId: "5", uidFrom: "u", msgType: "chat.location.new", content: {}, ts: "1" }, "t", 0, "me").kind).toBe("other");
});

test("call bubbles follow Zalo PC titles", () => {
  const raw = (action: string, params: object) => ({ msgId: "9", uidFrom: "u", msgType: "chat.recommended", content: { action, params: JSON.stringify(params) }, ts: "1" });
  const m = normalize(raw("recommened.calltime", { duration: 17, calltype: 0, isCaller: false }), "t", 0, "me");
  expect(m.kind).toBe("call");
  expect(m.attach?.call).toMatchObject({ title: "Cuộc gọi thoại đến", detail: "0 phút 17 giây", tone: "ok" });
  expect(previewOf(m)).toBe("[Cuộc gọi thoại đến]");
  expect(callInfo("recommened.misscall", { isCaller: false, calltype: 0 })).toMatchObject({ title: "Bạn bị nhỡ", detail: "Cuộc gọi thoại", tone: "missed" });
  expect(callInfo("recommened.misscall", { isCaller: false, calltype: 1, reason: 3 })).toMatchObject({ title: "Bạn đã từ chối", detail: "Cuộc gọi video", tone: "rejected" });
  expect(callInfo("recommened.misscall", { isCaller: true, reason: 2 })).toMatchObject({ title: "Cuộc gọi thoại đi", detail: "0 phút 0 giây" });
  expect(callInfo("recommened.calltime", { duration: 3725, isCaller: true }).detail).toBe("1 giờ 2 phút 5 giây");
});
