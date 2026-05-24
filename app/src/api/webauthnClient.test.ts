/**
 * @jest-environment node
 */
import {
  registrationBegin,
  registrationComplete,
  registrationAuthorize,
  authenticationBegin,
  authenticationComplete,
} from './webauthnClient';

const BASE_URL = 'http://localhost:3000';

global.fetch = jest.fn();

function mockFetch(data: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

describe('registrationBegin', () => {
  it('POST /registration/begin を呼び出して options を返す', async () => {
    const mockOptions = { challenge: 'abc', rp: { id: 'localhost' }, user: {} };
    mockFetch(mockOptions);

    const result = await registrationBegin(BASE_URL, 'test-user');

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/registration/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ username: 'test-user' }),
    });
    expect(result).toEqual(mockOptions);
  });

  it('registrationToken 付きの場合 body に含める', async () => {
    mockFetch({ challenge: 'abc', sessionId: 'sid' });
    await registrationBegin(BASE_URL, 'test-user', 'some-reg-token');
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/registration/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ username: 'test-user', registrationToken: 'some-reg-token' }),
    });
  });

  it('403 requiresReauth のとき requiresReauth プロパティ付きエラーをスロー', async () => {
    mockFetch({ error: '再認証が必要です', requiresReauth: true }, 403);
    let caught: unknown;
    try {
      await registrationBegin(BASE_URL, 'existing-user');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { requiresReauth?: boolean }).requiresReauth).toBe(true);
  });

  it('サーバーエラー時に Error をスロー', async () => {
    mockFetch({ error: 'username は必須です' }, 400);
    await expect(registrationBegin(BASE_URL, '')).rejects.toThrow();
  });
});

describe('registrationAuthorize', () => {
  it('POST /registration/authorize を呼び出して registrationToken を返す', async () => {
    mockFetch({ registrationToken: 'reg-token-xxx' });
    const result = await registrationAuthorize(BASE_URL, {} as never, 'session-id');
    expect(result.registrationToken).toBe('reg-token-xxx');
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/registration/authorize`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ credential: {}, sessionId: 'session-id' }),
    }));
  });
});

describe('authenticationBegin', () => {
  it('POST /authentication/begin を呼び出して options を返す', async () => {
    const mockOptions = { challenge: 'xyz', rpId: 'localhost' };
    mockFetch(mockOptions);

    const result = await authenticationBegin(BASE_URL, 'test-user');

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/authentication/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ username: 'test-user' }),
    });
    expect(result).toEqual(mockOptions);
  });

  it('404 時に Error をスロー', async () => {
    mockFetch({ error: 'ユーザーが見つかりません' }, 404);
    await expect(authenticationBegin(BASE_URL, 'no-user')).rejects.toThrow();
  });
});

describe('registrationComplete', () => {
  it('POST /registration/complete を呼び出して verified と deviceToken を返す', async () => {
    mockFetch({ verified: true, deviceToken: 'dt-xxx' });
    const result = await registrationComplete(BASE_URL, 'test-user', {} as never, 'session-id');
    expect(result.verified).toBe(true);
    expect(result.deviceToken).toBe('dt-xxx');
  });
});

describe('authenticationComplete', () => {
  it('POST /authentication/complete を呼び出して approvalId を返す', async () => {
    mockFetch({ approvalId: 'appr-id', code: 42 });
    const result = await authenticationComplete(BASE_URL, {} as never, 'session-id');
    expect(result).toEqual({ approvalId: 'appr-id', code: 42 });
  });
});
