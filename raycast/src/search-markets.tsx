import { Icon, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useCallback, useRef, useState } from "react";
import { api, parseOutcome } from "./lib/api.ts";
import { CATEGORY_LABEL } from "./lib/format.ts";
import { LoadError, MarketItem, useLive, useShowDetail } from "./market-list.tsx";
import { usePins } from "./pins.ts";

const PAGE = { title: "Markets", path: "/console" };

export default function SearchMarkets() {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("all");
  const [showDetail, setShowDetail] = useShowDetail();
  const { pins, toggle, isLoading: pinsLoading } = usePins();
  const q = text.trim();
  const byId = parseOutcome(q) !== null;
  const showPinned = !q && category === "all" && pins.length > 0;

  const abortable = useRef<AbortController>(null);
  const results = useLive(
    (q: string, category: string) =>
      api.search({ q, category: category === "all" ? undefined : category }, abortable.current?.signal),
    [q, byId ? "all" : category],
    { abortable },
  );
  const pinned = useLive((ids: number[]) => api.pinned(ids), [pins], { execute: showPinned });
  // A failure here leaves the dropdown at All Categories; the results already say what went wrong.
  const categories = useCachedPromise(() => api.categories(), [], { onError: () => undefined });

  const { revalidate: reloadResults } = results;
  const { revalidate: reloadPinned } = pinned;
  const revalidate = useCallback(() => {
    reloadResults();
    if (showPinned) reloadPinned();
  }, [reloadResults, reloadPinned, showPinned]);

  const pinnedMarkets = showPinned ? (pinned.data ?? []).flatMap((p) => (p.market ? [p.market] : [])) : [];
  const shown = new Set(pinnedMarkets.map((m) => m.outcome));
  const markets = (results.data ?? []).filter((m) => !shown.has(m.outcome));
  const isLoading = results.isLoading || pinsLoading || (showPinned && pinned.isLoading);
  const item = { showDetail, setShowDetail, revalidate, page: PAGE, onPin: toggle };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      onSearchTextChange={setText}
      throttle
      searchBarPlaceholder="Search HIP-4 markets, or paste a market link"
      searchBarAccessory={
        <List.Dropdown tooltip="Category" storeValue onChange={setCategory}>
          <List.Dropdown.Item title="All Categories" value="all" />
          {(categories.data ?? []).map((value) => (
            <List.Dropdown.Item key={value} title={CATEGORY_LABEL[value] ?? value} value={value} />
          ))}
        </List.Dropdown>
      }
    >
      {pinnedMarkets.length > 0 && (
        <List.Section title="Pinned">
          {pinnedMarkets.map((m) => (
            <MarketItem key={m.outcome} market={m} pinned {...item} />
          ))}
        </List.Section>
      )}
      <List.Section
        title={q ? "Results" : "Busiest Today"}
        subtitle={markets.length ? String(markets.length) : undefined}
      >
        {markets.map((m) => (
          <MarketItem key={m.outcome} market={m} pinned={pins.includes(m.outcome)} {...item} />
        ))}
      </List.Section>
      {!isLoading &&
        (results.error && !results.data ? (
          <LoadError error={results.error} retry={revalidate} />
        ) : (
          <List.EmptyView
            icon={Icon.MagnifyingGlass}
            title={byId ? "No market with that ID" : "No markets match"}
            description="Try a ticker, a team or an event, such as BTC, Arsenal or Fed."
          />
        ))}
    </List>
  );
}
