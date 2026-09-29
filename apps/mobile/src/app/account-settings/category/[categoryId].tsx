import { useLocalSearchParams } from "expo-router";
import { SettingsCategoryScreen } from "@/features/settings/settings-category-screen";

export default function CategoryRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  return <SettingsCategoryScreen categoryId={categoryId ?? ""} />;
}
