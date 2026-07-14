import { createSupabaseMobileAuthClient } from "@mizyun/adapter-supabase-mobile";
import { DisabledAuthClient, type AuthClient } from "@mizyun/identity";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const authClient: AuthClient =
  url && publishableKey
    ? createSupabaseMobileAuthClient({ url, publishableKey })
    : new DisabledAuthClient();
