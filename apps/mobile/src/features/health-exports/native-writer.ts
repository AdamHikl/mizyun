import * as Crypto from "expo-crypto";
import {
  applyOperationAsync,
  availabilityAsync,
  installationIdAsync,
  invalidateAsync,
  requestWritePermissionAsync,
} from "../../../modules/mizyun-health-export";
import { HealthExportOutbox, type HealthExportWriter } from "./export-outbox";
import { SecureHealthExportStorage } from "./export-storage";

export const nativeHealthExportWriter: HealthExportWriter = {
  applyOperationAsync,
  availabilityAsync,
  installationIdAsync,
  invalidateAsync,
  requestWritePermissionAsync,
};
/** Single foreground controller; lifecycle ownership belongs to the mobile root. */
export const healthExportOutbox = new HealthExportOutbox(
  new SecureHealthExportStorage(),
  nativeHealthExportWriter,
  () => Crypto.randomUUID(),
);
