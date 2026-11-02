import { Database } from "bun:sqlite";

export type Kind = "text" | "photo" | "sticker" | "file" | "link" | "video" | "voice" | "gif" | "call" | "other";

export type Msg = {
  id: string;
  cliMsgId: string;
  threadId: string;
  type: 0 | 1; // 0 = user, 1 = group (ThreadType)
  from: string;
  dName: string;
  ts: number;
  kind: Kind;
  text: string;
  attach: Record<string, unknown> | null;
  quote: { from: string; dName: string; text: string } | null;
  undone: boolean;
  reactions: Record<string, string>; // uid -> icon
  raw: Record<string, unknown>; // original TMessage, needed for seen/quote/delete
};

export type Thread = {
  id: string;
  type: 0 | 1;
  name: string;
  avatar: string;
  unread: number;
  lastTs: number;
  preview: string; // last message text or a label ("Hình ảnh")
  previewKind: Kind;
  previewFrom: string; // "Bạn", a group member's name, or ""
  members: number;
};

export function openStore(file: string) {
  const db = new Database(file, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS msgs (id TEXT PRIMARY KEY, thread TEXT, ts INTEGER, json TEXT)`);
  db.run(`CREATE INDEX IF NOT EXISTS msgs_thread_ts ON msgs(thread, ts)`);
  db.run(`CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, json TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, friend INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
  try {
    db.run("ALTER TABLE people ADD COLUMN friend INTEGER DEFAULT 0"); // databases created before the friend flag
  } catch {}

  const q = {
    putMsg: db.prepare("INSERT OR REPLACE INTO msgs (id, thread, ts, json) VALUES (?, ?, ?, ?)"),
    getMsg: db.prepare("SELECT json FROM msgs WHERE id = ?"),
    page: db.prepare("SELECT json FROM msgs WHERE thread = ? AND ts < ? ORDER BY ts DESC LIMIT ?"),
    oldest: db.prepare("SELECT json FROM msgs WHERE thread = ? ORDER BY ts ASC LIMIT 1"),
    putThread: db.prepare("INSERT OR REPLACE INTO threads (id, json) VALUES (?, ?)"),
    getThread: db.prepare("SELECT json FROM threads WHERE id = ?"),
    threads: db.prepare("SELECT json FROM threads"),
    // A name seen on a message must not wipe a known avatar or friend flag.
    putPerson: db.prepare(`INSERT INTO people (id, name, avatar, friend) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name,
        avatar = CASE WHEN excluded.avatar <> '' THEN excluded.avatar ELSE people.avatar END,
        friend = MAX(people.friend, excluded.friend)`),
    getPerson: db.prepare("SELECT name, avatar, friend FROM people WHERE id = ?"),
    people: db.prepare("SELECT id, name, avatar, friend FROM people"),
    get: db.prepare("SELECT v FROM kv WHERE k = ?"),
    set: db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)"),
  };
  const parse = <T>(row: unknown) => (row ? (JSON.parse((row as { json: string }).json) as T) : null);

  return {
    msg: (id: string) => parse<Msg>(q.getMsg.get(id)),
    putMsg: (m: Msg) => q.putMsg.run(m.id, m.threadId, m.ts, JSON.stringify(m)),
    delMsg: (id: string) => db.run("DELETE FROM msgs WHERE id = ?", [id]),
    /** Newest-last page of messages older than `before`. */
    page: (thread: string, before = Number.MAX_SAFE_INTEGER, limit = 50) =>
      (q.page.all(thread, before, limit) as { json: string }[]).map((r) => JSON.parse(r.json) as Msg).reverse(),
    oldest: (thread: string) => parse<Msg>(q.oldest.get(thread)),
    thread: (id: string) => parse<Thread>(q.getThread.get(id)),
    putThread: (t: Thread) => q.putThread.run(t.id, JSON.stringify(t)),
    delThread: (id: string) => db.run("DELETE FROM threads WHERE id = ?", [id]),
    threads: () => (q.threads.all() as { json: string }[]).map((r) => JSON.parse(r.json) as Thread),
    person: (id: string) => q.getPerson.get(id) as { name: string; avatar: string; friend: number } | null,
    putPerson: (id: string, name: string, avatar: string, friend = false) => q.putPerson.run(id, name, avatar, friend ? 1 : 0),
    people: () => q.people.all() as { id: string; name: string; avatar: string; friend: number }[],
    get: (k: string) => (q.get.get(k) as { v: string } | null)?.v ?? null,
    set: (k: string, v: string) => q.set.run(k, v),
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;
