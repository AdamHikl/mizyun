/** Memory-only lifetime for a displayed social intent. Resume never revives old work. */
export class VisibilityEpoch {
  #revision = 0;
  invalidate(): void {
    this.#revision++;
  }
  capture(): () => boolean {
    const revision = this.#revision;
    return () => revision === this.#revision;
  }
}
