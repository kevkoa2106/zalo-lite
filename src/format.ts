// Vietnamese time and size formats as the real client shows them.

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Conversation list: "Vài giây", "9 phút", "3 giờ", "2 ngày", then "dd/MM". */
export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return "Vài giây";
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày`;
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export const clock = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Day separator in the message list: "Hôm nay", "Hôm qua", "dd/MM/yyyy". */
export function day(ts: number, now = Date.now()) {
  const d = new Date(ts);
  const today = new Date(now);
  if (sameDay(d, today)) return "Hôm nay";
  if (sameDay(d, new Date(now - 86400000))) return "Hôm qua";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** A pause this long between two messages gets its own time pill, as in Zalo PC. */
export const GAP_MS = 30 * 60 * 1000;
export const isGap = (prevTs: number, ts: number) => ts - prevTs >= GAP_MS;

/** Label of a time-gap pill: "17:16" today, "17:16 Hôm qua" yesterday, "17:16 dd/MM/yyyy" before that. */
export function gapLabel(ts: number, now = Date.now()) {
  const d = day(ts, now);
  return d === "Hôm nay" ? clock(ts) : `${clock(ts)} ${d}`;
}

/** File extension for a recorded voice. Zalo's own voice files are AAC, which Apple's webview records as audio/mp4. */
export const voiceExt = (mime: string) => (/webm/.test(mime) ? "webm" : /ogg/.test(mime) ? "ogg" : "m4a");

export type Mention = { uid: string; pos: number; len: number };

/** Split a message into plain and mention parts. A range that is empty, outside the text, or overlaps an earlier one is ignored. */
export function splitMentions(text: string, mentions: Mention[] = []) {
  const out: { text: string; mention?: boolean }[] = [];
  let at = 0;
  for (const m of [...mentions].sort((a, b) => a.pos - b.pos)) {
    if (!(m.len > 0) || !(m.pos >= at) || m.pos + m.len > text.length) continue;
    if (m.pos > at) out.push({ text: text.slice(at, m.pos) });
    out.push({ text: text.slice(m.pos, m.pos + m.len), mention: true });
    at = m.pos + m.len;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The message a reply quotes: by id, else by timestamp and sender (ids are JS numbers and can lose precision). */
export function findQuoted<T extends { id: string; ts: number; from: string }>(msgs: T[], q: { id?: string; ts?: number; from: string }) {
  return (q.id ? msgs.find((m) => m.id === q.id) : undefined) ?? (q.ts ? msgs.find((m) => m.ts === q.ts && m.from === q.from) : undefined);
}

export function size(bytes: number) {
  if (!bytes) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < u.length - 1) (bytes /= 1024), i++;
  return `${bytes.toFixed(i && bytes < 10 ? 1 : 0)} ${u[i]}`;
}

/** Initials for avatar fallbacks: "Gia Minh" → "GM", "Pham Tri Dung" → "PD". */
export function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return ((w[0]![0] ?? "") + (w.length > 1 ? w[w.length - 1]![0] : "")).toUpperCase();
}

const HUES = [214, 145, 26, 280, 350, 190, 48];
export const hue = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]!;
