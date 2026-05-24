import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/server';
import { randomUUID, randomBytes } from 'crypto';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type PendingApproval = {
  id: string;
  username: string;
  status: ApprovalStatus;
  createdAt: number;
  pushToken?: string;
  code: number;
  choices: number[];
  sessionToken: string;
  failedAttempts: number;
  ipAddress?: string;
  userAgent?: string;
};

export type ChallengeSession = {
  challenge: string;
  username?: string;
  expiresAt: number;
};

export type UserRecord = {
  id: Uint8Array<ArrayBuffer>;
  username: string;
  credentials: CredentialRecord[];
  lastAuthenticatedAt?: number;
  pushToken?: string;
};

export type CredentialRecord = {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[];
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEVICE_TOKEN_TTL_MS = 15 * 60 * 1000;

const users = new Map<string, UserRecord>();
const approvals = new Map<string, PendingApproval>();
const challengeSessions = new Map<string, ChallengeSession>();
const deviceTokens = new Map<string, { username: string; expiresAt: number }>();

// 剰余バイアスなしの一様乱数 [0, max)
function secureRandInt(max: number): number {
  const limit = 256 - (256 % max);
  while (true) {
    const byte = randomBytes(1)[0]!;
    if (byte < limit) return byte % max;
  }
}

// rejection sampling で 10-99 の一様乱数
function generateCode(): number {
  while (true) {
    const byte = randomBytes(1)[0]!;
    if (byte < 90) return 10 + byte;
  }
}

// Fisher-Yates シャッフルで 3 択を生成
function generateChoices(correct: number): number[] {
  const choices: number[] = [correct];
  while (choices.length < 3) {
    const c = generateCode();
    if (!choices.includes(c)) choices.push(c);
  }
  for (let i = choices.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return choices;
}

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export const store = {
  getUser(username: string): UserRecord | undefined {
    return users.get(username);
  },

  getOrCreateUser(username: string): UserRecord {
    if (!users.has(username)) {
      users.set(username, {
        id: new Uint8Array(randomBytes(16)) as unknown as Uint8Array<ArrayBuffer>,
        username,
        credentials: [],
      });
    }
    return users.get(username)!;
  },

  getUserByCredentialId(credentialId: string): UserRecord | undefined {
    for (const user of users.values()) {
      if (user.credentials.some((c) => c.id === credentialId)) return user;
    }
    return undefined;
  },

  createChallengeSession(challenge: string, username?: string): string {
    const id = randomUUID();
    challengeSessions.set(id, {
      challenge,
      username,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return id;
  },

  getChallengeSession(id: string): ChallengeSession | undefined {
    const session = challengeSessions.get(id);
    if (!session) return undefined;
    if (Date.now() > session.expiresAt) {
      challengeSessions.delete(id);
      return undefined;
    }
    return session;
  },

  deleteChallengeSession(id: string): void {
    challengeSessions.delete(id);
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

  recordAuthentication(username: string): void {
    const user = users.get(username);
    if (user) user.lastAuthenticatedAt = Date.now();
  },

  getLastAuthenticatedAt(username: string): number | undefined {
    return users.get(username)?.lastAuthenticatedAt;
  },

  savePushToken(username: string, token: string): void {
    const user = users.get(username);
    if (user) user.pushToken = token;
  },

  getPushToken(username: string): string | undefined {
    return users.get(username)?.pushToken;
  },

  // デバイストークン: passkey 登録・承認時に発行し /push-token の認証に使用
  createDeviceToken(username: string): string {
    const token = randomBytes(32).toString('base64url');
    deviceTokens.set(token, { username, expiresAt: Date.now() + DEVICE_TOKEN_TTL_MS });
    return token;
  },

  validateAndConsumeDeviceToken(token: string): string | undefined {
    const entry = deviceTokens.get(token);
    if (!entry) return undefined;
    deviceTokens.delete(token);
    if (Date.now() > entry.expiresAt) return undefined;
    return entry.username;
  },

  createApproval(
    username: string,
    opts: { pushToken?: string; ipAddress?: string; userAgent?: string },
  ): PendingApproval {
    const code = generateCode();
    const approval: PendingApproval = {
      id: randomUUID(),
      username,
      status: 'pending',
      createdAt: Date.now(),
      pushToken: opts.pushToken,
      code,
      choices: generateChoices(code),
      sessionToken: generateSessionToken(),
      failedAttempts: 0,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    };
    approvals.set(approval.id, approval);
    return approval;
  },

  getPendingApprovalByPushToken(token: string): PendingApproval | undefined {
    for (const approval of approvals.values()) {
      if (approval.pushToken === token && approval.status === 'pending') {
        return approval;
      }
    }
    return undefined;
  },

  getApproval(approvalId: string): PendingApproval | undefined {
    return approvals.get(approvalId);
  },

  updateApprovalStatus(approvalId: string, status: ApprovalStatus): void {
    const approval = approvals.get(approvalId);
    if (approval) approval.status = status;
  },

  incrementFailedAttempts(approvalId: string): number {
    const approval = approvals.get(approvalId);
    if (!approval) return 0;
    approval.failedAttempts++;
    return approval.failedAttempts;
  },
};
