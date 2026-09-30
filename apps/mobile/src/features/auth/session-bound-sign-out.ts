import { isSameAuthSession, type AuthSession } from "@mizyun/identity";

export interface SessionBoundSignOutPorts {
  current(): AuthSession | null;
  purge(userId: string): Promise<void>;
  deregister(session: AuthSession): Promise<unknown>;
  signOut(session: AuthSession): Promise<void>;
  clear(): void;
}

export async function signOutCapturedSession(
  captured: AuthSession | null,
  ports: SessionBoundSignOutPorts,
): Promise<void> {
  if (!captured) return;
  const isCurrent = () => isSameAuthSession(ports.current(), captured);
  if (!isCurrent()) return;
  if (captured.accessToken === "preview-token") {
    ports.clear();
    return;
  }
  await ports.purge(captured.user.id).catch(() => {});
  if (!isCurrent()) return;
  await ports.deregister(captured);
  if (!isCurrent()) return;
  await ports.signOut(captured);
  // The SDK may have emitted its own null session while signing out. Do not
  // overwrite a new session that arrived while the response was pending.
  if (ports.current() !== null && !isCurrent()) return;
  ports.clear();
}
