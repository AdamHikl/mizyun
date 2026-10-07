import {
  availabilityAsync,
  requestReadPermissionAsync,
  readPageAsync,
  invalidateAsync,
} from "../../../modules/mizyun-health-connections";
import type { HealthPreviewReader } from "./health-preview-controller";

export const nativeHealthPreviewReader: HealthPreviewReader = {
  availabilityAsync,
  requestReadPermissionAsync,
  readPageAsync,
  invalidateAsync,
};
