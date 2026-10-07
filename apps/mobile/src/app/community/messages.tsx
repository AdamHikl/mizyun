import { Redirect, useLocalSearchParams, type Href } from "expo-router";

export default function CommunityRootAlias() {
  const params = useLocalSearchParams();
  return (
    <Redirect
      href={{ pathname: "/(tabs)/community/messages", params } as Href}
    />
  );
}
