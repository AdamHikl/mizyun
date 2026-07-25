import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";
import { useAuth } from "@/features/auth/auth-context";

export default function OnboardingRoute() {
  const { refreshProfile } = useAuth();
  return <OnboardingScreen onComplete={() => void refreshProfile()} />;
}
