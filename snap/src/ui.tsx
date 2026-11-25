import { Address, Banner, Box, Heading, Row, Section, Text } from "@metamask/snaps-sdk/jsx";
import type { Insight } from "./decode";

export function Panel({ insight }: { insight: Insight }) {
  return (
    <Box>
      <Banner title={insight.verdict} severity={insight.level}>
        <Text>{insight.reason}</Text>
      </Banner>
      <Heading size="sm">{insight.title}</Heading>
      <Text color="alternative">{insight.body}</Text>
      <Section>
        {insight.fields.map((f) => (
          <Row key={f.label} label={f.label}>
            {"address" in f ? (
              <Address address={f.address} displayName truncate={false} />
            ) : (
              <Text>{f.text}</Text>
            )}
          </Row>
        ))}
        {insight.network ? (
          <Row label="Network">
            <Text>{insight.network}</Text>
          </Row>
        ) : null}
      </Section>
    </Box>
  );
}
