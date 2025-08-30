import { BlurView } from "expo-blur";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
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
  // UI state + a ref so we can export a redacted PNG
  const webviewRef = useRef<WebView>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const redactionRef = useRef<View>(null);
  const [showBlur, setShowBlur] = useState(true);
  const [containerW, setContainerW] = useState(0);
  const containerH = 280; // matches your <Image> height

  const MIN_ENTITY_SCORE = 0.85;
  const SENSITIVE_CATEGORIES = new Set([
    "ACCOUNTNUM",
    "BUILDINGNUM",
    "CITY",
    "CREDITCARDNUMBER",
    "DATEOFBIRTH",
    "DRIVERLICENSENUM",
    "EMAIL",
    "GIVENNAME",
    "IDCARDNUM",
    "PASSWORD",
    "SOCIALNUM",
    "STREET",
    "SURNAME",
    "TAXNUM",
    "TELEPHONENUM",
    "USERNAME",
    "ZIPCODE",
  ]);

  function isSensitiveBox(b: OCRBoxWithNER) {
    if (!b.entities || b.entities.length === 0) return false;
    return b.entities.some(
      (e) =>
        SENSITIVE_CATEGORIES.has(e.entity) && (e.score ?? 0) >= MIN_ENTITY_SCORE
    );
  }

  // Compute the displayed image rectangle for resizeMode="contain"
  function computeDisplayedRect(
    containerW: number,
    containerH: number,
    imageW: number,
    imageH: number
  ) {
    if (!imageW || !imageH)
      return {
        displayedW: containerW,
        displayedH: containerH,
        offsetX: 0,
        offsetY: 0,
      };
    const imgR = imageW / imageH;
    const boxR = containerW / containerH;
    if (imgR > boxR) {
      const displayedW = containerW;
      const displayedH = displayedW / imgR;
      return {
        displayedW,
        displayedH,
        offsetX: 0,
        offsetY: (containerH - displayedH) / 2,
      };
    } else {
      const displayedH = containerH;
      const displayedW = displayedH * imgR;
      return {
        displayedW,
        displayedH,
        offsetX: (containerW - displayedW) / 2,
        offsetY: 0,
      };
    }
  }

  // Map original image pixels -> on-screen coords (with letterbox offsets)
  function projectBox(
    bbox: OCRBox["bbox"],
    imgSize: { width: number; height: number },
    containerW: number,
    containerH: number
  ) {
    const { displayedW, displayedH, offsetX, offsetY } = computeDisplayedRect(
      containerW,
      containerH,
      imgSize.width,
      imgSize.height
    );
    const sx = displayedW / imgSize.width;
    const sy = displayedH / imgSize.height;

    // Optional padding to ensure full coverage around glyphs
    const pad = 2; // px in *display* space
    const left = offsetX + bbox.x0 * sx - pad;
    const top = offsetY + bbox.y0 * sy - pad;
    const width = (bbox.x1 - bbox.x0) * sx + pad * 2;
    const height = (bbox.y1 - bbox.y0) * sy + pad * 2;
    return { left, top, width, height };
  }

  // Export the redacted composite (image + overlays) as a PNG
  const saveRedacted = async () => {
    try {
      const uri = await captureRef(redactionRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") throw new Error("No media library permission");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Saved", "Redacted image saved to your photos.");
    } catch (e: any) {
      Alert.alert("Save failed", String(e));
    }
  };

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
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Text style={styles.headerIconText}>🔒</Text>
        </View>
        <Text style={styles.title}>Smart Redactor</Text>
        <Text style={styles.subtitle}>
          Automatically detect and blur sensitive information in images
        </Text>
      </View>

      {/* Image Upload Section */}
      {!imageUri ? (
        <Pressable style={styles.uploadArea} onPress={pickImage}>
          <View style={styles.uploadContent}>
            <View style={styles.uploadIconContainer}>
              <Text style={styles.uploadIcon}>📷</Text>
            </View>
            <Text style={styles.uploadTitle}>Select Image</Text>
            <Text style={styles.uploadDescription}>
              Choose an image to scan for sensitive information
            </Text>
            <View style={styles.uploadButton}>
              <Text style={styles.uploadButtonText}>Browse Photos</Text>
            </View>
          </View>
        </Pressable>
      ) : (
        <View style={styles.imageSection}>
          {/* Image Display */}
          <View style={styles.imageHeader}>
            <Text style={styles.sectionTitle}>Selected Image</Text>
            <Pressable style={styles.changeButton} onPress={pickImage}>
              <Text style={styles.changeButtonText}>Change</Text>
            </Pressable>
          </View>

          <View
            ref={redactionRef}
            onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
            style={styles.imageContainer}
          >
            <View style={styles.imageWrapper}>
              <Image
                source={{ uri: imageUri }}
                style={styles.selectedImage}
                resizeMode="contain"
              />

              {/* Blur overlays for sensitive content */}
              {showBlur &&
                results &&
                results.boxes.filter(isSensitiveBox).map((b, idx) => {
                  const rect = projectBox(
                    b.bbox,
                    results.imageSize,
                    containerW,
                    containerH
                  );
                  return (
                    <BlurView
                      key={idx}
                      intensity={80}
                      tint="dark"
                      style={[
                        styles.blurOverlay,
                        {
                          left: rect.left,
                          top: rect.top,
                          width: rect.width,
                          height: rect.height,
                        },
                      ]}
                      pointerEvents="none"
                    />
                  );
                })}
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionSection}>
            <Pressable
              style={[
                styles.primaryButton,
                isProcessing && styles.buttonDisabled,
              ]}
              onPress={runOCR}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <View style={styles.loadingContent}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.buttonText}>Analyzing...</Text>
                </View>
              ) : (
                <View style={styles.buttonContent}>
                  <Text style={styles.buttonIcon}>🔍</Text>
                  <Text style={styles.buttonText}>Scan & Redact</Text>
                </View>
              )}
            </Pressable>

            {results && (
              <View style={styles.controlsRow}>
                <Pressable
                  style={[
                    styles.secondaryButton,
                    !showBlur && styles.secondaryButtonActive,
                  ]}
                  onPress={() => setShowBlur(!showBlur)}
                >
                  <Text style={styles.secondaryButtonIcon}>
                    {showBlur ? "👁️" : "🙈"}
                  </Text>
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      !showBlur && styles.secondaryButtonTextActive,
                    ]}
                  >
                    {showBlur ? "Show Original" : "Hide Sensitive"}
                  </Text>
                </Pressable>

                <Pressable style={styles.saveButton} onPress={saveRedacted}>
                  <Text style={styles.saveButtonIcon}>💾</Text>
                  <Text style={styles.saveButtonText}>Save</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Results Summary */}
      {results && (
        <View style={styles.resultsSection}>
          <Text style={styles.sectionTitle}>Detection Summary</Text>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{results.boxes.length}</Text>
              <Text style={styles.statLabel}>Words Found</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={[styles.statNumber, styles.sensitiveNumber]}>
                {results.boxes.filter(isSensitiveBox).length}
              </Text>
              <Text style={styles.statLabel}>Sensitive Items</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statNumber}>
                {Math.round(
                  (results.boxes.filter((b) => (b.confidence || 0) > 80)
                    .length /
                    results.boxes.length) *
                    100
                )}
                %
              </Text>
              <Text style={styles.statLabel}>Accuracy</Text>
            </View>
          </View>

          {results.boxes.filter(isSensitiveBox).length > 0 && (
            <View style={styles.sensitiveAlert}>
              <Text style={styles.alertIcon}>⚠️</Text>
              <View style={styles.alertContent}>
                <Text style={styles.alertTitle}>
                  Sensitive Information Detected
                </Text>
                <Text style={styles.alertDescription}>
                  We found {results.boxes.filter(isSensitiveBox).length}{" "}
                  potentially sensitive
                  {results.boxes.filter(isSensitiveBox).length === 1
                    ? " item"
                    : " items"}{" "}
                  that have been automatically blurred.
                </Text>
              </View>
            </View>
          )}

          {/* Entity Types Found */}
          <View style={styles.entitySection}>
            <Text style={styles.entityTitle}>Detected Categories</Text>
            <View style={styles.entityGrid}>
              {Array.from(
                new Set(
                  results.boxes
                    .filter(isSensitiveBox)
                    .flatMap((box) => box.entities?.map((e) => e.entity) || [])
                )
              ).map((entityType, index) => (
                <View key={index} style={styles.entityTag}>
                  <Text style={styles.entityTagText}>{entityType}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Hidden OCR WebView - positioned absolutely to not affect layout */}
      <WebView
        ref={webviewRef}
        source={{ html }}
        onMessage={onWebViewMessage}
        style={styles.hiddenWebView}
        originWhitelist={["*"]}
        javaScriptEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
      />
    </SafeAreaView>
  );
}

const { width: screenWidth } = Dimensions.get("window");
const containerH = 280; // Updated height for better proportions

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 4,
  },
  hiddenWebView: {
    position: "absolute",
    top: -1000,
    left: -1000,
    width: 1,
    height: 0,
    opacity: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },

  // Header Styles
  header: {
    alignItems: "center",
    marginBottom: 24,
    paddingTop: 10,
  },
  headerIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  headerIconText: {
    fontSize: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1f2937",
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 260,
  },

  // Upload Area Styles
  uploadArea: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
    borderWidth: 2,
    borderColor: "#e5e7eb",
    borderStyle: "dashed",
    marginBottom: 20,
  },
  uploadContent: {
    alignItems: "center",
  },
  uploadIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#f0f9ff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  uploadIcon: {
    fontSize: 32,
  },
  uploadTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 6,
  },
  uploadDescription: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
  },
  uploadButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
  },
  uploadButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Image Section Styles
  imageSection: {
    marginBottom: 24,
  },
  imageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
  },
  changeButton: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  changeButtonText: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "500",
  },
  imageContainer: {
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    marginBottom: 20,
  },
  imageWrapper: {
    width: "100%",
    height: containerH,
    backgroundColor: "#f9fafb",
    borderRadius: 20,
    overflow: "hidden",
  },
  selectedImage: {
    width: "100%",
    height: "100%",
  },
  blurOverlay: {
    position: "absolute",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#ef4444",
  },

  // Action Section Styles
  actionSection: {
    gap: 16,
  },
  primaryButton: {
    backgroundColor: "#3b82f6",
    borderRadius: 20,
    padding: 18,
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonDisabled: {
    backgroundColor: "#9ca3af",
    shadowColor: "#9ca3af",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  buttonIcon: {
    fontSize: 18,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  controlsRow: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: "#e5e7eb",
  },
  secondaryButtonActive: {
    backgroundColor: "#fef3c7",
    borderColor: "#f59e0b",
  },
  secondaryButtonIcon: {
    fontSize: 16,
  },
  secondaryButtonText: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButtonTextActive: {
    color: "#92400e",
  },
  saveButton: {
    backgroundColor: "#10b981",
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#10b981",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonIcon: {
    fontSize: 16,
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },

  // Results Section Styles
  resultsSection: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1f2937",
    marginBottom: 4,
  },
  sensitiveNumber: {
    color: "#dc2626",
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
    textAlign: "center",
  },
  sensitiveAlert: {
    backgroundColor: "#fef2f2",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  alertIcon: {
    fontSize: 20,
    marginTop: 2,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#991b1b",
    marginBottom: 4,
  },
  alertDescription: {
    fontSize: 13,
    color: "#7f1d1d",
    lineHeight: 18,
  },
  entitySection: {
    marginTop: 8,
  },
  entityTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 12,
  },
  entityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  entityTag: {
    backgroundColor: "#dbeafe",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#93c5fd",
  },
  entityTagText: {
    fontSize: 12,
    color: "#1d4ed8",
    fontWeight: "600",
    textTransform: "uppercase",
  },
});
