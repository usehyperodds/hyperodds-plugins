import { Icon, List } from "@raycast/api";
import { api } from "./lib/api.ts";
import { LoadError, MarketItem, useLive, useShowDetail } from "./market-list.tsx";
import { usePins } from "./pins.ts";

const PAGE = { title: "Edges", path: "/edges" };

export default function TopEdges() {
  const [showDetail, setShowDetail] = useShowDetail();
  const { pins, toggle } = usePins();
  const { data, error, isLoading, revalidate } = useLive(() => api.edges(50), []);
  const item = { showDetail, setShowDetail, revalidate, page: PAGE, onPin: toggle };

  return (
    <List isLoading={isLoading} isShowingDetail={showDetail} searchBarPlaceholder="Filter edges">
      <List.Section
        title="Biggest Edges After Fees"
        subtitle="$100 buy, fair lines from more than one source"
      >
        {(data ?? []).map((m) => (
          <MarketItem key={m.outcome} market={m} pinned={pins.includes(m.outcome)} edges {...item} />
        ))}
      </List.Section>
      {!isLoading &&
        (error && !data ? (
          <LoadError error={error} retry={revalidate} />
        ) : (
          <List.EmptyView
            icon={Icon.Gauge}
            title="No edges above half a point right now"
            description="Edges come and go as prices move. Search Markets finds any market."
          />
        ))}
    </List>
  );
}
