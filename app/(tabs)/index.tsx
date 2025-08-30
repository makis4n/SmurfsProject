import { View, TouchableOpacity, Text } from 'react-native';
import { router } from 'expo-router';

export default function HomeScreen() {
  return (
    <View>
      <TouchableOpacity onPress={() => router.replace('/(tabs)/Ocr')}>
        <Text>Press me</Text>
      </TouchableOpacity>
    </View>
  );
}
