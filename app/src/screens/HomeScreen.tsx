import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { usePasskey } from '../hooks/usePasskey';
import { QRScannerScreen } from './QRScannerScreen';
import { AuthWaitingScreen } from './AuthWaitingScreen';
import { ApprovalScreen } from './ApprovalScreen';
import { BASE_URL } from '../config';
import { registerForPushNotifications, savePushTokenToServer } from '../utils/notifications';

type ApprovalRequest = { approvalId: string; username: string; sessionToken: string };

type Props = {
  approvalRequest: ApprovalRequest | null;
  onApprovalRequestConsumed: () => void;
  pendingBanner: ApprovalRequest | null;
  onBannerTapped: () => void;
  onBannerDismissed: () => void;
};

export function HomeScreen({
  approvalRequest,
  onApprovalRequestConsumed,
  pendingBanner,
  onBannerTapped,
  onBannerDismissed,
}: Props) {
  const [username, setUsername] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  const { register, authenticate, loading, status } = usePasskey(BASE_URL);

  useEffect(() => {
    registerForPushNotifications().catch(() => {});
  }, []);

  const handleUsernameBlur = useCallback(async () => {
    if (!username.trim()) return;
    try {
      const token = await registerForPushNotifications();
      if (token) {
        await savePushTokenToServer(username.trim(), token);
      }
    } catch {
      // トークン登録失敗は通知なしで継続
    }
  }, [username]);

  if (approvalRequest) {
    return (
      <ApprovalScreen
        approvalId={approvalRequest.approvalId}
        username={approvalRequest.username}
        sessionToken={approvalRequest.sessionToken}
        onDone={onApprovalRequestConsumed}
      />
    );
  }

  if (showScanner) {
    return (
      <QRScannerScreen
        username={username}
        onClose={() => setShowScanner(false)}
        onSuccess={() => setShowScanner(false)}
      />
    );
  }

  if (showWaiting) {
    return (
      <AuthWaitingScreen
        username={username}
        onClose={() => setShowWaiting(false)}
        onSuccess={() => setShowWaiting(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* D8: 手動起動時 pending バナー */}
      {pendingBanner && (
        <TouchableOpacity style={styles.banner} onPress={onBannerTapped} activeOpacity={0.85}>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerIcon}>🔔</Text>
            <View style={styles.bannerText}>
              <Text style={styles.bannerTitle}>ログインリクエストがあります</Text>
              <Text style={styles.bannerSub}>{pendingBanner.username} としての承認が保留中</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onBannerDismissed} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.bannerClose}>×</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <Text style={styles.title}>Passkey PoC</Text>
      <Text style={styles.subtitle}>パスキー認証デモ</Text>

      <TextInput
        style={styles.input}
        placeholder="ユーザー名"
        value={username}
        onChangeText={setUsername}
        onBlur={handleUsernameBlur}
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
        onPress={() => authenticate(username || undefined)}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>パスキーでサインイン</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.waitingButton, loading && styles.disabled]}
        onPress={() => setShowWaiting(true)}
        disabled={loading || !username.trim()}
      >
        <Text style={styles.buttonText}>カメラで QR 認証を待機</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.crossDeviceButton, loading && styles.disabled]}
        onPress={() => setShowScanner(true)}
        disabled={loading}
      >
        <Text style={styles.buttonText}>QR でサインイン（アプリ内カメラ）</Text>
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
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FF9500',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 10,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  bannerIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  bannerSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    marginTop: 2,
  },
  bannerClose: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '300',
    paddingLeft: 12,
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
  secondaryButton: {
    backgroundColor: '#34C759',
  },
  waitingButton: {
    backgroundColor: '#FF9500',
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
