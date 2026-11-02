import type { Kind, Msg } from "./store";

const KINDS: Record<string, Kind> = {
  webchat: "text",
  "chat.photo": "photo",
  "chat.sticker": "sticker",
  "share.file": "file",
  "chat.recommended": "link",
  "chat.link": "link",
  "chat.video.msg": "video",
  "chat.voice": "voice",
  "chat.gif": "gif",
  "chat.call": "call",
};

// Labels the real client shows in the conversation list for non-text messages.
export const LABELS: Record<Kind, string> = {
  text: "",
  photo: "Hình ảnh",
  sticker: "Sticker",
  file: "File",
  link: "Link",
  video: "Video",
  voice: "Tin nhắn thoại",
  gif: "GIF",
  call: "Cuộc gọi",
  other: "Tin nhắn",
};

type Raw = Record<string, any>;

const parseJson = (s: unknown) => {
  if (typeof s !== "string" || !s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

export function normalize(raw: Raw, threadId: string, type: 0 | 1, ownId: string): Msg {
  const kind = KINDS[raw.msgType] ?? (String(raw.msgType).includes("call") ? "call" : "other");
  const c = raw.content;
  let text = "";
  let attach: Msg["attach"] = null;
  if (typeof c === "string") text = c;
  else if (c && typeof c === "object") {
    const params = parseJson(c.params);
    attach = { ...c, params };
    // Captions on photos/links travel in `title` (links) or `description` (photos); calls carry their text in `title`.
    text = kind === "link" ? String(c.href ?? c.title ?? "") : String(c.title ?? c.description ?? c.msg ?? "");
    if (kind === "photo") text = String(c.description ?? c.title ?? "");
  }
  const from = raw.uidFrom === "0" || raw.uidFrom === ownId ? ownId : String(raw.uidFrom);
  const q = raw.quote;
  return {
    id: String(raw.msgId),
    cliMsgId: String(raw.cliMsgId ?? ""),
    threadId,
    type,
    from,
    dName: String(raw.dName ?? ""),
    ts: Number(raw.ts) || 0, // a NaN here would break the conversation sort

    kind,
    text,
    attach,
    quote: q ? { from: String(q.ownerId), dName: String(q.fromD ?? ""), text: String(q.msg || LABELS[KINDS[q.cliMsgType] ?? "other"] || "") } : null,
    undone: raw.msgType === "chat.undo",
    reactions: {},
    raw,
  };
}

/** What the conversation list shows for a message: text, or a label for media. */
export function previewOf(m: Msg) {
  if (m.undone) return "Tin nhắn đã được thu hồi";
  if (m.kind === "text" || m.kind === "link") return m.text;
  if (m.kind === "call") return m.text || LABELS.call;
  return LABELS[m.kind];
}
