import { communityEventId } from "./push-lifecycle";
/** Resolution could not reach an authority decision (offline, 5xx, rate limit). */
export const COMMUNITY_TAP_TRANSIENT = { transient: true } as const;
export type CommunityTapResolution =
  string | null | typeof COMMUNITY_TAP_TRANSIENT;
export interface CommunityTapPorts {
  resolve(
    userId: string,
    eventId: string,
    isCurrent: () => boolean,
  ): Promise<CommunityTapResolution>;
  markRead(
    userId: string,
    eventId: string,
    isCurrent: () => boolean,
  ): Promise<boolean>;
  isPrincipalCurrent(userId: string): boolean;
  navigate(path: string): void;
  clearLastResponse(): void;
}
/** Holds only opaque references in memory; authorizes every attempted destination. */
export class CommunityTapController {
  private principal: string | null = null;
  private foreground = false;
  private revision = 0;
  private pending: string | null = null;
  private resolving = false;
  private consumed = new Set<string>();
  constructor(private ports: CommunityTapPorts) {}
  setPrincipal(principal: string | null) {
    if (principal !== this.principal) {
      this.principal = principal;
      this.revision++;
      this.resolving = false;
    }
    void this.consume();
  }
  setForeground(foreground: boolean) {
    if (foreground !== this.foreground) {
      this.foreground = foreground;
      this.revision++;
      this.resolving = false;
    }
    void this.consume();
  }
  receive(data: unknown) {
    const id = communityEventId(data);
    if (!id || this.consumed.has(id) || this.pending === id) return;
    this.pending = id;
    this.revision++;
    this.resolving = false;
    void this.consume();
  }
  stop() {
    this.foreground = false;
    this.revision++;
    this.resolving = false;
  }
  private async consume() {
    const principal = this.principal,
      event = this.pending;
    if (
      !principal ||
      !event ||
      !this.foreground ||
      this.resolving ||
      !this.ports.isPrincipalCurrent(principal)
    )
      return;
    const revision = ++this.revision;
    this.resolving = true;
    const valid = () =>
      this.foreground &&
      this.principal === principal &&
      this.revision === revision &&
      this.ports.isPrincipalCurrent(principal);
    let resolution: CommunityTapResolution = null;
    try {
      resolution = await this.ports.resolve(principal, event, valid);
    } catch {
      /* Generic unavailable state; no payload logging. */
    }
    if (!valid()) return; // Retain pending event for a fresh resume/account authorization.
    const transient = resolution === COMMUNITY_TAP_TRANSIENT;
    const destination = typeof resolution === "string" ? resolution : null;
    let readConfirmed = true;
    if (destination) {
      try {
        readConfirmed = await this.ports.markRead(principal, event, valid);
      } catch {
        readConfirmed = false;
      }
      if (!valid()) return;
    }
    this.pending = null;
    this.resolving = false;
    if (this.consumed.size >= 100) this.consumed.clear();
    this.consumed.add(event);
    this.ports.clearLastResponse();
    this.ports.navigate(
      transient
        ? "/community/inbox?notice=offline"
        : !readConfirmed
          ? "/community/inbox?notice=read_unconfirmed"
          : (destination ?? "/community/inbox?notice=unavailable"),
    );
  }
}
