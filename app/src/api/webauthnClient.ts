export type RegistrationOptionsJSON = Record<string, unknown> & { sessionId: string };
export type AuthenticationOptionsJSON = Record<string, unknown> & { sessionId: string };
export type RegistrationResponseJSON = Record<string, unknown>;
export type AuthenticationResponseJSON = Record<string, unknown>;
export type AuthenticationCompleteResult = { approvalId: string; code: number };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
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
  sessionId: string,
): Promise<boolean> {
  return post<{ verified: boolean }>(`${baseUrl}/registration/complete`, {
    username,
    credential,
    sessionId,
  }).then((r) => r.verified);
}

export function authenticationBegin(
  baseUrl: string,
  username?: string,
): Promise<AuthenticationOptionsJSON> {
  return post(`${baseUrl}/authentication/begin`, { username });
}

export function authenticationComplete(
  baseUrl: string,
  credential: AuthenticationResponseJSON,
  sessionId: string,
): Promise<AuthenticationCompleteResult> {
  return post(`${baseUrl}/authentication/complete`, { credential, sessionId });
}
