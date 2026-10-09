import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { selectMealIllustration } from "./meal-illustration-catalog";

const baseAtlas = require("../../../assets/images/meal-illustrations/food-atlas-v1.png");

const supplementalAtlas = require("../../../assets/images/meal-illustrations/food-atlas-v2-supplement.png");

export function MealIllustrationTile({
  name,
  uri,
}: {
  readonly name: string;
  readonly uri?: string;
}) {
  const { row, column, matched, atlas } = selectMealIllustration(name);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const visibleUri = uri && failedUri !== uri ? uri : undefined;
  if (!visibleUri && !matched) return null;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Meal illustration (not a photo)"
      style={{ width: 60, height: 60, overflow: "hidden", borderRadius: 8 }}
    >
      <Image
        key={visibleUri ?? "catalog"}
        source={
          visibleUri
            ? { uri: visibleUri }
            : atlas === "supplement"
              ? supplementalAtlas
              : baseAtlas
        }
        cachePolicy={visibleUri ? "none" : "memory-disk"}
        contentFit="contain"
        accessible={false}
        onError={() => {
          if (visibleUri) setFailedUri(visibleUri);
        }}
        style={
          visibleUri
            ? { width: 60, height: 60 }
            : {
                position: "absolute",
                width: 240,
                height: 240,
                left: -column * 60,
                top: -row * 60,
              }
        }
      />
    </View>
  );
}
