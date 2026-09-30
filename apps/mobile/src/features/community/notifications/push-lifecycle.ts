import { isSameAuthSession } from "@mizyun/identity";

/** Captured sessions are memory-only. Persist only installation ID and opted-in owner. */
export interface PushPrincipal {
  user: { id: string };
  accessToken: string;
  sessionId?: string;
}
export interface PushBinding {
  userId: string;
  installationId: string;
}
export interface CommunityPushPorts {
  installationId(): Promise<string>;
  readBinding(): Promise<PushBinding | null>;
  writeBinding(binding: PushBinding | null): Promise<void>;
  permission(prompt: boolean): Promise<boolean>;
  expoToken(): Promise<string>;
  register(
    principal: PushPrincipal,
    installationId: string,
    token: string,
  ): Promise<boolean>;
  remove(principal: PushPrincipal, installationId: string): Promise<boolean>;
}
export type PushRegistrationOutcome =
  "registered" | "denied" | "unavailable" | "cancelled" | "not_enabled";
export class CommunityPushLifecycle {
  private principal: PushPrincipal | null = null;
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ports: CommunityPushPorts) {}
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** Must run on every auth change; new accounts require their own explicit choice. */
  setPrincipal(principal: PushPrincipal | null): Promise<void> {
    const previous = this.principal;
    if (isSameAuthSession(previous, principal)) {
      this.principal = principal;
      return Promise.resolve();
    }
    this.principal = principal;
    this.revision++;
    return this.serialize(async () => {
      const binding = await this.ports.readBinding();
      if (previous && binding?.userId === previous.user.id) {
        await this.ports.writeBinding(null);
        await this.ports.remove(previous, binding.installationId);
      } else if (binding && binding.userId !== principal?.user.id) {
        // A previous account's opt-in never enrolls the current account.
        await this.ports.writeBinding(null);
      }
    });
  }
  async deregister(captured?: PushPrincipal | null): Promise<boolean> {
    const principal = captured === undefined ? this.principal : captured;
    if (!principal) return true;
    // A newer login for the same account owns this installation now. Removing
    // by installation ID with an older bearer could remove its registration.
    if (
      this.principal?.user.id === principal.user.id &&
      !isSameAuthSession(this.principal, principal)
    )
      return true;
    if (isSameAuthSession(this.principal, principal)) {
      this.revision++;
      this.principal = null;
    }
    return this.serialize(async () => {
      const binding = await this.ports.readBinding();
      if (binding?.userId === principal.user.id)
        await this.ports.writeBinding(null);
      const installation =
        binding?.userId === principal.user.id
          ? binding.installationId
          : await this.ports.installationId();
      return this.ports.remove(principal, installation);
    }).catch(() => false);
  }
  registerExplicit(expectedUserId: string): Promise<PushRegistrationOutcome> {
    return this.register(true, expectedUserId);
  }
  refreshToken(): Promise<PushRegistrationOutcome> {
    return this.register(false);
  }
  private register(
    prompt: boolean,
    expectedUserId?: string,
  ): Promise<PushRegistrationOutcome> {
    const principal = this.principal;
    const revision = this.revision;
    const valid = () =>
      principal !== null &&
      this.principal?.user.id === principal.user.id &&
      this.revision === revision;
    return this.serialize(async () => {
      if (
        !principal ||
        !valid() ||
        (expectedUserId && principal.user.id !== expectedUserId)
      )
        return "cancelled";
      const binding = await this.ports.readBinding();
      if (!valid()) return "cancelled";
      if (!prompt && binding?.userId !== principal.user.id)
        return "not_enabled";
      if (!(await this.ports.permission(prompt))) {
        if (binding?.userId === principal.user.id) {
          await this.ports.writeBinding(null);
          await this.ports.remove(principal, binding.installationId);
        }
        return valid() ? "denied" : "cancelled";
      }
      if (!valid()) return "cancelled";
      const installationId = await this.ports.installationId();
      const token = await this.ports.expoToken();
      if (!valid()) return "cancelled";
      if (
        !/^(?:ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(
          token,
        )
      )
        return "unavailable";
      // Persist intent before network registration so timeout/lost responses can be deregistered.
      await this.ports.writeBinding({
        userId: principal.user.id,
        installationId,
      });
      if (!valid()) return "cancelled";
      const registered = await this.ports.register(
        principal,
        installationId,
        token,
      );
      return valid()
        ? registered
          ? "registered"
          : "unavailable"
        : "cancelled";
    }).catch(() => "unavailable");
  }
}
export function communityEventId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { communityEventId?: unknown }).communityEventId;
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}
