import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { BASE_URL } from '../config';

type Props = {
  username: string;
  onClose: () => void;
  onSuccess: () => void;
};

export function AuthWaitingScreen({ username, onClose, onSuccess }: Props) {
  const sinceRef = useRef<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/authentication/status?username=${encodeURIComponent(username)}&since=${sinceRef.current}`,
          { headers: { 'ngrok-skip-browser-warning': 'true' } }
        );
        const { authenticated } = await res.json();
        if (authenticated) {
          clearInterval(timer);
          onSuccess();
        }
      } catch {
        // ネットワークエラーは無視して継続
      }
    }, 1000);

    const timeout = setTimeout(() => {
      clearInterval(timer);
      Alert.alert('タイムアウト', '認証がタイムアウトしました', [
        { text: 'OK', onPress: onClose },
      ]);
    }, 60000);

    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [username, onSuccess, onClose]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.title}>認証を待機中</Text>
      <Text style={styles.description}>
        PC ブラウザに表示された QR コードを{'\n'}
        カメラで読み取ってください
      </Text>
      <Text style={styles.hint}>
        認証が完了すると自動で切り替わります
      </Text>
      <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelText}>キャンセル</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    color: '#333',
    lineHeight: 24,
    marginBottom: 12,
  },
  hint: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    marginBottom: 48,
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  cancelText: {
    fontSize: 16,
    color: '#555',
  },
});
