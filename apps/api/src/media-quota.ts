import type { UserId } from "@mizyun/core";

/**
 * SEC-02 — owner storage quota pre-check before a signed upload is issued.
 * The `private_media_quota_write` trigger is the authoritative bound for
 * every upload path; this check only turns a predictable rejection into a
 * clear API error before the client spends bandwidth.
 */
export interface MediaQuota {
  /** Whether one more object of `byteSize` bytes fits the owner's quota. */
  allows(
    userId: UserId,
    byteSize: number,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
}

/** Local/test composition: no Storage backend, so nothing to bound. */
export class UnboundedMediaQuota implements MediaQuota {
  async allows(): Promise<boolean> {
    return true;
  }
}
