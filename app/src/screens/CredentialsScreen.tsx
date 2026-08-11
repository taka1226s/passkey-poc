import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  FlatList,
  Alert,
} from 'react-native';
import { listCredentials, deleteCredential, type CredentialSummary } from '../api/webauthnClient';
import { BASE_URL } from '../config';

type Props = {
  authToken: string;
  onClose: () => void;
};

export function CredentialsScreen({ authToken, onClose }: Props) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCredentials(await listCredentials(BASE_URL, authToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = (credentialId: string) => {
    Alert.alert('パスキーを削除', 'このパスキーを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCredential(BASE_URL, authToken, credentialId);
            load();
          } catch (err) {
            Alert.alert('削除エラー', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>登録済みパスキー</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loading} />
      ) : error !== '' ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          style={styles.list}
          data={credentials}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.emptyText}>まだパスキーが登録されていません</Text>}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemId} numberOfLines={1}>
                  {item.id.slice(0, 24)}...
                </Text>
                <Text style={styles.itemMeta}>
                  {item.backedUp ? '同期済み' : '端末固有'} / {item.deviceType}
                </Text>
              </View>
              <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item.id)}>
                <Text style={styles.deleteButtonText}>削除</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeButtonText}>閉じる</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  loading: {
    marginTop: 32,
  },
  errorText: {
    color: '#a00',
    fontSize: 14,
    marginTop: 16,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    marginTop: 32,
    textAlign: 'center',
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemId: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#333',
  },
  itemMeta: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  deleteButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#f8d7da',
  },
  deleteButtonText: {
    color: '#a00',
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#e5e5ea',
    marginTop: 12,
  },
  closeButtonText: {
    fontSize: 16,
    color: '#333',
  },
});
