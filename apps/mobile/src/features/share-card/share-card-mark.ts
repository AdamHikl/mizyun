import type { ImageSourcePropType } from "react-native";

/**
 * The small Mizyun mark in the card footer. Resolved on first render so
 * modules that only import the share button never load the asset.
 */
export const shareCardMark = (): ImageSourcePropType =>
  require("@/assets/images/mizyun-mark.png");
