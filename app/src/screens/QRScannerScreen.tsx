import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

type Props = {
  onClose: () => void;
};

export function QRScannerScreen({ onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

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

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    if (!data.toUpperCase().startsWith('FIDO:/')) {
      Alert.alert('エラー', 'パスキーの QR コードではありません', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
      setScanned(true);
      return;
    }
    setScanned(true);
    Linking.openURL(data).catch(() => {
      Alert.alert('エラー', 'QR コードを処理できませんでした', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    });
    onClose();
  };

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
