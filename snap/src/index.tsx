import type { OnSignatureHandler } from "@metamask/snaps-sdk";
import { SeverityLevel } from "@metamask/snaps-sdk";
import { decode } from "./decode";
import { Panel } from "./ui";

export const onSignature: OnSignatureHandler = async ({ signature, signatureOrigin }) => {
  const insight = decode(signature, signatureOrigin);
  if (!insight) return null;
  const content = <Panel insight={insight} />;
  return insight.level === "danger" ? { content, severity: SeverityLevel.Critical } : { content };
};
