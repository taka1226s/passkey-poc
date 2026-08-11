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
import { AuthScreen } from './AuthScreen';
import { CredentialsScreen } from './CredentialsScreen';
import { BASE_URL } from '../config';
import { registerForPushNotifications } from '../utils/notifications';
import { authLogout } from '../api/webauthnClient';

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
  const [showAuth, setShowAuth] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  // ID/PASS ログイン、またはパスワードレスのパスキーログイン(no-push分岐)で得た
  // ログインセッション。永続化なし(アプリ再起動で消える。既存のtoken管理と同じ制約)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
  const { register, authenticate, loading, status } = usePasskey(BASE_URL);

  useEffect(() => {
    registerForPushNotifications().catch(() => {});
  }, []);

  // パスワードレスのパスキーログイン成功時、no-push分岐ならauthTokenが返るのでログイン状態にする
  useEffect(() => {
    if (status.type === 'success' && status.authToken) {
      setAuthToken(status.authToken);
      setLoggedInUsername(username.trim() || loggedInUsername || '(usernameless)');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // H1: push token のサーバー登録は passkey 登録後に deviceToken と一緒に行う
  // blur 時は通知権限のリクエストのみ
  const handleUsernameBlur = useCallback(() => {
    if (!username.trim()) return;
    registerForPushNotifications().catch(() => {});
  }, [username]);

  const handleLogout = useCallback(async () => {
    if (authToken) {
      await authLogout(BASE_URL, authToken).catch(() => {});
    }
    setAuthToken(null);
    setLoggedInUsername(null);
  }, [authToken]);

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

  if (showAuth) {
    return (
      <AuthScreen
        onClose={() => setShowAuth(false)}
        onLoggedIn={(loggedInUser, token) => {
          setAuthToken(token);
          setLoggedInUsername(loggedInUser);
          setUsername(loggedInUser);
          setShowAuth(false);
        }}
      />
    );
  }

  if (showCredentials && authToken) {
    return <CredentialsScreen authToken={authToken} onClose={() => setShowCredentials(false)} />;
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

      {authToken && loggedInUsername ? (
        <View style={styles.loginStatusBox}>
          <Text style={styles.loginStatusText}>{loggedInUsername} としてログイン中</Text>
          <View style={styles.loginStatusButtons}>
            <TouchableOpacity onPress={() => setShowCredentials(true)}>
              <Text style={styles.loginStatusLink}>認証情報を管理</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout}>
              <Text style={styles.loginStatusLink}>ログアウト</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.loginPromptButton} onPress={() => setShowAuth(true)}>
          <Text style={styles.loginPromptText}>ID/PASSでログイン・新規登録</Text>
        </TouchableOpacity>
      )}

      <TextInput
        style={styles.input}
        placeholder="ユーザー名"
        value={username}
        onChangeText={setUsername}
        onBlur={handleUsernameBlur}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading && !authToken}
      />

      <TouchableOpacity
        style={[styles.button, styles.primaryButton, loading && styles.disabled]}
        onPress={() => {
          if (!authToken || !loggedInUsername) {
            setShowAuth(true);
            return;
          }
          register(loggedInUsername, authToken);
        }}
        disabled={loading || (!authToken && !username.trim())}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {authToken ? 'パスキーを追加登録' : 'パスキーを登録（ログインが必要です）'}
          </Text>
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
  loginStatusBox: {
    width: '100%',
    backgroundColor: '#e8f4ff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  loginStatusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 6,
  },
  loginStatusButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  loginStatusLink: {
    fontSize: 13,
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  loginPromptButton: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
    marginBottom: 16,
  },
  loginPromptText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
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
