import { expect, test } from "bun:test";
import { normalize, previewOf } from "./normalize";

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
