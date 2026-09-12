import { Redirect } from "expo-router";

import { isProgressPhotosEnabled } from "@/composition/app-variant";
import { ProgressPhotosScreen } from "@/features/progress-photos/progress-photos-screen";

export default function ProgressPhotosRoute() {
  if (!isProgressPhotosEnabled()) {
    return <Redirect href="/" />;
  }

  return <ProgressPhotosScreen />;
}
