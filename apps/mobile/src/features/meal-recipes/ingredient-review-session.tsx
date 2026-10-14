import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { IngredientReview } from "./ingredient-review";
import { createRecipeIngredientReviewController } from "./ingredient-review-composition";
import { registerIngredientReviewRetirement } from "./ingredient-review-lifecycle";
import type { IngredientReviewController } from "./ingredient-review-controller";
export interface RecipeIngredientReviewProps {
  readonly userId: string;
  readonly isCurrent: () => boolean;
  readonly onConfirmed: (
    value: NonNullable<
      Awaited<ReturnType<IngredientReviewController["confirm"]>>
    >,
  ) => void;
  readonly onCancel?: () => void;
}
let hostSequence = 0;
export function RecipeIngredientReview(props: RecipeIngredientReviewProps) {
  const controller = useMemo(
    () => createRecipeIngredientReviewController(props.userId, props.isCurrent),
    [props.userId, props.isCurrent],
  );
  const lifetime = useMemo(() => ({ active: true }), [controller]);
  const viewKey = useMemo(() => ++hostSequence, [controller]);
  useEffect(() => {
    lifetime.active = true;
    const unregister = registerIngredientReviewRetirement(
      props.userId,
      (reason) =>
        reason === "account" ? controller.dispose() : controller.retireAi(),
    );
    void controller.init();
    const listener = AppState.addEventListener("change", (state) => {
      // Android's picker is another Activity. Do not cancel the deliberate pick
      // merely because its system UI temporarily backgrounds the app.
      if (
        state === "background" &&
        controller.getSnapshot().phase !== "picking"
      )
        void controller.cancel();
    });
    return () => {
      lifetime.active = false;
      unregister();
      listener.remove();
      void controller.dispose().catch(() => undefined);
    };
  }, [controller, props.userId, lifetime]);
  return (
    <IngredientReview
      key={viewKey}
      controller={controller}
      onConfirmed={(value) => {
        if (lifetime.active && props.isCurrent()) props.onConfirmed(value);
      }}
      {...(props.onCancel ? { onCancel: props.onCancel } : {})}
    />
  );
}
