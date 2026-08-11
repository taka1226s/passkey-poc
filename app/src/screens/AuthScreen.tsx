import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { authSignup, authLogin } from '../api/webauthnClient';
import { BASE_URL } from '../config';

type Props = {
  onLoggedIn: (username: string, authToken: string) => void;
  onClose: () => void;
};

export function AuthScreen({ onLoggedIn, onClose }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const { authToken } =
        mode === 'signup'
          ? await authSignup(BASE_URL, username.trim(), password)
          : await authLogin(BASE_URL, username.trim(), password);
      onLoggedIn(username.trim(), authToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Passkey PoC</Text>
      <Text style={styles.subtitle}>
        {mode === 'login' ? 'ログイン（ID/PASS）' : '新規登録（ID/PASS）'}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="ユーザー名"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="パスワード（8文字以上）"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.button, styles.primaryButton, loading && styles.disabled]}
        onPress={submit}
        disabled={loading || !username.trim() || !password}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === 'login' ? 'ログイン' : '新規登録'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.switchButton}
        onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}
        disabled={loading}
      >
        <Text style={styles.switchText}>
          {mode === 'login' ? 'アカウントをお持ちでない方はこちら' : 'すでにアカウントをお持ちの方はこちら'}
        </Text>
      </TouchableOpacity>

      {error !== '' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.switchButton} onPress={onClose} disabled={loading}>
        <Text style={styles.switchText}>キャンセルして戻る</Text>
      </TouchableOpacity>
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
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchButton: {
    padding: 8,
  },
  switchText: {
    color: '#007AFF',
    fontSize: 13,
  },
  errorBox: {
    marginTop: 16,
    width: '100%',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f8d7da',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    color: '#a00',
  },
});
