// WebAuthn JSON 型（@simplewebauthn/browser との互換形式）
export type RegistrationOptionsJSON = Record<string, unknown>;
export type AuthenticationOptionsJSON = Record<string, unknown>;
export type RegistrationResponseJSON = Record<string, unknown>;
export type AuthenticationResponseJSON = Record<string, unknown>;

async function post<T>(url: string, body: unknown): Promise<T> {
  console.log('[POST]', url, JSON.stringify(body));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log('[POST response]', url, res.status);
    if (!res.ok) {
      const err = await res.json();
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    console.error('[POST failed]', url, err);
    throw err;
  }
}

export function registrationBegin(
  baseUrl: string,
  username: string,
): Promise<RegistrationOptionsJSON> {
  return post(`${baseUrl}/registration/begin`, { username });
}

export function registrationComplete(
  baseUrl: string,
  username: string,
  credential: RegistrationResponseJSON,
): Promise<boolean> {
  return post<{ verified: boolean }>(`${baseUrl}/registration/complete`, {
    username,
    credential,
  }).then((r) => r.verified);
}

export function authenticationBegin(
  baseUrl: string,
  username: string,
): Promise<AuthenticationOptionsJSON> {
  return post(`${baseUrl}/authentication/begin`, { username });
}

export function authenticationComplete(
  baseUrl: string,
  username: string,
  credential: AuthenticationResponseJSON,
): Promise<boolean> {
  return post<{ verified: boolean }>(`${baseUrl}/authentication/complete`, {
    username,
    credential,
  }).then((r) => r.verified);
}
