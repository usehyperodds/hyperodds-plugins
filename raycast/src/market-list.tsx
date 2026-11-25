import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { showFailureToast, useCachedPromise, useCachedState } from "@raycast/utils";
import { Fragment, type RefObject, useEffect, useRef } from "react";
import { type Market, marketUrl, REFRESH_MS, retryDelay, SITE } from "./lib/api.ts";
import { accessories, detailGroups, plainMarkdown, type Tone } from "./lib/format.ts";
import { MENU_BAR } from "./pins.ts";

const CATEGORY_ICON: Record<string, Icon> = {
  sports: Icon.Trophy,
  crypto: Icon.Coins,
  equities: Icon.LineChart,
  indices: Icon.BarChart,
  commodities: Icon.Droplets,
  macro: Icon.BankNote,
  ipo: Icon.Rocket,
  awards: Icon.Star,
};

const TONE_COLOR = { up: Color.Green, down: Color.Red, flat: undefined };
const [PIN, UNPIN] = MENU_BAR ? ["Pin to Menu Bar", "Unpin from Menu Bar"] : ["Pin Market", "Unpin Market"];

function colored(text: string, tone?: Tone) {
  const color = tone ? TONE_COLOR[tone] : undefined;
  return color ? { value: text, color } : text;
}

export function useShowDetail() {
  return useCachedState("show-detail", true);
}

// A cached request for an open view, refreshed on its own so the detail pane stays current. It backs
// off after failures (retryDelay), and only the first failure in a row shows a toast.
export function useLive<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  args: A,
  options: { execute?: boolean; abortable?: RefObject<AbortController | null> } = {},
) {
  const failures = useRef(0);
  const nextTry = useRef(0);
  const result = useCachedPromise(fn, args, {
    ...options,
    keepPreviousData: true,
    onData: () => {
      failures.current = 0;
      nextTry.current = 0;
    },
    onError: async (error) => {
      failures.current += 1;
      nextTry.current = Date.now() + retryDelay(failures.current, error);
      if (failures.current === 1) await showFailureToast(error, { title: "Couldn't refresh markets" });
    },
  });
  const { revalidate } = result;
  const execute = options.execute !== false;
  useEffect(() => {
    if (!execute) return;
    const timer = setInterval(() => {
      if (Date.now() >= nextTry.current) revalidate();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [revalidate, execute]);
  return result;
}

// What a list shows when its first load failed, so a failure never reads as "no markets".
export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <List.EmptyView
      icon={Icon.Warning}
      title="Couldn't load markets"
      description={error.message}
      actions={
        <ActionPanel>
          <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={retry} />
        </ActionPanel>
      }
    />
  );
}

function MarketDetail({ market }: { market: Market }) {
  return (
    <List.Item.Detail
      markdown={`### ${plainMarkdown(market.title)}`}
      metadata={
        <List.Item.Detail.Metadata>
          {detailGroups(market).map((rows, i) => (
            <Fragment key={rows[0].title}>
              {i > 0 && <List.Item.Detail.Metadata.Separator />}
              {rows.map((row) =>
                row.url ? (
                  <List.Item.Detail.Metadata.Link
                    key={row.title}
                    title={row.title}
                    text={row.text}
                    target={row.url}
                  />
                ) : (
                  <List.Item.Detail.Metadata.Label
                    key={row.title}
                    title={row.title}
                    text={colored(row.text, row.tone)}
                  />
                ),
              )}
            </Fragment>
          ))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export function MarketItem({
  market,
  pinned,
  onPin,
  showDetail,
  setShowDetail,
  revalidate,
  page,
  edges = false,
}: {
  market: Market;
  pinned: boolean;
  onPin: (outcome: number, title: string) => void;
  showDetail: boolean;
  setShowDetail: (show: boolean) => void;
  revalidate: () => void;
  page: { title: string; path: string };
  edges?: boolean;
}) {
  const url = marketUrl(market.outcome);
  const now = Date.now();
  return (
    <List.Item
      id={String(market.outcome)}
      title={market.title}
      keywords={[String(market.outcome), market.deployerName, market.subcategory ?? ""]}
      icon={{ source: CATEGORY_ICON[market.category] ?? Icon.Circle, tintColor: Color.SecondaryText }}
      accessories={
        showDetail
          ? undefined
          : accessories(market, now, { edges }).map((a) => ({
              text: colored(a.text, a.tone),
              tooltip: a.tooltip,
            }))
      }
      detail={showDetail ? <MarketDetail market={market} /> : undefined}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.OpenInBrowser title="Open on Hyperodds" url={url} />
            <Action.CopyToClipboard
              title="Copy Link"
              content={url}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action
              title={pinned ? UNPIN : PIN}
              icon={pinned ? Icon.PinDisabled : Icon.Pin}
              shortcut={Keyboard.Shortcut.Common.Pin}
              onAction={() => onPin(market.outcome, market.title)}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title={showDetail ? "Hide Details" : "Show Details"}
              icon={Icon.AppWindowSidebarRight}
              shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
              onAction={() => setShowDetail(!showDetail)}
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={revalidate}
            />
            <Action.OpenInBrowser title={`Open ${page.title} on Hyperodds`} url={`${SITE}${page.path}`} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
