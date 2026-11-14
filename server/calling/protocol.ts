import { createHash } from "node:crypto";
import type { VoipControl } from "zca-js";

export type CallControl = {
  action: string;
  data: unknown;
  content: VoipControl;
  peerId?: string;
  timestamp?: number;
};

export type CallObservation = CallControl & { duplicate: boolean; late: boolean };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseVoipControl(raw: unknown): CallControl | null {
  if (!record(raw) || raw.act_type !== "voip" || typeof raw.act !== "string" || !raw.act || !Object.hasOwn(raw, "data")) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > 65_536) return null;
  } catch {
    return null;
  }
  let data = raw.data;
  if (typeof data === "string" && (data.startsWith("{") || data.startsWith("["))) {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const content: VoipControl = { ...raw, act_type: "voip", act: raw.act, data };
  const event: CallControl = { action: raw.act, data, content };
  if (record(data)) {
    if (typeof data.uidN === "string" && /^[1-9]\d{0,31}$/.test(data.uidN)) event.peerId = data.uidN;
    const ts = typeof data.ts === "number" ? data.ts : typeof data.ts === "string" && /^\d+$/.test(data.ts) ? Number(data.ts) : NaN;
    if (Number.isSafeInteger(ts) && ts > 0) event.timestamp = ts;
  }
  return event;
}

// Observations never advance a call state: unknown native status and correlation fields stay opaque.
export class CallControls {
  private listeners = new Set<(event: CallObservation) => void>();
  private seen = new Set<string>();

  receive(raw: unknown, now = Date.now()) {
    const event = parseVoipControl(raw);
    if (!event) return;
    const fingerprint = createHash("sha256").update(JSON.stringify(event.content)).digest("hex");
    const duplicate = this.seen.has(fingerprint);
    this.seen.add(fingerprint);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
    const observation = { ...event, duplicate, late: event.timestamp !== undefined && now - event.timestamp > 60_000 };
    for (const listener of this.listeners) listener(observation);
  }

  subscribe(listener: (event: CallObservation) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
