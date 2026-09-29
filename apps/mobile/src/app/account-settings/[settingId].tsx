import { useLocalSearchParams } from "expo-router";
import { SettingsDetailScreen } from "@/features/settings/settings-detail-screen";

export default function SettingDetailRoute() {
  const { settingId, anchor } = useLocalSearchParams<{
    settingId: string;
    anchor?: string;
  }>();
  return <SettingsDetailScreen settingKey={settingId ?? ""} anchor={anchor} />;
}
