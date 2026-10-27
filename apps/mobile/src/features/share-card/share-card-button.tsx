import { useState } from "react";
import type { ShareCardContent, ShareCardOptions } from "@mizyun/core";

import { Button } from "@/components/ui";
import { isShareCardAvailable } from "./share-card-native";
import { ShareCardSheet } from "./share-card-sheet";

/**
 * "Share as image" for a completed session (ADR-0082). Works without
 * Community; hidden in builds that lack the native capture/share modules.
 */
export function ShareCardButton(props: {
  readonly userId: string;
  readonly build: (options: ShareCardOptions) => ShareCardContent;
  readonly communityHandle: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!props.userId || !isShareCardAvailable()) return null;
  return (
    <>
      <Button
        label="Share as image"
        icon="share"
        variant="secondary"
        block
        accessibilityHint="Preview a session card image before sharing it to any app"
        onPress={() => setOpen(true)}
      />
      <ShareCardSheet
        visible={open}
        userId={props.userId}
        build={props.build}
        communityHandle={props.communityHandle}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
