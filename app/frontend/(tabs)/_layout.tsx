import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs screenOptions= {{ headerShown: false }}>
      <Tabs.Screen name="camera" options={{ title: "Camera" }} />
      <Tabs.Screen name="photos" options={{ title: "Photos" }} />
    </Tabs>
  );
}
