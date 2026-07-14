import { createClient } from "@supabase/supabase-js";

import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier, AuthPrincipal } from "@mizyun/identity";

interface ClaimsClient {
  readonly auth: {
    getClaims(jwt: string): Promise<{
      readonly data: { readonly claims?: Record<string, unknown> } | null;
      readonly error: unknown;
    }>;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly client: ClaimsClient) {}

  async verify(accessToken: string): Promise<AuthPrincipal | null> {
    if (!accessToken) return null;

    const { data, error } = await this.client.auth.getClaims(accessToken);
    if (error || !data?.claims) return null;

    const subject = data.claims.sub;
    if (typeof subject !== "string" || !UUID_PATTERN.test(subject)) return null;

    const email = data.claims.email;
    const role = data.claims.role;

    return {
      userId: subject as UserId,
      ...(typeof email === "string" ? { email } : {}),
      ...(typeof role === "string" ? { role } : {}),
    };
  }
}

export interface SupabaseServerConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export const createSupabaseAccessTokenVerifier = (
  configuration: SupabaseServerConfiguration,
): AccessTokenVerifier => {
  const client = createClient(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return new SupabaseAccessTokenVerifier(client);
};
