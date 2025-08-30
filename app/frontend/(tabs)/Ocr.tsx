import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Image,
  Text,
  View,
} from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import { runNER } from "../services/ner";

type OCRBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence?: number;
};

type NEREntity = {
  entity: string;
  word: string;
  score: number;
  start: number;
  end: number;
};

type OCRBoxWithNER = OCRBox & {
  entities: NEREntity[];
};

type OCRResult = {
  text: string;
  boxes: OCRBox[];
  imageSize: { width: number; height: number };
};

type OCRResultWithNER = OCRResult & {
  boxes: OCRBoxWithNER[];
};

type BridgeMsg =
  | { ok: true; ready?: true }
  | {
      ok: true;
      text: string;
      boxes: OCRBox[];
      imageSize: { width: number; height: number };
    }
  | { ok: false; error: string };

export default function Ocr() {
  const webviewRef = useRef<WebView>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Store full OCR results (text + bounding boxes)
  const [results, setResults] = useState<OCRResultWithNER | null>(null);

  const html = useMemo(
    () =>
      `
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

  function loadImage(dataUrl){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function runOcr(b64){
    try{
      const dataUrl = 'data:image/*;base64,' + b64;

      // get original image dimensions (useful for scaling boxes in RN)
      const imgSize = await loadImage(dataUrl);

      const { data } = await Tesseract.recognize(dataUrl, 'eng', { logger: () => {} });

      // Collect word-level boxes
      const boxes = (data.words || []).map(w => ({
        text: w.text || '',
        bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
        confidence: w.confidence
      }));

      send({ ok: true, text: (data.text || '').trim(), boxes, imageSize: imgSize });
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
      webviewRef.current?.postMessage(
        JSON.stringify({ cmd: "ocr", imageBase64: base64 })
      );
    } catch (e: any) {
      setIsProcessing(false);
      Alert.alert("Read error", String(e));
    }
  };

  const onWebViewMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as BridgeMsg;

      if ("ready" in msg && (msg as any).ready) return;

      if ((msg as any).ok && "text" in (msg as any)) {
        const payload = msg as Extract<BridgeMsg, { ok: true; text: string }>;
        const record: OCRResult = {
          text: payload.text.trim(),
          boxes: payload.boxes || [],
          imageSize: payload.imageSize || { width: 0, height: 0 },
        };
        runNERForBoxes(record).then((recordWithEntities: OCRResultWithNER) => {
          setResults(recordWithEntities);
        });
      } else if (!(msg as any).ok) {
        const err = (msg as any).error ?? "Unknown error";
        Alert.alert("OCR error", String(err));
      }
    } catch (err) {
      Alert.alert("Bridge error", String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  // * Runs NER on each box's text and appends entities array
  const runNERForBoxes = async (record: OCRResult) => {
    const updatedBoxes: OCRBoxWithNER[] = [];

    for (const box of record.boxes) {
      try {
        const entities = await runNER(box.text);
        updatedBoxes.push({ ...box, entities: entities || [] });
      } catch (error) {
        console.error("NER error for box:", box, error);
        updatedBoxes.push({ ...box, entities: [] });
      }
    }

    return {
      ...record,
      boxes: updatedBoxes,
    };
  };

  // Optional: helper to scale boxes to your displayed Image size
  const scaleBoxes = (r: OCRResult, displayedW: number, displayedH: number) => {
    const sx = displayedW / r.imageSize.width;
    const sy = displayedH / r.imageSize.height;
    return r.boxes.map((b) => ({
      ...b,
      bbox: {
        x0: b.bbox.x0 * sx,
        y0: b.bbox.y0 * sy,
        x1: b.bbox.x1 * sx,
        y1: b.bbox.y1 * sy,
      },
    }));
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
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
        <Image
          source={{ uri: imageUri }}
          style={{
            width: "100%",
            height: 220,
            resizeMode: "contain",
            borderRadius: 12,
          }}
        />
      ) : (
        <Text style={{ opacity: 0.7 }}>No image selected</Text>
      )}

      <Button title="Run OCR" onPress={runOCR} />
      {isProcessing && <ActivityIndicator size="large" />}

      <Text style={{ fontWeight: "600", marginTop: 8 }}>
        OCR results (latest first):
      </Text>
      <FlatList
        data={results ? [results] : []}
        keyExtractor={(_, i) => i.toString()}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}>
            <Text style={{ fontWeight: "600", marginBottom: 6 }}>Text</Text>
            <Text>{item.text || "(empty result)"}</Text>
            <Text style={{ marginTop: 8, fontWeight: "600" }}>Boxes</Text>
            <Text>count: {item.boxes.length}</Text>
            {/* Example of first box */}
            {/* Output the result of the bounding boxes (first box as JSON) */}
            {item.boxes[0] && (
              <Text style={{ color: "#d2691e", marginBottom: 4 }}>
                First bounding box: {JSON.stringify(item.boxes[0])}
              </Text>
            )}
            {item.boxes[0] && (
              <Text style={{ opacity: 0.7, marginTop: 4 }}>
                first: &quot;{item.boxes[0].text}&quot; → (
                {item.boxes[0].bbox.x0}, {item.boxes[0].bbox.y0}) - (
                {item.boxes[0].bbox.x1}, {item.boxes[0].bbox.y1})
              </Text>
            )}
          </View>
        )}
      />
    </View>
  );
}
