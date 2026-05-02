import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { usePasskey } from '../hooks/usePasskey';
import { QRScannerScreen } from './QRScannerScreen';
import { BASE_URL } from '../config';

export function HomeScreen() {
  const [username, setUsername] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const { register, authenticate, loading, status } = usePasskey(BASE_URL);

  const isAndroid = Platform.OS === 'android';

  if (showScanner) {
    return (
      <QRScannerScreen
        username={username}
        onClose={() => setShowScanner(false)}
        onSuccess={() => {
          setShowScanner(false);
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Passkey PoC</Text>
      <Text style={styles.subtitle}>Android パスキー認証デモ</Text>

      {!isAndroid && (
        <Text style={styles.warning}>このアプリは Android 専用です</Text>
      )}

      <TextInput
        style={styles.input}
        placeholder="ユーザー名"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.button, styles.primaryButton, loading && styles.disabled]}
        onPress={() => register(username)}
        disabled={loading || !username.trim()}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>パスキーを登録</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.secondaryButton, loading && styles.disabled]}
        onPress={() => authenticate(username)}
        disabled={loading || !username.trim()}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>パスキーでサインイン</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.crossDeviceButton, loading && styles.disabled]}
        onPress={() => setShowScanner(true)}
        disabled={loading}
      >
        <Text style={styles.buttonText}>QR でサインイン（別デバイス）</Text>
      </TouchableOpacity>

      {status.type !== 'idle' && (
        <View
          style={[
            styles.statusBox,
            status.type === 'success' ? styles.successBox : styles.errorBox,
          ]}
        >
          <Text style={styles.statusText}>{status.message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
  },
  warning: {
    color: '#c00',
    marginBottom: 16,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  secondaryButton: {
    backgroundColor: '#34C759',
  },
  crossDeviceButton: {
    backgroundColor: '#5856D6',
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusBox: {
    marginTop: 16,
    width: '100%',
    padding: 12,
    borderRadius: 8,
  },
  successBox: {
    backgroundColor: '#d4edda',
  },
  errorBox: {
    backgroundColor: '#f8d7da',
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
