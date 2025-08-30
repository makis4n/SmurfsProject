import * as MediaLibrary from "expo-media-library";
import React, { useEffect, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function Photos() {
  const [photos, setPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [uris, setUris] = useState<{ [id: string]: string }>({});

  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setHasPermission(status === "granted");
      if (status === "granted") {
        const album = await MediaLibrary.getAlbumAsync("Camera");
        const assets = await MediaLibrary.getAssetsAsync({
          album: album?.id,
          mediaType: "photo",
          first: 50,
          sortBy: [["creationTime", false]],
        });
        setPhotos(assets.assets);

        // Fetch displayable URIs for each asset
        const urisObj: { [id: string]: string } = {};
        await Promise.all(
          assets.assets.map(async (asset) => {
            const info = await MediaLibrary.getAssetInfoAsync(asset.id);
            urisObj[asset.id] = info.localUri || asset.uri;
          })
        );
        setUris(urisObj);
      }
    })();
  }, []);

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text>Requesting permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text>No access to photos.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={photos}
      keyExtractor={(item) => item.id}
      numColumns={3}
      renderItem={({ item }) => (
        <TouchableOpacity>
          <Image source={{ uri: uris[item.id] }} style={styles.image} />
        </TouchableOpacity>
      )}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 2 },
  image: { width: 120, height: 120, margin: 2, borderRadius: 8 },
});
