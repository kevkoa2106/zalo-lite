import { expect, test } from "bun:test";
import { CallControls, parseVoipControl, type CallObservation } from "./protocol";

// Original synthetic producer shapes; these are not captures or proof of server acceptance.
const content = (data: unknown = { uidN: "2002", ts: "100000" }) => ({ act_type: "voip", act: "request", data });

test("voip parser follows object/array string producers and preserves opaque fields", () => {
  const opaque = { uidN: "2002", ts: "100000", codec: "fake-codec", status: 777, session: "fake-session", extendData: { key: "fake-key" }, callId: "unverified-call-id", accountId: "untrusted-account" };
  const parsed = parseVoipControl({ ...content(JSON.stringify(opaque)), producerField: "retained" })!;
  expect(parsed.action).toBe("request");
  expect(parsed.peerId).toBe("2002");
  expect(parsed.timestamp).toBe(100000);
  expect(parsed.data).toEqual(opaque);
  expect(parsed.content.producerField).toBe("retained");
  expect(parsed).not.toHaveProperty("callId");
  expect(parsed).not.toHaveProperty("accountId");
  expect(parseVoipControl(content(JSON.stringify([opaque])))!.data).toEqual([opaque]);
  expect(parseVoipControl(content([opaque]))!.peerId).toBeUndefined();
  expect(parseVoipControl(content("opaque-string"))!.data).toBe("opaque-string");
});

test("malformed controls and historical call bubbles cannot become live events", () => {
  for (const raw of [null, [], "request", {}, { act_type: "voip", data: {} }, { act_type: "voip", act: "" }, content("{bad"), content("[bad"), { ...content(), act_type: "fr" }, { msgType: "chat.call", content: { action: "recommened.calltime" } }]) {
    expect(parseVoipControl(raw)).toBeNull();
  }
  for (const uidN of [2002, 0, "0", "-2", "2e3", "2.5", "2002x"]) expect(parseVoipControl(content({ uidN }))!.peerId).toBeUndefined();
  for (const ts of [null, -1, "-1", "1.5", "bad", Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(parseVoipControl(content({ ts }))!.timestamp).toBeUndefined();
  expect(parseVoipControl(content("x".repeat(65_536)))).toBeNull();
  const circular: Record<string, unknown> = content();
  circular.loop = circular;
  expect(parseVoipControl(circular)).toBeNull();
});

test("consumer marks duplicate and late observations without inventing call states", () => {
  const consumer = new CallControls();
  const events: CallObservation[] = [];
  const stop = consumer.subscribe((event) => events.push(event));
  consumer.receive(content(), 100001);
  consumer.receive(content(), 160001);
  consumer.receive({ ...content({ status: 3, callId: "different-unverified-call" }), act: "answer" }, 160002);
  expect(events.map((event) => [event.duplicate, event.late])).toEqual([[false, false], [true, true], [false, false]]);
  expect(events[2]!.data).toEqual({ status: 3, callId: "different-unverified-call" });
  expect(events[2]).not.toHaveProperty("state");
  stop();
  consumer.receive(content(), 100001);
  expect(events.length).toBe(3);
});

test("consumer keeps observations for other peers distinct and bounds duplicate memory", () => {
  const consumer = new CallControls();
  const events: CallObservation[] = [];
  consumer.subscribe((event) => events.push(event));
  consumer.receive(content({ uidN: "2002" }));
  consumer.receive(content({ uidN: "3003" }));
  expect(events.map((event) => event.peerId)).toEqual(["2002", "3003"]);
  for (let n = 0; n < 128; n++) consumer.receive(content({ uidN: "2002", marker: n }));
  consumer.receive(content({ uidN: "2002" }));
  expect(events.at(-1)!.duplicate).toBe(false);
});
