import type { API } from "zca-js";
import { CallControls, type CallObservation } from "./protocol";

type ProbeAPI = Pick<API, "custom" | "zpwServiceMap" | "getOwnId"> & {
  callingProbe?: (request: SignalRequest) => Promise<unknown>;
};
type SignalRequest = { action: "requestcall" | "cancel"; peerId: string; callId: string; type: number; signal: AbortSignal };
type Deps = { api: ProbeAPI; controls: CallControls; authenticated: boolean; signal: AbortSignal };
const running = new WeakSet<CallControls>();

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,31}$/.test(v);
export const CONTROL_ACTIONS = ["request", "answer", "ringring", "answerack", "cancel", "endcall"];
export const CONTROL_FIELDS = ["codec", "session", "session_id", "rtpAddress", "rtcpAddress", "extendData", "status", "callId"];
const shape = (v: unknown) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

// Only fixed labels and value types leave the process; opaque data may contain credentials.
export function describeControl(event: CallObservation) {
  const data = object(event.data) ? event.data : {};
  return {
    action: CONTROL_ACTIONS.includes(event.action) ? event.action : "unknown",
    data: shape(event.data),
    peer: event.peerId ? "present" : "unknown",
    timestamp: event.timestamp === undefined ? "unknown" : "present",
    duplicate: event.duplicate,
    late: event.late,
    fields: Object.fromEntries(CONTROL_FIELDS.map((key) => [key, shape(data[key])])),
  };
}

async function sendSignal(api: ProbeAPI, request: SignalRequest) {
  if (!api.callingProbe) api.custom<unknown, SignalRequest>("callingProbe", async ({ ctx, utils, props }) => {
    const host = api.zpwServiceMap.voice_call?.[0];
    if (!host || new URL(host).protocol !== "https:") throw new Error("voice-call service unavailable");
    const body = props.action === "requestcall"
      ? { calleeId: props.peerId, callId: props.callId, codec: "[]", typeRequest: props.type, imei: ctx.imei }
      : { callerId: props.peerId, callId: props.callId, callType: props.type, status: 0, imei: ctx.imei };
    const params = utils.encodeAES(JSON.stringify(body));
    if (!params) throw new Error("encryption failed");
    return utils.resolve(await utils.request(utils.makeURL(`${host}/api/voicecall/${props.action}`, { params }), { method: "GET", signal: props.signal }));
  });
  return api.callingProbe!(request);
}

export async function runProbe(raw: unknown, deps?: Deps) {
  if (!object(raw)) throw new Error("invalid call probe");
  const allowed = new Set(["mode", "action", "peerId", "consent", "callId", "type", "waitMs"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("invalid call probe fields");
  const mode = raw.mode ?? "offline";
  if (mode === "offline") {
    if (Object.keys(raw).some((key) => key !== "mode")) throw new Error("offline probe takes no live parameters");
    const controls = new CallControls();
    const events: ReturnType<typeof describeControl>[] = [];
    const off = controls.subscribe((event) => events.push(describeControl(event)));
    // Original synthetic producer-shaped data, never a captured invitation.
    controls.receive({ act_type: "voip", act: "request", data: JSON.stringify({ uidN: "900000000000000001", ts: Date.now(), codec: "opaque-synthetic" }) });
    off();
    return { mode: "offline", synthetic: true, signaling: "not-run", media: "unverified", events };
  }
  if (mode !== "live" || !deps?.authenticated) throw new Error("authenticated call probe required");
  if (deps.signal.aborted) throw new Error("call probe session ended");
  const action = raw.action;
  if (action !== "observe" && action !== "requestcall" && action !== "cancel") throw new Error("unsupported call probe action");
  if (!id(raw.peerId) || raw.peerId === deps.api.getOwnId() || raw.consent !== true) throw new Error("consenting test peer required");
  const waitMs = raw.waitMs ?? (action === "observe" ? 10_000 : 0);
  if (typeof waitMs !== "number" || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30_000) throw new Error("invalid probe duration");
  if (action === "observe" && (raw.callId !== undefined || raw.type !== undefined)) throw new Error("observe does not correlate call IDs");
  if (action !== "observe") {
    if (typeof raw.callId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.callId)) throw new Error("explicit call ID required");
    if (typeof raw.type !== "number" || !Number.isInteger(raw.type) || raw.type < 0 || raw.type > 2147483647) throw new Error("explicit native request type required");
  }
  if (running.has(deps.controls)) throw new Error("call probe already running");
  running.add(deps.controls);

  const events: (ReturnType<typeof describeControl> & { order: number; elapsedMs: number })[] = [];
  const started = Date.now();
  let dropped = 0;
  const off = deps.controls.subscribe((event) => {
    if (event.peerId !== raw.peerId) return;
    if (events.length === 100) { dropped++; return; }
    events.push({ order: events.length + 1, elapsedMs: Date.now() - started, ...describeControl(event) });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const signal = AbortSignal.any([deps.signal, controller.signal]);
  let abort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("call probe session ended"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    let response = "not-requested";
    await Promise.race([
      (async () => {
        if (action !== "observe") {
          try {
            response = shape(await sendSignal(deps.api, { action, peerId: raw.peerId as string, callId: raw.callId as string, type: raw.type as number, signal }));
          } catch {
            throw new Error("call probe transport failed");
          }
        }
        if (waitMs && !signal.aborted) await new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); });
      })(),
      stopped,
      new Promise<never>((_, reject) => { deadline = setTimeout(() => { reject(new Error("call probe timed out")); controller.abort(); }, 35_000); }),
    ]);
    return { mode: "live", action, signaling: action === "observe" ? "not-requested" : "request-returned", response, media: "unverified", events, dropped };
  } finally {
    off();
    clearTimeout(timer);
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
    controller.abort();
    running.delete(deps.controls);
  }
}
