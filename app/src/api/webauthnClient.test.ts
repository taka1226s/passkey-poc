/**
 * @jest-environment node
 */
import {
  registrationBegin,
  registrationComplete,
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

  it('サーバーエラー時に Error をスロー', async () => {
    mockFetch({ error: 'username は必須です' }, 400);
    await expect(registrationBegin(BASE_URL, '')).rejects.toThrow();
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
  it('POST /registration/complete を呼び出して verified を返す', async () => {
    mockFetch({ verified: true });
    const result = await registrationComplete(BASE_URL, 'test-user', {} as never, 'session-id');
    expect(result).toBe(true);
  });
});

describe('authenticationComplete', () => {
  it('POST /authentication/complete を呼び出して approvalId を返す', async () => {
    mockFetch({ approvalId: 'appr-id', code: 42 });
    const result = await authenticationComplete(BASE_URL, {} as never, 'session-id');
    expect(result).toEqual({ approvalId: 'appr-id', code: 42 });
  });
});
