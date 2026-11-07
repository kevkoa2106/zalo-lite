// Zalo's per-message blob ("BinNet") without Zalo PC's native library.
// A blob is a list of TLV records: u32 big-endian tag, u32 big-endian length, value. Container records nest more records.
// The tag tables below were inferred from the real blobs by matching them against the library's own parsed output.

export type BinNet = {
  property?: { size?: number; subType?: number; type?: number; ext?: string };
  attachs?: Record<string, unknown>[];
  quote?: Record<string, unknown>;
  mentions?: Record<string, unknown>[];
  reference?: Record<string, unknown>;
};

type Rec = { tag: number; value: Uint8Array };
type Kind = "i32" | "i64" | "str";
type Field = [name: string, kind: Kind];

const PROPERTY: Record<number, Field> = { 30: ["size", "i32"], 31: ["subType", "i32"], 32: ["type", "i32"], 33: ["ext", "str"] };
const ATTACH: Record<number, Field> = {
  40: ["type", "str"], 41: ["catId", "i32"], 42: ["id", "i32"], 43: ["extInfo", "str"], 44: ["childNumber", "i32"], 45: ["action", "str"],
  46: ["params", "str"], 47: ["title", "str"], 48: ["href", "str"], 49: ["thumb", "str"], 50: ["description", "str"], 66: ["remains", "str"], 67: ["zinstantData", "str"], 68: ["zinstantMsg", "str"],
};
const QUOTE: Record<number, Field> = {
  80: ["ownerId", "i32"], 81: ["cliMsgId", "i64"], 82: ["globalMsgId", "i64"], 83: ["cliMsgType", "i32"], 84: ["ts", "i64"], 85: ["ttl", "i64"],
  86: ["msg", "str"], 87: ["attach", "str"], 88: ["fromD", "str"],
};
const MENTION: Record<number, Field> = { 100: ["type", "i32"], 101: ["uid", "i32"], 102: ["pos", "i32"], 103: ["len", "i32"] };
const REFERENCE: Record<number, Field> = { 170: ["type", "i32"], 171: ["data", "str"] };

/** Split a buffer into TLV records; null when it is not a well-formed record list. */
function records(b: Uint8Array): Rec[] | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Rec[] = [];
  for (let i = 0; i < b.length; ) {
    if (i + 8 > b.length) return null;
    const len = v.getUint32(i + 4);
    if (i + 8 + len > b.length) return null;
    out.push({ tag: v.getUint32(i), value: b.subarray(i + 8, i + 8 + len) });
    i += 8 + len;
  }
  return out;
}

function read(value: Uint8Array, kind: Kind): number | string {
  const v = new DataView(value.buffer, value.byteOffset, value.byteLength);
  if (kind === "str") return new TextDecoder().decode(value);
  if (kind === "i64") return value.length >= 8 ? Number(v.getBigInt64(0)) : 0;
  return value.length >= 4 ? v.getInt32(0) : 0;
}

function fields(b: Uint8Array, table: Record<number, Field>) {
  const out: Record<string, unknown> = {};
  for (const r of records(b) ?? []) {
    const f = table[r.tag];
    if (f) out[f[0]] = read(r.value, f[1]);
  }
  return out;
}

/** Parse one blob. Unknown tags are ignored; a blob that is not a record list throws. */
export function parseBinNet(blob: Uint8Array): BinNet {
  const top = records(blob);
  if (!top) throw new Error("not a BinNet blob");
  const out: BinNet = {};
  for (const r of top) {
    if (r.tag === 5) out.property = fields(r.value, PROPERTY);
    else if (r.tag === 6) (out.attachs ??= []).push(fields(r.value, ATTACH));
    else if (r.tag === 7) out.quote = fields(r.value, QUOTE);
    else if (r.tag === 8) (out.mentions ??= []).push(fields(r.value, MENTION));
    else if (r.tag === 11) out.reference = fields(r.value, REFERENCE);
  }
  return out;
}
