import { expect, test } from "bun:test";
import type { Msg } from "./api";
import { groupPhotos } from "./photo-groups";

function photo(id: string, batchId?: string, position?: number): Msg {
  return {
    id, cliMsgId: "", threadId: "10", type: 1, from: "20", dName: "Test",
    ts: 1, kind: "photo", text: "", attach: { params: { groupLayoutId: batchId, idInGroup: position } },
    undone: false, reactions: {}, quote: null,
  };
}

test("uses explicit batch IDs and photo positions across interleaved sends", () => {
  const messages = [photo("second", "123", 1), photo("single"), photo("first", "123", 0), photo("other", "124", 0)];
  expect(groupPhotos(messages).map((group) => group.map((m) => m.id))).toEqual([
    ["first", "second"], ["single"], ["other"],
  ]);
});

test("keeps unmarked photos, conflicting positions, and different senders separate", () => {
  const messages = [
    photo("a"), photo("b"), photo("c", "123", 0), photo("d", "123", 0),
    { ...photo("e", "123", 1), from: "21" },
  ];
  expect(groupPhotos(messages)).toEqual(messages.map((m) => [m]));
});
