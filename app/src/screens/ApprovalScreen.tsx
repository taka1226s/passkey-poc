import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { BASE_URL } from '../config';

type Props = {
  approvalId: string;
  username: string;
  sessionToken: string;
  onDone: () => void;
};

type ApprovalInfo = {
  choices: number[];
  ipAddress?: string;
  userAgent?: string;
  createdAt: number;
};

const TIMEOUT_SEC = 5 * 60;

export function ApprovalScreen({ approvalId, username, sessionToken, onDone }: Props) {
  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(TIMEOUT_SEC);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/authentication/approval-info?approvalId=${encodeURIComponent(approvalId)}&sessionToken=${encodeURIComponent(sessionToken)}`,
          { headers: { 'ngrok-skip-browser-warning': 'true' } },
        );
        if (cancelled) return;
        if (!res.ok) {
          const { error } = await res.json();
          setFetchError(error ?? '取得失敗');
          return;
        }
        const data = await res.json();
        setInfo(data);
        const elapsed = Math.floor((Date.now() - data.createdAt) / 1000);
        setRemaining(Math.max(0, TIMEOUT_SEC - elapsed));
      } catch {
        if (!cancelled) setFetchError('サーバーへの接続に失敗しました');
      }
    })();
    return () => { cancelled = true; };
  }, [approvalId, sessionToken]);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(id); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  async function handleApprove(selected: number) {
    const bio = await LocalAuthentication.authenticateAsync({
      promptMessage: 'ログインを承認するために生体認証を行います',
      cancelLabel: 'キャンセル',
    });
    if (!bio.success) return;

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/authentication/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ approvalId, sessionToken, selectedCode: selected }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        Alert.alert('エラー', error ?? '承認に失敗しました');
        return;
      }
    } catch {
      Alert.alert('エラー', 'サーバーへの接続に失敗しました');
      return;
    } finally {
      setLoading(false);
    }
    onDone();
  }

  async function handleReject(isNotMe: boolean) {
    const msg = isNotMe
      ? '不正なログイン試行として記録されます。拒否しますか？'
      : 'このログインリクエストを拒否しますか？';
    Alert.alert(isNotMe ? '不正アクセスの疑い' : 'ログインを拒否', msg, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '拒否する',
        style: 'destructive',
        onPress: async () => {
          setLoading(true);
          try {
            await fetch(`${BASE_URL}/authentication/reject`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
              },
              body: JSON.stringify({ approvalId, sessionToken }),
            });
          } catch {
            Alert.alert('エラー', 'サーバーへの接続に失敗しました');
          } finally {
            setLoading(false);
          }
          if (isNotMe) {
            Alert.alert(
              'セキュリティアラート',
              'パスワードの変更と、登録済みパスキーの確認をお勧めします。',
              [{ text: 'OK', onPress: onDone }],
            );
          } else {
            onDone();
          }
        },
      },
    ]);
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timerText = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const timerWarning = remaining <= 60;

  if (fetchError) {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>❌</Text>
        <Text style={styles.title}>取得エラー</Text>
        <Text style={styles.errorText}>{fetchError}</Text>
        <TouchableOpacity style={[styles.button, styles.rejectButton]} onPress={onDone}>
          <Text style={styles.buttonText}>閉じる</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!info) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>リクエスト情報を取得中...</Text>
      </View>
    );
  }

  if (remaining === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>⏱</Text>
        <Text style={styles.title}>タイムアウト</Text>
        <Text style={styles.description}>承認期限が切れました。</Text>
        <TouchableOpacity style={[styles.button, styles.rejectButton]} onPress={onDone}>
          <Text style={styles.buttonText}>閉じる</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.icon}>🔐</Text>
      <Text style={styles.title}>ログインリクエスト</Text>

      <Text style={[styles.timer, timerWarning && styles.timerWarning]}>{timerText}</Text>

      <View style={styles.contextBox}>
        <Text style={styles.contextTitle}>リクエスト元</Text>
        {info.ipAddress && (
          <Text style={styles.contextItem}>IP: {info.ipAddress}</Text>
        )}
        {info.userAgent && (
          <Text style={styles.contextItem} numberOfLines={2}>
            {formatUserAgent(info.userAgent)}
          </Text>
        )}
        <Text style={styles.contextItem}>
          {new Date(info.createdAt).toLocaleString('ja-JP')}
        </Text>
      </View>

      <Text style={styles.matchInstruction}>
        ブラウザに表示されている数字を選んでください
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={{ marginVertical: 32 }} />
      ) : (
        <View style={styles.choiceRow}>
          {info.choices.map((choice) => (
            <TouchableOpacity
              key={choice}
              style={styles.choiceButton}
              onPress={() => handleApprove(choice)}
            >
              <Text style={styles.choiceText}>{choice}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.rejectRow}>
        <TouchableOpacity
          style={styles.rejectLink}
          onPress={() => handleReject(false)}
          disabled={loading}
        >
          <Text style={styles.rejectLinkText}>拒否する</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rejectLink}
          onPress={() => handleReject(true)}
          disabled={loading}
        >
          <Text style={[styles.rejectLinkText, styles.notMeText]}>これは私ではない</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function formatUserAgent(ua: string): string {
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const safari = ua.match(/Safari\/([\d.]+)/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const windows = ua.includes('Windows');
  const mac = ua.includes('Macintosh');
  const linux = ua.includes('Linux');

  const browser = chrome ? `Chrome ${chrome[1]}` : firefox ? `Firefox ${firefox[1]}` : safari ? 'Safari' : 'ブラウザ不明';
  const os = windows ? 'Windows' : mac ? 'macOS' : linux ? 'Linux' : 'OS不明';
  return `${browser} / ${os}`;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  icon: {
    fontSize: 56,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  timer: {
    fontSize: 20,
    fontWeight: '600',
    color: '#666',
    marginBottom: 20,
    fontVariant: ['tabular-nums'],
  },
  timerWarning: {
    color: '#FF3B30',
  },
  contextBox: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  contextTitle: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contextItem: {
    fontSize: 13,
    color: '#444',
    marginBottom: 4,
  },
  matchInstruction: {
    fontSize: 15,
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  choiceButton: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  choiceText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  rejectRow: {
    flexDirection: 'row',
    gap: 24,
  },
  rejectLink: {
    padding: 8,
  },
  rejectLinkText: {
    color: '#888',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  notMeText: {
    color: '#FF3B30',
  },
  button: {
    width: '100%',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  rejectButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  description: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    marginBottom: 16,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#666',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
});
