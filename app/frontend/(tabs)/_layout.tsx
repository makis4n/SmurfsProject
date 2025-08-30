import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="camera" options={{ title: "Camera" }} />
      <Tabs.Screen name="photos" options={{ title: "Photos" }} />
    </Tabs>
  );
}
