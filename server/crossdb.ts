// Reading Zalo's phone backup ("cross DB"): key unwrapping, the decrypt library from the installed Zalo PC,
// and turning one backup row into the raw message shape the rest of the app already understands.
// Layout (docs/PROTOCOL.md): one SQLite file per chat, `<id>.db` for people and `group_<id>.db` for groups;
// ids are Zalo's short "noise" ids, resolved to real ones through zwid.api.zalo.me/api/znoise.
import { Database } from "bun:sqlite";
import { constants, privateDecrypt } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LIB = "/Applications/Zalo.app/Contents/Resources/app.asar.unpacked/native/nativelibs/db-cross-v4/prebuilt/darwin/electron";

/** encrypted_key -> the secret the db library wants: RSA-PKCS1 private decrypt, hex for format 1, else base64. */
export function unwrapKey(encrypted: string, privatePem: string, format: number) {
  // Newer runtimes refuse RSA_PKCS1_PADDING for private decryption, so decrypt raw and strip the 00 02 <random> 00 padding here.
  const raw = privateDecrypt({ key: privatePem, padding: constants.RSA_NO_PADDING }, Buffer.from(encrypted, "base64"));
  if (raw[0] !== 0 || raw[1] !== 2) throw new Error("encrypted_key is not PKCS#1 v1.5 padded for our key");
  return raw.subarray(raw.indexOf(0, 2) + 1).toString(format === 1 ? "hex" : "base64");
}

export type NativeLib = {
  decompressAndDecryptDb(inp: string, out: string, key: string): { result: number; err_message?: string };
  decompressAndDecryptDb_V2(inp: string, outDir: string, key: string, progress: () => void): { result: number; inner_error?: number; error_message?: string };
  parseBinNet(blob: Uint8Array): { result: number; data?: { attachs?: Record<string, any>[]; mentions?: Record<string, any>[]; quote?: Record<string, any> } };
};

let lib: NativeLib | null = null;
export function nativeLib(): NativeLib {
  if (lib) return lib;
  const file = join(LIB, process.arch === "arm64" ? "arm64" : "x64", "db-cross-v4-native.node");
  if (!existsSync(file)) throw new Error("Zalo PC's db-cross-v4 library not found: install Zalo.app to read phone backups");
  const m: { exports: NativeLib } = { exports: {} as NativeLib };
  process.dlopen(m, file);
  return (lib = m.exports);
}

// Backup MsgType -> wire msgType (from Zalo PC's own table). Types Zalo PC itself skips on restore, plus
// delete/undo markers, are not imported.
const TYPES: Record<number, string> = {
  0: "webchat", 2: "chat.doodle", 3: "chat.photo", 4: "chat.photo", 6: "chat.voice", 10: "chat.sticker", 12: "chat.recommended",
  15: "chat.list.action", 18: "chat.location.new", 19: "chat.video.msg", 22: "share.file", 23: "chat.gif", 24: "chat.webcontent",
  31: "chat.photo", 53: "chat.webcontent.v2",
};

export type Chat = { file: string; id: string; group: boolean };
export function backupChats(dir: string): Chat[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((file) => {
      const group = file.startsWith("group_");
      return { file: join(dir, file), id: file.slice(group ? 6 : 0, -3), group };
    });
}

export type Row = { sender: string; glb: string; cli: string; type: number; ts: number; text: string; bin: Uint8Array | null };

/** Newest `keep` readable messages of one chat. Ids are read as text: they do not fit a JS number. */
export function readChat(file: string, keep: number): Row[] {
  const db = new Database(file);
  try {
    if (!db.query("SELECT 1 FROM sqlite_master WHERE name = 'ChatContent'").get()) return [];
    const skip = [20, 21, 25, 26, 29, 32, 33, 34, 35, 36, 45, 51, 52].join(",");
    return db
      .query(
        `SELECT CAST(SenderId AS TEXT) AS sender, CAST(GlbMsgId AS TEXT) AS glb, CAST(CliMsgId AS TEXT) AS cli, MsgType AS type,
                TimeStamp AS ts, MsgContent AS text, BinNet AS bin
           FROM ChatContent WHERE MsgStatus > 0 AND CliMsgId IS NOT NULL AND MsgType NOT IN (${skip})
          ORDER BY TimeStamp DESC LIMIT ?`,
      )
      .all(keep) as Row[];
  } finally {
    db.close();
  }
}

/** One backup row as the raw message object `normalize` expects. `real` maps a short id to the real one. */
export function toRaw(row: Row, real: (shortId: string) => string, parse: NativeLib["parseBinNet"]) {
  const msgType = TYPES[row.type] ?? "chat.unknown";
  const parsed = row.bin ? parse(row.bin) : null;
  const attach = parsed?.result === 0 ? parsed.data?.attachs?.[0] : undefined;
  let content: unknown = row.text ?? "";
  if (attach && (row.type !== 0 || !row.text)) {
    const { childNumber: _c, ...rest } = attach;
    content = { ...rest, params: typeof rest.params === "object" && rest.params ? JSON.stringify(rest.params) : (rest.params ?? "") };
  }
  const mentions = parsed?.result === 0 ? parsed.data?.mentions : undefined;
  const quote = parsed?.result === 0 ? parsed.data?.quote : undefined;
  return {
    msgId: row.glb, cliMsgId: row.cli, uidFrom: real(row.sender), dName: "", msgType, content, ts: String(row.ts),
    ...(mentions?.length && { mentions }),
    ...(quote && { quote: { ...quote, ownerId: real(String(quote.ownerId)) } }),
  };
}
