import { useState } from "react";
import { PrivateMealPhoto } from "./private-meal-photo";
import { AutomaticMealIllustration } from "./automatic-meal-illustration";

/** Real retained photos win; the illustration never participates in saving a meal. */
export function MealVisual({
  entryId,
  name,
  hasPhoto,
  editable = false,
}: {
  readonly entryId: string;
  readonly name: string;
  readonly hasPhoto: boolean;
  readonly editable?: boolean;
}) {
  const scope = `${entryId}:${hasPhoto}`;
  const [removedScope, setRemovedScope] = useState<string | null>(null);
  return (
    <PrivateMealPhoto
      entryId={entryId}
      hasPhoto={hasPhoto}
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
