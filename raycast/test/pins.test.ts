import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PINS } from "../src/lib/api.ts";
import { readPins, togglePin } from "../src/lib/pins.ts";

test("pinning adds to the end and unpinning removes", () => {
  assert.deepEqual(togglePin([], 41294), { ok: true, pins: [41294], pinned: true });
  assert.deepEqual(togglePin([41294], 39392), { ok: true, pins: [41294, 39392], pinned: true });
  assert.deepEqual(togglePin([41294, 39392], 41294), { ok: true, pins: [39392], pinned: false });
});

test("a full menu bar refuses another pin but still unpins", () => {
  const full = Array.from({ length: MAX_PINS }, (_, i) => i);
  assert.deepEqual(togglePin(full, 99), { ok: false, reason: "Unpin a market first. Up to 10 fit." });
  const result = togglePin(full, 3);
  assert.ok(result.ok);
  assert.equal(result.pins.length, MAX_PINS - 1);
});

test("stored pins survive bad data", () => {
  assert.deepEqual(readPins(undefined), []);
  assert.deepEqual(readPins("not json"), []);
  assert.deepEqual(readPins('{"a":1}'), []);
  assert.deepEqual(readPins('[41294, 41294, -1, 2.5, "7", 39392]'), [41294, 39392]);
  assert.equal(readPins(JSON.stringify(Array.from({ length: 15 }, (_, i) => i))).length, MAX_PINS);
});
