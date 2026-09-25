export const createActiveWorkoutUnmountCleanup =
  (dismiss: () => Promise<void>): (() => void) =>
  () => {
    void dismiss();
  };
