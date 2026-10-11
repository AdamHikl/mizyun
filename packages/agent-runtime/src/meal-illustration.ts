/** Image generation is decorative; this port never receives health history or photographs. */
export interface MealIllustrationProvider {
  generate(dishName: string, signal: AbortSignal): Promise<Uint8Array>;
}
