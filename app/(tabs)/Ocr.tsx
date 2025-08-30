import React, { useMemo, useRef, useState } from "react";
import { View, Text, Button, Image, ActivityIndicator, FlatList, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import WebView, { WebViewMessageEvent } from "react-native-webview";

type BridgeMsg =
  | { ok: true; ready?: true; text?: string }
  | { ok: false; error: string };

export default function Ocr() {
  const webviewRef = useRef<WebView>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedTexts, setExtractedTexts] = useState<string[]>([]);

  const html = useMemo(
    () => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
</head>
<body>
<script>
(function(){
  function send(obj){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }

  async function runOcr(b64){
    try{
      const { data: { text } } = await Tesseract.recognize('data:image/*;base64,' + b64, 'eng', { logger: () => {} });
      send({ ok: true, text });
    } catch (e) {
      send({ ok: false, error: String(e) });
    }
  }

  function onMsg(ev){
    try {
      const msg = JSON.parse(ev.data);
      if (msg.cmd === 'ocr' && msg.imageBase64) runOcr(msg.imageBase64);
    } catch(e) {
      send({ ok: false, error: 'Bad message: ' + e });
    }
  }

  window.addEventListener('message', onMsg);
  document.addEventListener('message', onMsg); // iOS legacy
  send({ ok: true, ready: true });
})();
</script>
</body>
</html>
`.trim(),
    []
  );

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Please allow photo library access.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: false,
      base64: false,
    });
    if (!res.canceled) {
      setImageUri(res.assets[0].uri);
    }
  };

  const runOCR = async () => {
    if (!imageUri) {
      Alert.alert("Pick an image first");
      return;
    }
    setIsProcessing(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      webviewRef.current?.postMessage(JSON.stringify({ cmd: "ocr", imageBase64: base64 }));
    } catch (e: any) {
      setIsProcessing(false);
      Alert.alert("Read error", String(e));
    }
  };

  const onWebViewMessage = (e: WebViewMessageEvent) => {
    setIsProcessing(false);
    try {
      const msg = JSON.parse(e.nativeEvent.data) as BridgeMsg;
      if ("ready" in msg && msg.ready) return; // WebView loaded
      if (msg.ok && msg.text !== undefined) {
        const clean = msg.text.trim();
        setExtractedTexts((prev) => [clean, ...prev]);
      } else if (!msg.ok) {
        Alert.alert("OCR error", msg.error);
      }
    } catch (err) {
      Alert.alert("Bridge error", String(err));
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 12, paddingTop: 50 }}>
      {/* Hidden worker */}
      <WebView
        ref={webviewRef}
        source={{ html }}
        onMessage={onWebViewMessage}
        style={{ width: 0, height: 0, opacity: 0 }}
        originWhitelist={["*"]}
        javaScriptEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
      />

      <Button title="Pick image" onPress={pickImage} />
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={{ width: "100%", height: 220, resizeMode: "contain", borderRadius: 12 }} />
      ) : (
        <Text style={{ opacity: 0.7 }}>No image selected</Text>
      )}

      <Button title="Run OCR" onPress={runOCR} />
      {isProcessing && <ActivityIndicator size="large" />}

      <Text style={{ fontWeight: "600", marginTop: 8 }}>Extracted texts (latest first):</Text>
      {/* Show latest OCR output as a single line */}
      <Text style={{ color: "#007aff", marginBottom: 4 }}>
        Latest output: {extractedTexts[0] ?? "(none)"}
      </Text>
      <FlatList
        data={extractedTexts}
        keyExtractor={(_, i) => i.toString()}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}>
            <Text>{item || "(empty result)"}</Text>
          </View>
        )}
      />
      <FlatList
        data={extractedTexts}
        keyExtractor={(_, i) => i.toString()}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}>
            <Text>{item || "(empty result)"}</Text>
          </View>
        )}
      />
    </View>
  );
}
