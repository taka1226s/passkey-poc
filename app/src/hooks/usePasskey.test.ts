/**
 * @jest-environment node
 *
 * runRegistration / runAuthentication の純粋ロジックをテストする。
 * React フック（useState）に依存しないため node 環境で実行可能。
 */
import { runRegistration, runAuthentication } from './usePasskey';

jest.mock('react-native-passkey', () => ({
  Passkey: {
    create: jest.fn(),
    get: jest.fn(),
    isSupported: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('../api/webauthnClient', () => ({
  registrationBegin: jest.fn(),
  registrationComplete: jest.fn(),
  registrationAuthorize: jest.fn(),
  authenticationBegin: jest.fn(),
  authenticationComplete: jest.fn(),
}));

jest.mock('../utils/notifications', () => ({
  registerForPushNotifications: jest.fn().mockResolvedValue(null),
  savePushTokenToServer: jest.fn().mockResolvedValue(undefined),
}));

import { Passkey } from 'react-native-passkey';
import * as webauthnClient from '../api/webauthnClient';

const BASE_URL = 'http://localhost:3000';

describe('runRegistration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('成功時に success ステータスを返す', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockResolvedValue({ challenge: 'abc', sessionId: 'sid' });
    (Passkey.create as jest.Mock).mockResolvedValue({ id: 'cred-id', type: 'public-key' });
    (webauthnClient.registrationComplete as jest.Mock).mockResolvedValue({ verified: true, deviceToken: 'dt-xxx' });

    const status = await runRegistration(BASE_URL, 'test-user');

    expect(status.type).toBe('success');
    expect(status.message).toContain('登録');
  });

  it('verified=false のとき error ステータスを返す', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockResolvedValue({ challenge: 'abc', sessionId: 'sid' });
    (Passkey.create as jest.Mock).mockResolvedValue({ id: 'cred-id' });
    (webauthnClient.registrationComplete as jest.Mock).mockResolvedValue({ verified: false });

    const status = await runRegistration(BASE_URL, 'test-user');

    expect(status.type).toBe('error');
  });

  it('registrationBegin が失敗したとき例外をスロー', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockRejectedValue(new Error('サーバーエラー'));

    await expect(runRegistration(BASE_URL, 'test-user')).rejects.toThrow('サーバーエラー');
  });

  it('requiresReauth のとき再認証フローを経て登録を完了する', async () => {
    const reauthError = Object.assign(new Error('再認証が必要です'), { requiresReauth: true });
    (webauthnClient.registrationBegin as jest.Mock)
      .mockRejectedValueOnce(reauthError)
      .mockResolvedValueOnce({ challenge: 'abc', sessionId: 'reg-sid' });
    (webauthnClient.authenticationBegin as jest.Mock).mockResolvedValue({ challenge: 'xyz', sessionId: 'auth-sid' });
    (Passkey.get as jest.Mock).mockResolvedValue({ id: 'existing-cred', type: 'public-key' });
    (webauthnClient.registrationAuthorize as jest.Mock).mockResolvedValue({ registrationToken: 'reg-token' });
    (Passkey.create as jest.Mock).mockResolvedValue({ id: 'new-cred', type: 'public-key' });
    (webauthnClient.registrationComplete as jest.Mock).mockResolvedValue({ verified: true, deviceToken: 'dt-xxx' });

    const status = await runRegistration(BASE_URL, 'existing-user');

    expect(status.type).toBe('success');
    expect(webauthnClient.registrationAuthorize).toHaveBeenCalledWith(BASE_URL, expect.any(Object), 'auth-sid');
    expect(webauthnClient.registrationBegin).toHaveBeenCalledTimes(2);
    expect(webauthnClient.registrationBegin).toHaveBeenLastCalledWith(BASE_URL, 'existing-user', 'reg-token');
  });

  it('Passkey.create がキャンセルされたとき例外をスロー', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockResolvedValue({ challenge: 'abc', sessionId: 'sid' });
    (Passkey.create as jest.Mock).mockRejectedValue(new Error('UserCanceled'));

    await expect(runRegistration(BASE_URL, 'test-user')).rejects.toThrow('UserCanceled');
  });
});

describe('runAuthentication', () => {
  beforeEach(() => jest.clearAllMocks());

  it('成功時に success ステータスを返す', async () => {
    (webauthnClient.authenticationBegin as jest.Mock).mockResolvedValue({ challenge: 'xyz', sessionId: 'sid' });
    (Passkey.get as jest.Mock).mockResolvedValue({ id: 'cred-id', type: 'public-key' });
    (webauthnClient.authenticationComplete as jest.Mock).mockResolvedValue({ approvalId: 'appr-id', code: 42 });

    const status = await runAuthentication(BASE_URL, 'test-user');

    expect(status.type).toBe('success');
    expect(status.message).toContain('認証');
  });

  it('verified=true（直接モード）のとき success ステータスを返す', async () => {
    (webauthnClient.authenticationBegin as jest.Mock).mockResolvedValue({ challenge: 'xyz', sessionId: 'sid' });
    (Passkey.get as jest.Mock).mockResolvedValue({ id: 'cred-id' });
    (webauthnClient.authenticationComplete as jest.Mock).mockResolvedValue({ verified: true });

    const status = await runAuthentication(BASE_URL, 'test-user');

    expect(status.type).toBe('success');
    expect(status.message).toContain('クロスデバイス');
  });

  it('approvalId も verified もないとき error ステータスを返す', async () => {
    (webauthnClient.authenticationBegin as jest.Mock).mockResolvedValue({ challenge: 'xyz', sessionId: 'sid' });
    (Passkey.get as jest.Mock).mockResolvedValue({ id: 'cred-id' });
    (webauthnClient.authenticationComplete as jest.Mock).mockResolvedValue({});

    const status = await runAuthentication(BASE_URL, 'test-user');

    expect(status.type).toBe('error');
  });

  it('authenticationBegin が失敗したとき例外をスロー', async () => {
    (webauthnClient.authenticationBegin as jest.Mock).mockRejectedValue(new Error('認証に失敗しました'));

    await expect(runAuthentication(BASE_URL, 'test-user')).rejects.toThrow();
  });
});
