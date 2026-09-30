/** A previously loaded owner profile is not fresh authorization to render it. */
export class DiscoveryAccessGate {
  private ready = false;
  private revision = 0;
  private listeners = new Set<() => void>();
  getState = (): boolean => this.ready;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  invalidate(): void {
    this.revision++;
    this.ready = false;
    for (const listener of this.listeners) listener();
  }
  async revalidate(load: () => Promise<void>): Promise<void> {
    this.invalidate();
    const revision = this.revision;
    await load();
    if (revision !== this.revision) return;
    this.ready = true;
    for (const listener of this.listeners) listener();
  }
}
