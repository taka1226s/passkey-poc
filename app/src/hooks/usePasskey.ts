import { useState } from 'react';
import { Passkey } from 'react-native-passkey';
import {
  registrationBegin,
  registrationComplete,
  authenticationBegin,
  authenticationComplete,
} from '../api/webauthnClient';
import { registerForPushNotifications, savePushTokenToServer } from '../utils/notifications';

export type Status = {
  type: 'idle' | 'success' | 'error';
  message: string;
};

type UsePasskeyResult = {
  register: (username: string) => Promise<void>;
  authenticate: (username?: string) => Promise<void>;
  loading: boolean;
  status: Status;
};

const IDLE: Status = { type: 'idle', message: '' };

export async function runRegistration(
  baseUrl: string,
  username: string,
): Promise<Status> {
  const rawOptions = await registrationBegin(baseUrl, username);
  const { hints: _hints, extensions: _ext, sessionId, ...options } = rawOptions as Record<string, unknown> & { sessionId: string };
  const credential = await Passkey.create(options as never);
  const result = await registrationComplete(baseUrl, username, credential as never, sessionId);
  if (!result.verified) {
    return { type: 'error', message: '登録の検証に失敗しました' };
  }
  // H1: 登録直後に発行された deviceToken で push token を認証付き登録
  if (result.deviceToken) {
    const pushToken = await registerForPushNotifications();
    if (pushToken) {
      await savePushTokenToServer(username, pushToken, result.deviceToken).catch(() => {});
    }
  }
  return { type: 'success', message: '登録が完了しました' };
}

export async function runAuthentication(
  baseUrl: string,
  username?: string,
): Promise<Status> {
  const rawOptions = await authenticationBegin(baseUrl, username);
  const { sessionId, ...options } = rawOptions as Record<string, unknown> & { sessionId: string };
  const credential = await Passkey.get(options as never);
  const result = await authenticationComplete(baseUrl, credential as never, sessionId);
  if (result.approvalId) {
    return { type: 'success', message: '認証完了。スマートフォンアプリで承認してください' };
  }
  if (result.verified) {
    return { type: 'success', message: 'クロスデバイス認証が完了しました' };
  }
  return { type: 'error', message: '認証に失敗しました' };
}

export function usePasskey(baseUrl: string): UsePasskeyResult {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);

  const register = async (username: string): Promise<void> => {
    setLoading(true);
    setStatus(IDLE);
    try {
      setStatus(await runRegistration(baseUrl, username));
    } catch (err) {
      const message = err instanceof Error ? `登録エラー: ${err.message}` : `登録エラー: ${String(err)}`;
      setStatus({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const authenticate = async (username?: string): Promise<void> => {
    setLoading(true);
    setStatus(IDLE);
    try {
      setStatus(await runAuthentication(baseUrl, username));
    } catch (err) {
      const message = err instanceof Error ? `認証エラー: ${err.message}` : `認証エラー: ${String(err)}`;
      setStatus({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  return { register, authenticate, loading, status };
}
