import { useState } from 'react';
import { Passkey } from 'react-native-passkey';
import {
  registrationBegin,
  registrationComplete,
  authenticationBegin,
  authenticationComplete,
} from '../api/webauthnClient';

export type Status = {
  type: 'idle' | 'success' | 'error';
  message: string;
};

type UsePasskeyResult = {
  register: (username: string) => Promise<void>;
  authenticate: (username: string) => Promise<void>;
  loading: boolean;
  status: Status;
};

const IDLE: Status = { type: 'idle', message: '' };

// コアロジック（テスト可能な純粋非同期関数）
export async function runRegistration(
  baseUrl: string,
  username: string,
): Promise<Status> {
  const rawOptions = await registrationBegin(baseUrl, username);
  // hints / extensions は一部の Credential Manager バージョンで解析エラーになるため除外
  const { hints: _hints, extensions: _ext, ...options } = rawOptions as Record<string, unknown>;
  console.log('[Passkey.create options]', JSON.stringify(options, null, 2));
  const credential = await Passkey.create(options as never);
  const verified = await registrationComplete(baseUrl, username, credential as never);
  return verified
    ? { type: 'success', message: '登録が完了しました' }
    : { type: 'error', message: '登録の検証に失敗しました' };
}

export async function runAuthentication(
  baseUrl: string,
  username: string,
): Promise<Status> {
  const options = await authenticationBegin(baseUrl, username);
  const credential = await Passkey.get(options as never);
  const verified = await authenticationComplete(baseUrl, username, credential as never);
  return verified
    ? { type: 'success', message: '認証が完了しました' }
    : { type: 'error', message: '認証に失敗しました' };
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
      console.error('[register error]', JSON.stringify(err));
      console.error('[register error keys]', err !== null && typeof err === 'object' ? Object.keys(err) : typeof err);
      console.error('[register error full]', err instanceof Error ? { message: err.message, name: err.name, stack: err.stack } : err);
      const message = err instanceof Error ? `登録エラー: ${err.message}` : `登録エラー: ${String(err)}`;
      setStatus({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const authenticate = async (username: string): Promise<void> => {
    setLoading(true);
    setStatus(IDLE);
    try {
      setStatus(await runAuthentication(baseUrl, username));
    } catch (err) {
      console.error('[authenticate error]', err);
      const message = err instanceof Error ? `認証エラー: ${err.message}` : `認証エラー: ${String(err)}`;
      setStatus({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  return { register, authenticate, loading, status };
}
