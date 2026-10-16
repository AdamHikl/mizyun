import React, { useState } from "react";
import { useRouter, type Href } from "expo-router";
import { isBoulderingEnabled } from "@/composition/app-variant";
import { ShareBoulderingModal } from "./share-bouldering-modal";
import { CommunityButton, CommunityPage, CommunityState } from "./ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valid only for a well-formed session id; the server checks ownership. */
export function shareableBoulderingSessionId(
  value: string | string[] | undefined,
): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/**
 * `/community/share-bouldering?sessionId=…` (ADR-0067). Opens the exact
 * server preview for one finished session; closing returns to the session.
 */
export function CommunityShareBoulderingScreen({
  sessionId: rawSessionId,
}: {
  sessionId: string | string[] | undefined;
}) {
  const router = useRouter();
  const sessionId = shareableBoulderingSessionId(rawSessionId);
  const enabled = isBoulderingEnabled();
  const [open, setOpen] = useState(true);
  const leave = () => {
    setOpen(false);
    if (router.canGoBack()) router.back();
  };
  return (
    <CommunityPage
      title="Share session"
      description="Preview exactly what your approved followers can see before you publish."
      backHref={"/workouts" as Href}
    >
      {!enabled ? (
        <CommunityState
          title="Bouldering isn't available"
          description="Indoor bouldering is not turned on for this app yet. Nothing was shared."
        />
      ) : !sessionId ? (
        <CommunityState
          title="Session not found"
          description="Open a finished bouldering session and choose Share session."
        />
      ) : (
        <>
          <CommunityState
            title="Session card preview"
            description="Nothing is shared until you choose Publish session."
            action={
              <CommunityButton
                label="Preview session card"
                onPress={() => setOpen(true)}
              />
            }
          />
          {open ? (
            <ShareBoulderingModal
              key={sessionId}
              visible
              sessionId={sessionId}
              onDismiss={leave}
            />
          ) : null}
        </>
      )}
    </CommunityPage>
  );
}
