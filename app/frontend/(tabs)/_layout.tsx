import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="ocr" options={{ title: "OCR" }} />
    </Tabs>
  );
}
