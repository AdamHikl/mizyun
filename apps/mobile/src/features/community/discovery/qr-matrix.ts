import qrcode from "qrcode-generator";
import { parseCommunityInvitationLink } from "../invitation-links";

/** Pure local encoder: never sends an invitation capability to a QR service. */
export function invitationQrMatrix(
  link: string,
): readonly (readonly boolean[])[] | null {
  if (
    !parseCommunityInvitationLink(link, "mizyun") &&
    !parseCommunityInvitationLink(link, "mizyun-dev")
  )
    return null;
  const code = qrcode(0, "M");
  code.addData(link, "Byte");
  code.make();
  const count = code.getModuleCount();
  // Include the required four-module quiet zone in the renderable matrix.
  return Array.from({ length: count + 8 }, (_, row) =>
    Array.from(
      { length: count + 8 },
      (_, column) =>
        row >= 4 &&
        column >= 4 &&
        row < count + 4 &&
        column < count + 4 &&
        code.isDark(row - 4, column - 4),
    ),
  );
}
