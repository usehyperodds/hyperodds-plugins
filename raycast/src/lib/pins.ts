import { MAX_PINS, readJson } from "./api.ts";

export type PinResult = { ok: true; pins: number[]; pinned: boolean } | { ok: false; reason: string };

// Pins newest last, so the first pin keeps the menu bar title until it is unpinned.
export function togglePin(pins: readonly number[], outcome: number): PinResult {
  if (pins.includes(outcome)) return { ok: true, pins: pins.filter((id) => id !== outcome), pinned: false };
  if (pins.length >= MAX_PINS) return { ok: false, reason: `Unpin a market first. Up to ${MAX_PINS} fit.` };
  return { ok: true, pins: [...pins, outcome], pinned: true };
}

export function readPins(raw: unknown): number[] {
  const parsed = typeof raw === "string" ? readJson(raw) : raw;
  if (!Array.isArray(parsed)) return [];
  const ids = parsed.filter((x): x is number => Number.isInteger(x) && x >= 0);
  return [...new Set(ids)].slice(0, MAX_PINS);
}
