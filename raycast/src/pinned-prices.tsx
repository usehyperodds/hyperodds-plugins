import {
  Clipboard,
  Color,
  getPreferenceValues,
  Icon,
  LaunchType,
  LocalStorage,
  launchCommand,
  MenuBarExtra,
  open,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { ApiError, api, SITE } from "./lib/api.ts";
import { menuBar, relative, type TitleMode } from "./lib/format.ts";
import { loadPins, writePins } from "./pins.ts";

// Prices older than this leave the menu bar title, so an old price never passes for a current one.
const STALE_MS = 5 * 60_000;

const RETRY_AT = "retry-at";

// Raycast runs this about once a minute. After an answer with Retry-After, it leaves the API alone until
// that time has passed.
async function load() {
  const retryAt = Number(await LocalStorage.getItem(RETRY_AT)) || 0;
  const wait = Math.ceil((retryAt - Date.now()) / 1000);
  if (wait > 0)
    throw new ApiError(`Waiting ${wait} more second${wait === 1 ? "" : "s"}, as Hyperodds asked.`, {
      retryAfter: wait,
    });
  const pins = await loadPins();
  try {
    const pinned = await api.pinned(pins);
    if (retryAt) await LocalStorage.removeItem(RETRY_AT);
    return { pins, pinned, at: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.retryAfter > 0)
      await LocalStorage.setItem(RETRY_AT, Date.now() + error.retryAfter * 1000);
    throw error;
  }
}

function launch(name: string) {
  return () =>
    launchCommand({ name, type: LaunchType.UserInitiated }).catch((error) =>
      showFailureToast(error, { title: "Couldn't open the command" }),
    );
}

const TONE = {
  up: { source: Icon.ArrowUp, tintColor: Color.Green },
  down: { source: Icon.ArrowDown, tintColor: Color.Red },
};

export default function PinnedPrices() {
  const { title: mode } = getPreferenceValues<{ title: TitleMode }>();
  const { data, isLoading, error, revalidate } = useCachedPromise(load, [], {
    keepPreviousData: true,
    // Runs every minute in the background; a failure shows inside the menu rather than as a toast each time.
    onError: () => undefined,
  });
  const pins = data?.pins ?? [];
  const bar = menuBar(data?.pinned ?? [], mode);
  const now = Date.now();
  const fresh = data !== undefined && !error && now - data.at < STALE_MS;

  async function unpin(outcome: number) {
    try {
      await writePins((await loadPins()).filter((id) => id !== outcome));
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: "Couldn't unpin the market" });
    }
  }

  return (
    <MenuBarExtra
      icon={{ source: "menu-bar.png", tintColor: Color.PrimaryText }}
      title={fresh ? bar.title : undefined}
      tooltip="Hyperodds: pinned HIP-4 prices"
      isLoading={isLoading}
    >
      {error && <MenuBarExtra.Item title="Couldn't refresh prices" subtitle={error.message} />}
      {data && !fresh && bar.items.length > 0 && (
        <MenuBarExtra.Item title={`Last updated ${relative(data.at, now)}`} icon={Icon.Clock} />
      )}
      {!isLoading && pins.length === 0 && (
        <MenuBarExtra.Item
          title="Pin a market to see its price here"
          subtitle="Search Markets, then Pin to Menu Bar"
          icon={Icon.Pin}
          onAction={launch("search-markets")}
        />
      )}
      {bar.items.length > 0 && (
        <MenuBarExtra.Section title="Pinned">
          {bar.items.map((item) => (
            <MenuBarExtra.Item
              key={item.outcome}
              title={item.title}
              subtitle={item.subtitle}
              icon={item.tone === "flat" ? Icon.Minus : TONE[item.tone]}
              tooltip="Open on Hyperodds (hold ⌥ to copy the link)"
              onAction={() => open(item.url)}
              alternate={
                <MenuBarExtra.Item
                  title={`Copy Link: ${item.title}`}
                  onAction={() => Clipboard.copy(item.url)}
                />
              }
            />
          ))}
        </MenuBarExtra.Section>
      )}
      {bar.gone.length > 0 && (
        <MenuBarExtra.Section title="No Longer Listed">
          {bar.gone.map((outcome) => (
            <MenuBarExtra.Item
              key={outcome}
              title={`Unpin #${outcome}`}
              icon={Icon.PinDisabled}
              onAction={() => unpin(outcome)}
            />
          ))}
        </MenuBarExtra.Section>
      )}
      <MenuBarExtra.Section>
        {bar.items.length > 0 && (
          <MenuBarExtra.Submenu title="Unpin" icon={Icon.PinDisabled}>
            {bar.items.map((item) => (
              <MenuBarExtra.Item key={item.outcome} title={item.title} onAction={() => unpin(item.outcome)} />
            ))}
          </MenuBarExtra.Submenu>
        )}
        <MenuBarExtra.Item
          title="Search Markets"
          icon={Icon.MagnifyingGlass}
          onAction={launch("search-markets")}
        />
        <MenuBarExtra.Item title="Top Edges" icon={Icon.Gauge} onAction={launch("top-edges")} />
        <MenuBarExtra.Item
          title="Open Hyperodds"
          icon={Icon.Globe}
          onAction={() => open(`${SITE}/console`)}
        />
        <MenuBarExtra.Item title="Refresh" icon={Icon.ArrowClockwise} onAction={revalidate} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
