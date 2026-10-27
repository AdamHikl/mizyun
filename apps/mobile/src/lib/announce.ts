import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Speak a status message to the screen reader.
 *
 * React Native's `accessibilityLiveRegion` is Android-only and
 * `accessibilityRole="alert"` adds no iOS trait, so on iOS VoiceOver
 * only speaks dynamic results through an explicit announcement.
 * Android keeps using live regions; announcing there as well would
 * speak the same text twice.
 */
export function announce(message: string | null | undefined): void {
  const text = message?.trim();
  if (!text || Platform.OS !== "ios") return;
  AccessibilityInfo.announceForAccessibility(text);
}

/**
 * Announce `message` once each time it becomes a new non-empty value
 * (including when it first appears). Re-renders with the same message
 * stay silent; clearing it lets the same text be announced again.
 */
export function useAnnouncement(message: string | null | undefined): void {
  const previous = useRef<string | null>(null);
  const text = message?.trim() || null;
  useEffect(() => {
    if (text === previous.current) return;
    previous.current = text;
    announce(text);
  }, [text]);
}

/** Plain text of string/number children, or "" for richer content. */
export function textOfChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map((child: ReactNode) => textOfChildren(child)).join("");
  }
  return "";
}
