// Client for the local backend (server/index.ts). Tauri injects the port and token;
// in a plain browser (vite dev) we fall back to the default port with no token.
declare global {
  interface Window {
    __ZL__?: { port: number; token: string };
  }
}

export type Kind = "text" | "photo" | "sticker" | "file" | "link" | "video" | "voice" | "gif" | "call" | "other";
export type Msg = {
  id: string;
  cliMsgId: string;
  threadId: string;
  type: 0 | 1;
  from: string;
  dName: string;
  ts: number;
  kind: Kind;
  text: string;
  attach: Record<string, any> | null;
  quote: { from: string; dName: string; text: string } | null;
  undone: boolean;
  reactions: Record<string, string>;
  pending?: boolean;
  failed?: boolean;
};
export type Thread = {
  id: string;
  type: 0 | 1;
  name: string;
  avatar: string;
  unread: number;
  lastTs: number;
  preview: string;
  previewKind: Kind;
  previewFrom: string;
  members: number;
};
export type Contact = { id: string; type: 0 | 1; name: string; avatar: string; friend?: boolean };
export type Me = { id: string; name: string; avatar: string };
export type Sticker = { id: number; cateId: number; type: number; url: string };
export type Limits = { maxFiles: number; maxMB: number };
export type State =
  | { state: "boot" | "logged_out" | "qr_expired" | "kicked" }
  | { state: "qr"; qr: string }
  | { state: "scanned"; name: string; avatar: string }
  | { state: "ready"; me: Me }
  | { state: "error"; error?: string };

type Listener = (ev: any) => void;

const cfg = window.__ZL__ ?? { port: 17789, token: "" };
const url = `ws://127.0.0.1:${cfg.port}/?token=${encodeURIComponent(cfg.token)}`;

let ws: WebSocket | null = null;
let rid = 0;
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const listeners = new Set<Listener>();
let backoff = 250;

function connect() {
  ws = new WebSocket(url);
  ws.onopen = () => {
    backoff = 250;
    emit({ ev: "socket", up: true });
  };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.rid != null && waiting.has(d.rid)) {
      const w = waiting.get(d.rid)!;
      waiting.delete(d.rid);
      d.ok ? w.resolve(d.data) : w.reject(new Error(d.error));
    } else if (d.ev) emit(d);
  };
  ws.onclose = () => {
    for (const w of waiting.values()) w.reject(new Error("Mất kết nối"));
    waiting.clear();
    emit({ ev: "socket", up: false });
    // The backend may still be starting (Tauri spawns it alongside the window).
    setTimeout(connect, (backoff = Math.min(backoff * 2, 4000)));
  };
}

// The socket can open (and the backend send its state) before a component subscribes,
// so the latest connection and login events are replayed to each new listener.
const sticky: Record<string, any> = {};
const emit = (ev: any) => {
  if (ev.ev === "socket" || ev.ev === "state") sticky[ev.ev] = ev;
  listeners.forEach((l) => l(ev));
};

export function on(l: Listener) {
  listeners.add(l);
  Object.values(sticky).forEach(l);
  return () => void listeners.delete(l);
}

export function call<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("Mất kết nối"));
    const id = ++rid;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ op, rid: id, ...args }));
  });
}

connect();
