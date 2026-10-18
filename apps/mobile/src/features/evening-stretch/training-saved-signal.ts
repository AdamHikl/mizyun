/**
 * Dependency-free signal so save screens can announce finished training
 * without importing the reminder runtime or its data reads.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export const noteTrainingSaved = (): void => {
  for (const listener of listeners) listener();
};

export const onTrainingSaved = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
