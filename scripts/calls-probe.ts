import { CONTROL_ACTIONS, CONTROL_FIELDS, runProbe } from "../server/calling/probe";

async function main() {
  const args = Bun.argv.slice(2);
  if (!args.length) return runProbe({ mode: "offline" });
  if (args.length !== 1 || args[0] !== "--live") throw new Error("use no arguments for replay, or --live with JSON on stdin");
  let input = "";
  for await (const chunk of Bun.stdin.stream()) {
    input += new TextDecoder().decode(chunk);
    if (input.length > 16_384) throw new Error("probe configuration too large");
  }
  let config: any;
  try { config = JSON.parse(input); } catch { throw new Error("invalid probe configuration"); }
  if (!config || typeof config.endpoint !== "string" || typeof config.token !== "string" || !config.token || config.token.length > 512)
    throw new Error("local endpoint and token required on stdin");
  let url: URL;
  try { url = new URL(config.endpoint); } catch { throw new Error("invalid local endpoint"); }
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("endpoint must be ws://127.0.0.1:<port>/ without credentials or query");
  if (!config.probe || config.probe.mode !== "live") throw new Error("explicit live probe required");
  url.searchParams.set("token", config.token);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => finish(new Error("local probe timed out")), 40_000);
    const finish = (error?: Error, result?: unknown) => {
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(result);
    };
    ws.onopen = () => ws.send(JSON.stringify({ op: "call_probe", rid: 1, probe: config.probe }));
    ws.onerror = () => finish(new Error("local probe connection failed"));
    ws.onclose = () => finish(new Error("local probe connection closed"));
    ws.onmessage = (event) => {
      let reply: any;
      try { reply = JSON.parse(String(event.data)); } catch { return finish(new Error("invalid local probe response")); }
      if (reply.rid !== 1) return;
      if (!reply.ok) return finish(new Error("local backend rejected probe"));
      // Rebuild the output from fixed labels rather than printing a server payload.
      if (reply.data?.mode !== "live" || !["observe", "requestcall", "cancel"].includes(reply.data?.action))
        return finish(new Error("invalid local probe response"));
      const types = new Set(["undefined", "null", "array", "string", "number", "boolean", "object"]);
      const type = (v: unknown) => typeof v === "string" && types.has(v) ? v : "unknown";
      const events = Array.isArray(reply.data.events) ? reply.data.events.slice(0, 100).map((e: any, i: number) => ({
        order: i + 1,
        elapsedMs: typeof e?.elapsedMs === "number" && e.elapsedMs >= 0 && e.elapsedMs <= 40_000 ? Math.round(e.elapsedMs) : null,
        action: CONTROL_ACTIONS.includes(e?.action) ? e.action : "unknown",
        data: type(e?.data), peer: e?.peer === "present" ? "present" : "unknown", timestamp: e?.timestamp === "present" ? "present" : "unknown",
        duplicate: e?.duplicate === true, late: e?.late === true,
        fields: Object.fromEntries(CONTROL_FIELDS.map((k) => [k, type(e?.fields?.[k])])),
      })) : [];
      finish(undefined, {
        mode: "live", action: reply.data.action, media: "unverified",
        signaling: reply.data.action === "observe" ? "not-requested" : "request-returned",
        response: reply.data.response === "not-requested" ? "not-requested" : type(reply.data.response),
        events, dropped: Number.isInteger(reply.data.dropped) && reply.data.dropped >= 0 && reply.data.dropped <= 1_000_000 ? reply.data.dropped : null,
      });
    };
  });
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "call probe failed");
  process.exitCode = 1;
}
