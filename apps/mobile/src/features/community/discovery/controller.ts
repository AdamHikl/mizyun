import type { ApiClient, ApiError } from "@mizyun/api-client";
import type {
  CommunityInvitationDto,
  PublicCommunityProfileDto,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import { randomUUID } from "expo-crypto";
import { scopeCommunityClient } from "../scoped-client";
import {
  createCommunityInvitation,
  fetchCommunityInvitations,
  resolveCommunityInvitation,
  revokeCommunityInvitation,
  searchCommunityProfiles,
  requestFollow,
  humanizeCommunityError,
} from "../community-client";
import { followResolvedInvitation } from "../invitation-actions";

export interface DiscoveryState {
  busy: boolean;
  error: string | null;
  notice: string | null;
  searched: boolean;
  result: PublicCommunityProfileDto | null;
  inviter: PublicCommunityProfileDto | null;
  invitations: readonly CommunityInvitationDto[];
  displayedInvitation: CommunityInvitationDto | null;
}
const empty = (): DiscoveryState => ({
  busy: false,
  error: null,
  notice: null,
  searched: false,
  result: null,
  inviter: null,
  invitations: [],
  displayedInvitation: null,
});
/** All identities and bearer capabilities stay in this principal's volatile memory. */
export class DiscoveryController {
  private state = empty();
  private listeners = new Set<() => void>();
  private active = false;
  private revision = 0;
  private client: ApiClient;
  constructor(
    client: ApiClient,
    private readonly principal: string | null,
    private readonly token?: string,
    isCurrent: () => boolean = () => true,
  ) {
    const scoped = scopeCommunityClient(
      client,
      principal,
      () => this.active && isCurrent(),
    );
    this.client = {
      status: () => scoped.status(),
      request: (options) => {
        const revision = this.revision;
        return scoped.request({
          ...options,
          isCurrent: () =>
            revision === this.revision && (options.isCurrent?.() ?? true),
        });
      },
    };
  }
  getState = (): DiscoveryState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<DiscoveryState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  pause() {
    this.active = false;
    this.revision++;
    this.state = empty();
    for (const listener of this.listeners) listener();
  }
  async resume() {
    this.active = Boolean(this.principal);
    await this.refresh();
  }
  private async run<T>(
    work: () => Promise<Result<T, ApiError>>,
    apply: (value: T) => void,
  ) {
    if (!this.active || this.state.busy) return;
    const revision = ++this.revision;
    this.update({ busy: true, error: null, notice: null });
    const result = await work();
    if (!this.active || revision !== this.revision) return;
    this.update({ busy: false });
    if (result.ok) apply(result.value);
    else
      this.update({
        result: null,
        inviter: null,
        displayedInvitation: null,
        invitations: [],
        error: humanizeCommunityError(
          result.error,
          "Unavailable. Refresh or ask your friend for a new invitation.",
        ),
      });
  }
  async refresh() {
    if (!this.active || this.state.busy) return;
    const revision = this.revision + 1;
    this.update({
      result: null,
      inviter: null,
      invitations: [],
      displayedInvitation: null,
      searched: false,
    });
    await this.run(
      () => fetchCommunityInvitations(this.client),
      (value) => this.update({ invitations: value.items }),
    );
    if (!this.active || revision !== this.revision) return;
    if (this.token && /^[A-Za-z0-9_-]{22}$/.test(this.token)) {
      await this.run(
        () => resolveCommunityInvitation(this.client, this.token!),
        (value) =>
          this.update({
            inviter: value.isExpired || value.isRevoked ? null : value.inviter,
            error:
              value.isExpired || value.isRevoked
                ? "Invitation unavailable. Ask your friend for a new link."
                : null,
          }),
      );
    } else if (this.token)
      this.update({
        error: "Invitation unavailable. Ask your friend for a new link.",
      });
  }
  clearSearch() {
    if (!this.state.busy) this.update({ result: null, searched: false });
  }
  async search(raw: string) {
    const handle = raw.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
      this.update({
        result: null,
        searched: false,
        error: "Enter one exact handle (3–24 letters, numbers or underscores).",
      });
      return;
    }
    this.update({ result: null, searched: false });
    await this.run(
      () => searchCommunityProfiles(this.client, handle, 1),
      (value) =>
        this.update({
          searched: true,
          result:
            value.profiles.find((profile) => profile.handle === handle) ?? null,
        }),
    );
  }
  async create() {
    await this.run(
      () => createCommunityInvitation(this.client),
      (value) =>
        this.update({
          displayedInvitation: value.invitation,
          invitations: [value.invitation, ...this.state.invitations],
        }),
    );
  }
  show(id: string) {
    if (!this.active || this.state.busy) return;
    const invitation = this.state.invitations.find((item) => item.id === id);
    if (
      invitation &&
      !invitation.revokedAt &&
      Date.parse(invitation.expiresAt) > Date.now()
    )
      this.update({ displayedInvitation: invitation });
  }
  async revoke(id: string) {
    if (!this.state.invitations.some((item) => item.id === id)) return;
    this.update({ displayedInvitation: null });
    await this.run(
      () => revokeCommunityInvitation(this.client, id),
      () =>
        this.update({
          invitations: this.state.invitations.map((item) =>
            item.id === id
              ? { ...item, revokedAt: new Date().toISOString() }
              : item,
          ),
          notice: "Invitation revoked. Handle search settings are unchanged.",
        }),
    );
  }
  async follow(user: PublicCommunityProfileDto, fromInvitation: boolean) {
    const current = fromInvitation ? this.state.inviter : this.state.result;
    if (
      current !== user ||
      user.userId === this.principal ||
      ["following", "mutual", "pending_outgoing"].includes(
        user.relationshipWithViewer ?? "",
      )
    )
      return;
    const operationId = randomUUID();
    await this.run(
      () =>
        fromInvitation && this.token
          ? followResolvedInvitation(
              this.client,
              this.token,
              user.userId,
              () => this.active,
              operationId,
            )
          : requestFollow(this.client, user.userId, undefined, operationId),
      (value) => {
        const updated = {
          ...user,
          relationshipWithViewer:
            value.status === "approved"
              ? ("following" as const)
              : value.status === "pending"
                ? ("pending_outgoing" as const)
                : ("none" as const),
        };
        this.update({
          [fromInvitation ? "inviter" : "result"]: updated,
          notice:
            value.status === "pending"
              ? "Request sent. Your friend must approve; this does not follow you back."
              : value.status === "approved"
                ? "You follow this friend."
                : "This request ended. It was not sent again.",
        });
      },
    );
  }
}
