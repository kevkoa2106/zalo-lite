// Message search: "xin chao" finds "xin chào" (case and accents ignored), and the hit is mapped back to the original text.

const fold1 = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Same rules as the conversation search in the UI (src/main.tsx `fold`). */
export const fold = (s: string) => fold1(s);

/** Where `query` first appears in `text`, ignoring case and accents, as positions in the original text. */
export function findMatch(text: string, query: string) {
  const q = fold(query.trim());
  if (!q) return null;
  let folded = "";
  const from: number[] = []; // folded index -> original index
  for (let i = 0; i < text.length; i++) {
    const f = fold1(text[i]!);
    for (let k = 0; k < f.length; k++) (folded += f[k], from.push(i));
  }
  const at = folded.indexOf(q);
  return at < 0 ? null : { start: from[at]!, end: from[at + q.length - 1]! + 1 };
}

/** The hit with up to `radius` characters of context on each side, on one line. */
export function snippet(text: string, start: number, end: number, radius = 40) {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  const flat = (s: string) => s.replace(/\s+/g, " ");
  return {
    before: (a > 0 ? "…" : "") + flat(text.slice(a, start)),
    hit: flat(text.slice(start, end)),
    after: flat(text.slice(end, b)) + (b < text.length ? "…" : ""),
  };
}
