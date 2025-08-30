import { Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";

export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <TouchableOpacity onPress={() => router.replace("./frontend/(tabs)/camera")}>
        <Text>Get Started</Text>
      </TouchableOpacity>
    </View>
  );
}
