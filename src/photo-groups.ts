import type { Msg } from "./api";

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function readPhotoBatch(attachment: Record<string, unknown>, raw: Record<string, unknown>) {
  const content = record(raw.content);
  const fields = [record(attachment.params), attachment, record(content.params), content, raw];
  const media = fields.flatMap((field) => [record(field.groupMediaMsg), record(record(field.extMsgProp).groupMediaMsg)]);
  const id = [...fields, ...media].map((field) => field.groupLayoutId)
    .find((value) => typeof value === "string" ? /^[1-9]\d*$/.test(value) : Number.isSafeInteger(value) && Number(value) > 0);
  if (id === undefined) return;

  const position = [...fields, ...media].map((field) => field.idInGroup)
    .find((value) => typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)));
  const index = Number(position);
  return { id: String(id), index: Number.isSafeInteger(index) && index >= 0 ? index : undefined };
}

export function groupPhotos(messages: Msg[]): Msg[][] {
  const batches = new Map<string, { first: string; items: { message: Msg; index?: number }[]; positions: Set<number>; conflicting: boolean }>();
  const keys = new Map<string, string>();
  for (const m of messages) {
    if (m.kind !== "photo" || m.undone) continue;
    const batch = m.localPhotoBatch ?? readPhotoBatch(m.attach ?? {}, m.raw ?? {});
    if (!batch) continue;
    const key = JSON.stringify([m.threadId, m.from, batch.id]);
    keys.set(m.id, key);
    let group = batches.get(key);
    if (!group) batches.set(key, group = { first: m.id, items: [], positions: new Set(), conflicting: false });
    group.items.push({ message: m, index: batch.index });
    if (batch.index === undefined) continue;
    if (group.positions.has(batch.index)) group.conflicting = true;
    group.positions.add(batch.index);
  }

  return messages.flatMap((m) => {
    const key = keys.get(m.id);
    const group = key && batches.get(key);
    if (!group || group.conflicting) return [[m]];
    if (group.first !== m.id) return [];
    if (group.positions.size === group.items.length)
      group.items.sort((a, b) => a.index! - b.index!);
    return [group.items.map(({ message }) => message)];
  });
}
