import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { BASE_URL } from '../config';

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[notifications] 通知権限が拒否されました');
    return null;
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    if (__DEV__) console.log('[notifications] Expo Push Token 取得成功:', tokenData.data.slice(0, 20) + '...');
    return tokenData.data;
  } catch (err) {
    console.error('[notifications] Expo Push Token 取得失敗:', err);
    return null;
  }
}

// deviceToken: passkey 登録・承認後にサーバーから発行される認証トークン（H1）
export async function savePushTokenToServer(
  username: string,
  token: string,
  deviceToken: string,
): Promise<void> {
  console.log('[notifications] サーバーにトークン登録:', username);
  const res = await fetch(`${BASE_URL}/push-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ username, token, deviceToken }),
  });
  const body = await res.json();
  console.log('[notifications] トークン登録レスポンス:', body);
}
