import { LaunchType, LocalStorage, launchCommand, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useCallback, useEffect, useState } from "react";
import { readPins, togglePin } from "./lib/pins.ts";

const KEY = "pins";
export const MENU_BAR = process.platform === "darwin";

export async function loadPins(): Promise<number[]> {
  return readPins(await LocalStorage.getItem<string>(KEY));
}

export async function writePins(pins: number[]): Promise<void> {
  await LocalStorage.setItem(KEY, JSON.stringify(pins));
}

// Saves the pins and refreshes the menu bar. False when the menu bar couldn't take them yet: Raycast
// refuses to launch Pinned Prices until the user has opened it once, and Windows has no menu bar.
async function savePins(pins: number[]): Promise<boolean> {
  await writePins(pins);
  if (!MENU_BAR) return false;
  try {
    await launchCommand({ name: "pinned-prices", type: LaunchType.Background });
    return true;
  } catch {
    return false;
  }
}

function pinnedTitle(shown: boolean): string {
  if (!MENU_BAR) return "Pinned to the top of Search Markets";
  return shown ? "Pinned to the menu bar" : "Pinned. Open Pinned Prices once to show it in the menu bar";
}

export function usePins() {
  const [pins, setPins] = useState<number[]>([]);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    loadPins()
      .then(setPins)
      .catch((error) => showFailureToast(error, { title: "Couldn't read your pins" }))
      .finally(() => setLoading(false));
  }, []);

  const toggle = useCallback(async (outcome: number, title: string) => {
    try {
      const result = togglePin(await loadPins(), outcome);
      if (!result.ok) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Can't pin more markets",
          message: result.reason,
        });
        return;
      }
      const shown = await savePins(result.pins);
      setPins(result.pins);
      if (!result.pinned) {
        await showToast({ style: Toast.Style.Success, title: "Unpinned", message: title });
        return;
      }
      await showToast({ style: Toast.Style.Success, title: pinnedTitle(shown), message: title });
    } catch (error) {
      await showFailureToast(error, { title: "Couldn't save your pins" });
    }
  }, []);

  return { pins, isLoading, toggle };
}
