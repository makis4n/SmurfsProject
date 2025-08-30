import React, { useEffect, useState } from "react";
import { TouchableOpacity } from "react-native";
import { View, ActivityIndicator, Image, StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as MediaLibrary from "expo-media-library";

export default function AssetScreen() {
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!assetId) return;
        const info = await MediaLibrary.getAssetInfoAsync(assetId);
        // Prefer a file:// path when available (Android can return content://)
        const resolved = info.localUri || info.uri;
        if (alive) setUri(resolved ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [assetId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={styles.center}>
        <Text>Couldn’t load image.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>
      <Image source={{ uri }} style={styles.image} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  image: { width: "100%", height: "100%", resizeMode: "contain" },
  backButton: {
    position: "absolute",
    top: 50,
    left: 20,
    backgroundColor: "#222",
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    zIndex: 1,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
  },
});
