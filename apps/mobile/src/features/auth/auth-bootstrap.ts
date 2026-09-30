import type { AuthSession } from "@mizyun/identity";

export async function hydrateAuthBootstrap<P>(ports: {
  isCurrent(): boolean;
  getSession(): Promise<AuthSession | null>;
  cachedProfile(userId: string): Promise<P | null>;
  applyProfile(profile: P): void;
  applySession(session: AuthSession | null): void;
}): Promise<void> {
  const session = await ports.getSession();
  if (!ports.isCurrent()) return;
  if (session && session.accessToken !== "preview-token") {
    const cached = await ports.cachedProfile(session.user.id).catch(() => null);
    if (!ports.isCurrent()) return;
    if (cached) ports.applyProfile(cached);
  }
  ports.applySession(session);
}
