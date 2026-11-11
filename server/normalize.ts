import type { Kind, Msg } from "./store";
import { readPhotoBatch } from "../src/photo-groups";

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

const CALL_ACTIONS = new Set(["recommened.misscall", "recommened.calling", "recommened.receivecall", "recommened.calltime"]);

export type CallInfo = { title: string; detail: string; tone: "ok" | "missed" | "rejected"; video: boolean; callback: boolean };

const span = (sec: number) => {
  const s = Math.max(0, Math.round(sec) || 0);
  const h = Math.floor(s / 3600);
  return `${h ? `${h} giờ ` : ""}${Math.floor((s % 3600) / 60)} phút ${s % 60} giây`;
};

/** Title, detail line and icon tone of a call bubble, following Zalo PC's own rules (params.reason: 3 = callee rejected). */
export function callInfo(action: string, rawParams: unknown, duration?: unknown): CallInfo {
  const p = (typeof rawParams === "string" ? parseJson(rawParams) : rawParams ?? {}) as Record<string, any>;
  const missed = action === "recommened.misscall";
  const caller = p.isCaller != null ? !!p.isCaller : action === "recommened.calling";
  const video = p.calltype === 1;
  const reason = Number(p.reason) || 0;
  const kind = video ? "video" : "thoại";
  let title: string;
  let tone: CallInfo["tone"] = "ok";
  if (!missed) title = `Cuộc gọi ${kind} ${caller ? "đi" : "đến"}`;
  else if (caller) {
    tone = "missed";
    title = reason === 4 || reason === 5 ? "Bạn đã hủy" : reason === 3 ? "Người nhận từ chối" : reason === 1 ? "Người nhận bận" : `Cuộc gọi ${kind} đi`;
  } else {
    tone = reason === 3 ? "rejected" : "missed";
    title = reason === 3 ? "Bạn đã từ chối" : "Bạn bị nhỡ";
  }
  // A call that connected shows its length; an unanswered outgoing one shows 0; other misses name the call type.
  const detail = !missed ? span(Number(p.duration ?? duration)) : caller && reason <= 2 ? span(0) : `Cuộc gọi ${kind}`;
  return { title, detail, tone, video, callback: p.isEnableCallback !== false };
}

export function normalize(raw: Raw, threadId: string, type: 0 | 1, ownId: string): Msg {
  const c = raw.content;
  const isCall = c && typeof c === "object" && CALL_ACTIONS.has(String(c.action));
  const kind = isCall ? "call" : (KINDS[raw.msgType] ?? (String(raw.msgType).includes("call") ? "call" : "other"));
  let text = "";
  let attach: Msg["attach"] = null;
  if (typeof c === "string") text = c;
  else if (c && typeof c === "object") {
    const params = c.params && typeof c.params === "object" ? c.params : parseJson(c.params);
    const attachment = { ...c, params, ...(isCall && { call: callInfo(String(c.action), params, c.duration) }) };
    attach = attachment;
    // Captions on photos/links travel in `title` (links) or `description` (photos); calls carry their text in `title`.
    text = kind === "link" ? String(c.href ?? c.title ?? "") : String(c.title ?? c.description ?? c.msg ?? "");
    if (kind === "photo") {
      text = String(c.description || c.title || ""); // an empty description leaves the caption in title
      // The attachment survives after old messages have their raw payload pruned.
      const batch = readPhotoBatch(attachment, raw);
      if (batch) Object.assign(attachment, { groupLayoutId: batch.id, idInGroup: batch.index });
    }
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
    quote: q
      ? {
          from: String(q.ownerId), dName: String(q.fromD ?? ""), text: String(q.msg || LABELS[KINDS[q.cliMsgType] ?? "other"] || ""),
          ...(!q.msg && { placeholder: true }),
          // ids are JS numbers and can exceed 2^53, so the UI falls back to ts when the id finds nothing
          ...(q.globalMsgId && { id: String(q.globalMsgId) }), ...(q.cliMsgId && { cliMsgId: String(q.cliMsgId) }), ...(q.ts && { ts: Number(q.ts) || undefined }),
        }
      : null,
    ...(Array.isArray(raw.mentions) && raw.mentions.length && { mentions: raw.mentions.map((x: Raw) => ({ uid: String(x.uid), pos: Number(x.pos), len: Number(x.len) })) }),
    undone: raw.msgType === "chat.undo",
    reactions: {},
    raw,
  };
}

/** What the conversation list shows for a message: text, or a label for media. */
export function previewOf(m: Msg) {
  if (m.undone) return "Tin nhắn đã được thu hồi";
  if (m.kind === "text" || m.kind === "link") return m.text;
  if (m.kind === "call") return `[${(m.attach?.call as CallInfo | undefined)?.title ?? m.text ?? LABELS.call}]`;
  return LABELS[m.kind];
}
