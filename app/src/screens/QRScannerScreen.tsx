import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const BASE_URL = 'http://localhost:3000';

type Props = {
  username: string;
  onClose: () => void;
  onSuccess: () => void;
};

export function QRScannerScreen({ username, onClose, onSuccess }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const scannedAtRef = useRef<number>(0);

  // 全フックを早期 return より前に宣言（Rules of Hooks）
  useEffect(() => {
    if (!waiting) return;
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') return;
      try {
        const res = await fetch(
          `${BASE_URL}/authentication/status?username=${encodeURIComponent(username)}&since=${scannedAtRef.current}`
        );
        const { authenticated } = await res.json();
        if (authenticated) {
          setWaiting(false);
          onSuccess();
        }
      } catch {
        // ネットワークエラーは無視して待機継続
      }
    });
    return () => subscription.remove();
  }, [waiting, username, onSuccess]);

  const handleBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned) return;
    if (!data.toUpperCase().startsWith('FIDO:/')) {
      Alert.alert('エラー', 'パスキーの QR コードではありません', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
      setScanned(true);
      return;
    }
    setScanned(true);
    scannedAtRef.current = Date.now();
    Linking.openURL(data).catch(() => {
      Alert.alert('エラー', 'QR コードを処理できませんでした', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    });
    setWaiting(true);
  }, [scanned]);

  // 早期 return はフックの後
  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>カメラへのアクセスが必要です</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>許可する</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose}>
          <Text style={styles.buttonText}>キャンセル</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (waiting) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={[styles.message, { marginTop: 24 }]}>
          生体認証を完了してください
        </Text>
        <Text style={[styles.message, { fontSize: 12, opacity: 0.7, marginTop: 8 }]}>
          認証完了後、自動で画面が切り替わります
        </Text>
        <TouchableOpacity
          style={[styles.cancelButton, { marginTop: 40 }]}
          onPress={() => { setWaiting(false); onClose(); }}
        >
          <Text style={styles.buttonText}>キャンセル</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <View style={styles.overlay}>
        <Text style={styles.instruction}>
          PC ブラウザに表示された QR コードをスキャンしてください
        </Text>
        <View style={styles.frame} />
        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.buttonText}>キャンセル</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
  },
  instruction: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 32,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 12,
    borderRadius: 8,
  },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
  },
  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 32,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
    width: 200,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 14,
    borderRadius: 8,
    width: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
