import { useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import {
  localPhotoRecord,
  useLocalPhotoUri,
} from "@/features/private-photos/local-photo-library";
import { PrivateMealPhoto } from "./private-meal-photo";
import { AutomaticMealIllustration } from "./automatic-meal-illustration";
import { LocalMealPhoto } from "./local-meal-photo";

/**
 * Real retained photos win; the illustration never participates in saving a
 * meal. This phone's copy is shown first, without network or Pro (ADR-0079);
 * a server backup is read only when the phone has no current copy.
 */
export function MealVisual({
  enabled,
  offline = false,
  entryId,
  name,
  hasPhoto,
  photoAssetId,
  editable = false,
}: {
  readonly enabled: boolean;
  /** Display allowed by the offline grace: bundled icons, no server reads. */
  readonly offline?: boolean;
  readonly entryId: string;
  readonly name: string;
  readonly hasPhoto: boolean;
  readonly photoAssetId?: string | null;
  readonly editable?: boolean;
}) {
  const scope = `${entryId}:${hasPhoto}`;
  const [removedScope, setRemovedScope] = useState<string | null>(null);
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const localUri = useLocalPhotoUri(owner, "meal", entryId);
  const local =
    owner && localUri ? localPhotoRecord(owner, "meal", entryId) : null;
  // A backup replaced on another device makes this copy stale; the server
  // read below downloads the new photo over it.
  const stale =
    !!local?.assetId && !!photoAssetId && local.assetId !== photoAssetId;
  if (owner && localUri && !stale && removedScope !== scope)
    return (
      <LocalMealPhoto
        owner={owner}
        entryId={entryId}
        uri={localUri}
        // The list can lag a backup made after it loaded.
        hasServerCopy={hasPhoto || !!local?.assetId}
        editable={editable}
        onPhotoRemoved={() => setRemovedScope(scope)}
      />
    );
  const serverPhoto = hasPhoto && removedScope !== scope;
  if (!enabled)
    return editable ? (
      <PrivateMealPhoto
        entryId={entryId}
        hasPhoto={serverPhoto}
        photoAssetId={photoAssetId}
        editable
        displayEnabled={false}
        onPhotoRemoved={() => setRemovedScope(scope)}
      />
    ) : null;
  // Offline grace (ADR-0053 amendment): only bundled icons, never a signed
  // photo read or an illustration generation request. Photo controls need
  // the server, so they return with the next server confirmation.
  if (offline)
    return (
      <AutomaticMealIllustration
        entryId={entryId}
        name={name}
        allowGeneration={false}
      />
    );
  return (
    <PrivateMealPhoto
      entryId={entryId}
      hasPhoto={serverPhoto}
      photoAssetId={photoAssetId}
      editable={editable}
      onPhotoRemoved={() => setRemovedScope(scope)}
      fallback={
        <AutomaticMealIllustration
          entryId={entryId}
          name={name}
          allowGeneration={!hasPhoto || removedScope === scope}
        />
      }
    />
  );
}
