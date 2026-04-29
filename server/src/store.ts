import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/server';

export type UserRecord = {
  id: Uint8Array<ArrayBuffer>;
  username: string;
  currentChallenge?: string;
  credentials: CredentialRecord[];
};

export type CredentialRecord = {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[];
};

const users = new Map<string, UserRecord>();

export const store = {
  getUser(username: string): UserRecord | undefined {
    return users.get(username);
  },

  getOrCreateUser(username: string): UserRecord {
    if (!users.has(username)) {
      users.set(username, {
        id: Buffer.from(username) as unknown as Uint8Array<ArrayBuffer>,
        username,
        credentials: [],
      });
    }
    return users.get(username)!;
  },

  setChallenge(username: string, challenge: string): void {
    const user = users.get(username);
    if (user) user.currentChallenge = challenge;
  },

  addCredential(username: string, credential: CredentialRecord): void {
    const user = users.get(username);
    if (user) user.credentials.push(credential);
  },

  updateCounter(username: string, credentialId: string, counter: number): void {
    const user = users.get(username);
    if (!user) return;
    const cred = user.credentials.find((c) => c.id === credentialId);
    if (cred) cred.counter = counter;
  },
};
