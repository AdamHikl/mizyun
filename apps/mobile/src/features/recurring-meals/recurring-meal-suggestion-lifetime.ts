const revisions = new Map<string, number>();
const listeners = new Set<(owner: string) => void>();
let activeOwner: string | null = null;
export const isRecurringSuggestionOwnerActive = (owner: string): boolean =>
  activeOwner === owner;
export function setRecurringSuggestionOwner(owner: string | null): void {
  const previous = activeOwner;
  activeOwner = owner;
  if (previous && previous !== owner) retireRecurringMealSuggestions(previous);
}
export const recurringSuggestionLifetime = (owner: string): number =>
  revisions.get(owner) ?? 0;
export function retireRecurringMealSuggestions(owner: string): void {
  revisions.set(owner, recurringSuggestionLifetime(owner) + 1);
  for (const listener of listeners) listener(owner);
}
export function subscribeRecurringSuggestionRetirement(
  listener: (owner: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
