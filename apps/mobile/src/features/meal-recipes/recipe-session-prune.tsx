import { useEffect } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { recipeSessionStore } from "./recipe-storage";
/** Prune only this authenticated owner's expired recipe data, never their meal operation. */
export function RecipeSessionPruneBridge() {
  const { session } = useAuth();
  useEffect(() => {
    if (session?.user.id)
      void recipeSessionStore.load(session.user.id).catch(() => undefined);
  }, [session?.user.id, session?.accessToken]);
  return null;
}
