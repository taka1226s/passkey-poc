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
  authenticationBegin: jest.fn(),
  authenticationComplete: jest.fn(),
}));

import { Passkey } from 'react-native-passkey';
import * as webauthnClient from '../api/webauthnClient';

const BASE_URL = 'http://localhost:3000';

describe('runRegistration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('成功時に success ステータスを返す', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockResolvedValue({ challenge: 'abc', sessionId: 'sid' });
    (Passkey.create as jest.Mock).mockResolvedValue({ id: 'cred-id', type: 'public-key' });
    (webauthnClient.registrationComplete as jest.Mock).mockResolvedValue(true);

    const status = await runRegistration(BASE_URL, 'test-user');

    expect(status.type).toBe('success');
    expect(status.message).toContain('登録');
  });

  it('verified=false のとき error ステータスを返す', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockResolvedValue({ challenge: 'abc', sessionId: 'sid' });
    (Passkey.create as jest.Mock).mockResolvedValue({ id: 'cred-id' });
    (webauthnClient.registrationComplete as jest.Mock).mockResolvedValue(false);

    const status = await runRegistration(BASE_URL, 'test-user');

    expect(status.type).toBe('error');
  });

  it('registrationBegin が失敗したとき例外をスロー', async () => {
    (webauthnClient.registrationBegin as jest.Mock).mockRejectedValue(new Error('サーバーエラー'));
    // sessionId がモックで返らない場合でも例外を正しく伝播する

    await expect(runRegistration(BASE_URL, 'test-user')).rejects.toThrow('サーバーエラー');
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

  it('approvalId なしのとき error ステータスを返す', async () => {
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
