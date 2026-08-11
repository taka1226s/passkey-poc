import { useState } from 'react';
import { Passkey } from 'react-native-passkey';
import {
  registrationBegin,
  registrationComplete,
  registrationAuthorize,
  authenticationBegin,
  authenticationComplete,
} from '../api/webauthnClient';
import { registerForPushNotifications, savePushTokenToServer } from '../utils/notifications';

export type Status = {
  type: 'idle' | 'success' | 'error';
  message: string;
  authToken?: string;
};

type UsePasskeyResult = {
  register: (username: string, authToken?: string) => Promise<void>;
  authenticate: (username?: string) => Promise<void>;
  loading: boolean;
  status: Status;
};

const IDLE: Status = { type: 'idle', message: '' };

export async function runRegistration(
  baseUrl: string,
  username: string,
  authToken?: string,
): Promise<Status> {
  let sessionId: string;
  let options: Record<string, unknown>;

  try {
    const raw = await registrationBegin(baseUrl, username, undefined, authToken);
    const { hints: _h, extensions: _e, sessionId: sid, ...opts } = raw as Record<string, unknown> & { sessionId: string };
    sessionId = sid;
    options = opts;
  } catch (err: unknown) {
    // C-1: 既存ユーザーへの追加登録 → 既存 credential で再認証して registrationToken を取得
    if (err instanceof Error && (err as Error & { requiresReauth?: boolean }).requiresReauth) {
      const authRaw = await authenticationBegin(baseUrl, username);
      const { sessionId: authSid, ...authOpts } = authRaw as Record<string, unknown> & { sessionId: string };
      const authCredential = await Passkey.get(authOpts as never);
      const { registrationToken } = await registrationAuthorize(baseUrl, authCredential as never, authSid);
      const raw = await registrationBegin(baseUrl, username, registrationToken);
      const { hints: _h, extensions: _e, sessionId: sid, ...opts } = raw as Record<string, unknown> & { sessionId: string };
      sessionId = sid;
      options = opts;
    } else {
      throw err;
    }
  }

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
    // push-approval分岐: セキュリティ上の理由によりここではauthTokenを発行しない
    // （詳細はdocs/design参照）。ログイン状態が必要な操作にはID/PASSログインを使う
    return { type: 'success', message: '認証完了。スマートフォンアプリで承認してください' };
  }
  if (result.verified) {
    return {
      type: 'success',
      message: 'クロスデバイス認証が完了しました',
      authToken: result.authToken,
    };
  }
  return { type: 'error', message: '認証に失敗しました' };
}

export function usePasskey(baseUrl: string): UsePasskeyResult {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);

  const register = async (username: string, authToken?: string): Promise<void> => {
    setLoading(true);
    setStatus(IDLE);
    try {
      setStatus(await runRegistration(baseUrl, username, authToken));
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
