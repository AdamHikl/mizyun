import { useState } from "react";
import { PrivateMealPhoto } from "./private-meal-photo";
import { AutomaticMealIllustration } from "./automatic-meal-illustration";

/** Real retained photos win; the illustration never participates in saving a meal. */
export function MealVisual({
  enabled,
  entryId,
  name,
  hasPhoto,
  photoAssetId,
  editable = false,
}: {
  readonly enabled: boolean;
  readonly entryId: string;
  readonly name: string;
  readonly hasPhoto: boolean;
  readonly photoAssetId?: string | null;
  readonly editable?: boolean;
}) {
  const scope = `${entryId}:${hasPhoto}`;
  const [removedScope, setRemovedScope] = useState<string | null>(null);
  if (!enabled)
    return editable ? (
      <PrivateMealPhoto
        entryId={entryId}
        hasPhoto={hasPhoto}
        photoAssetId={photoAssetId}
        editable
        displayEnabled={false}
        onPhotoRemoved={() => setRemovedScope(scope)}
      />
    ) : null;
  return (
    <PrivateMealPhoto
      entryId={entryId}
      hasPhoto={hasPhoto}
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
