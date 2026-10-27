import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Keyboard,
  Platform,
  type ScrollView,
  type ViewStyle,
} from "react-native";
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/**
 * Space to reserve below a view so its bottom edge sits above a docked
 * keyboard. `keyboardHeight` is React Native's Android value, which excludes
 * the navigation bar, so the keyboard's top edge is `keyboardHeight +
 * navigationBarInset` above the bottom of the window. `viewBottom` is the
 * view's bottom edge in window coordinates before any reserved space.
 */
export function keyboardOverlap(input: {
  viewBottom: number;
  windowHeight: number;
  keyboardHeight: number;
  navigationBarInset: number;
}): number {
  if (input.keyboardHeight <= 0) return 0;
  const keyboardTop =
    input.windowHeight - input.keyboardHeight - input.navigationBarInset;
  return Math.max(0, Math.round(input.viewBottom - keyboardTop));
}

/**
 * Android 15+ apps targeting API 35+ are edge-to-edge, so the window is no
 * longer resized for the keyboard and `automaticallyAdjustKeyboardInsets` is
 * iOS-only. Pass a form ScrollView's ref and apply the returned style to that
 * ScrollView: on Android it shrinks above the keyboard and the native
 * ScrollView keeps the focused input visible. On iOS it returns `undefined`
 * so the existing inset behaviour is unchanged.
 */
export function useAndroidKeyboardInset(
  ref: RefObject<Pick<ScrollView, "getNativeScrollRef"> | null>,
): ViewStyle | undefined {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const [inset, setInset] = useState(0);
  const insetRef = useRef(0);
  const windowHeight = frame.height;
  const navigationBarInset = insets.bottom;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let active = true;
    // Each keyboard event supersedes a measurement still in flight, so a
    // hide that arrives before the measure callback cannot be undone by it.
    let event = 0;
    const apply = (next: number) => {
      insetRef.current = next;
      setInset(next);
    };
    const show = Keyboard.addListener("keyboardDidShow", (keyboard) => {
      const current = ++event;
      const keyboardHeight = keyboard.endCoordinates.height;
      ref.current
        ?.getNativeScrollRef()
        ?.measureInWindow((_x, y, _width, height) => {
          if (!active || current !== event) return;
          apply(
            keyboardOverlap({
              viewBottom: y + height + insetRef.current,
              windowHeight,
              keyboardHeight,
              navigationBarInset,
            }),
          );
        });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      event++;
      apply(0);
    });
    return () => {
      active = false;
      show.remove();
      hide.remove();
    };
  }, [navigationBarInset, ref, windowHeight]);

  if (Platform.OS !== "android") return undefined;
  return { marginBottom: inset };
}
