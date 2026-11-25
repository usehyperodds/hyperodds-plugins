import { Icon, List } from "@raycast/api";
import { api } from "./lib/api.ts";
import { LoadError, MarketItem, useLive, useShowDetail } from "./market-list.tsx";
import { usePins } from "./pins.ts";

const PAGE = { title: "New Listings", path: "/new" };

export default function NewListings() {
  const [showDetail, setShowDetail] = useShowDetail();
  const { pins, toggle } = usePins();
  const { data, error, isLoading, revalidate } = useLive(() => api.newest(), []);
  const item = { showDetail, setShowDetail, revalidate, page: PAGE, onPin: toggle };

  return (
    <List isLoading={isLoading} isShowingDetail={showDetail} searchBarPlaceholder="Filter new listings">
      <List.Section title="Newest First">
        {(data ?? []).map((m) => (
          <MarketItem key={m.outcome} market={m} pinned={pins.includes(m.outcome)} {...item} />
        ))}
      </List.Section>
      {!isLoading &&
        (error && !data ? (
          <LoadError error={error} retry={revalidate} />
        ) : (
          <List.EmptyView icon={Icon.Calendar} title="No new listings yet" />
        ))}
    </List>
  );
}
