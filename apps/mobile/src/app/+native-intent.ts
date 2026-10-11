import { getAppVariant } from "../composition/app-variant";
import { invitationSystemPath } from "../features/community/invitation-system-path";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  return invitationSystemPath(
    path,
    getAppVariant() === "dev" ? "mizyun-dev" : "mizyun",
  );
}
