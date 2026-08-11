import { store, type CredentialRecord } from './store';

function makeCredential(id: string): CredentialRecord {
  return {
    id,
    publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
    transports: ['internal'],
  };
}

describe('store.removeCredential', () => {
  it('AC-3: 2件登録済みのユーザーから1件削除すると removed を返し1件になる', () => {
    const username = 'remove-test-u1';
    store.getOrCreateUser(username);
    store.addCredential(username, makeCredential('u1-cred-1'));
    store.addCredential(username, makeCredential('u1-cred-2'));

    const result = store.removeCredential(username, 'u1-cred-1');

    expect(result).toBe('removed');
    const creds = store.getUser(username)!.credentials;
    expect(creds).toHaveLength(1);
    expect(creds[0]!.id).toBe('u1-cred-2');
  });

  it('AC-4: 最後の1件は last_credential を返し削除されない', () => {
    const username = 'remove-test-u2';
    store.getOrCreateUser(username);
    store.addCredential(username, makeCredential('u2-cred-1'));

    const result = store.removeCredential(username, 'u2-cred-1');

    expect(result).toBe('last_credential');
    expect(store.getUser(username)!.credentials).toHaveLength(1);
  });

  it('AC-5: 存在しない credentialId は not_found を返す', () => {
    const username = 'remove-test-u3';
    store.getOrCreateUser(username);
    store.addCredential(username, makeCredential('u3-cred-1'));
    store.addCredential(username, makeCredential('u3-cred-2'));

    expect(store.removeCredential(username, 'no-such-id')).toBe('not_found');
    expect(store.getUser(username)!.credentials).toHaveLength(2);
  });

  it('AC-2/AC-5: 未登録ユーザーは not_found を返す', () => {
    expect(store.removeCredential('remove-test-nobody', 'any-id')).toBe('not_found');
  });

  it('AC-5: 他ユーザーに属する credential は not_found を返し削除されない', () => {
    const owner = 'remove-test-owner';
    const attacker = 'remove-test-attacker';
    store.getOrCreateUser(owner);
    store.addCredential(owner, makeCredential('owner-cred-1'));
    store.addCredential(owner, makeCredential('owner-cred-2'));
    store.getOrCreateUser(attacker);
    store.addCredential(attacker, makeCredential('attacker-cred-1'));
    store.addCredential(attacker, makeCredential('attacker-cred-2'));

    expect(store.removeCredential(attacker, 'owner-cred-1')).toBe('not_found');
    expect(store.getUser(owner)!.credentials).toHaveLength(2);
  });
});

describe('store.setPassword / store.verifyPassword', () => {
  it('設定したパスワードで verifyPassword が true を返す', () => {
    const username = 'pw-test-u1';
    store.getOrCreateUser(username);
    store.setPassword(username, 'correct-horse-battery-staple');

    expect(store.verifyPassword(username, 'correct-horse-battery-staple')).toBe(true);
  });

  it('異なるパスワードでは verifyPassword が false を返す', () => {
    const username = 'pw-test-u2';
    store.getOrCreateUser(username);
    store.setPassword(username, 'correct-horse-battery-staple');

    expect(store.verifyPassword(username, 'wrong-password')).toBe(false);
  });

  it('パスワード未設定のユーザーは verifyPassword が false を返す', () => {
    const username = 'pw-test-u3';
    store.getOrCreateUser(username);

    expect(store.verifyPassword(username, 'anything')).toBe(false);
  });

  it('存在しないユーザーは verifyPassword が false を返す', () => {
    expect(store.verifyPassword('pw-test-nobody', 'anything')).toBe(false);
  });

  it('同じパスワードでもハッシュ値は都度異なる(salt有効)', () => {
    const u1 = 'pw-test-salt-1';
    const u2 = 'pw-test-salt-2';
    store.getOrCreateUser(u1);
    store.getOrCreateUser(u2);
    store.setPassword(u1, 'same-password');
    store.setPassword(u2, 'same-password');

    expect(store.getUser(u1)!.passwordHash).not.toBe(store.getUser(u2)!.passwordHash);
    expect(store.verifyPassword(u1, 'same-password')).toBe(true);
    expect(store.verifyPassword(u2, 'same-password')).toBe(true);
  });
});

describe('store.createAuthSession / store.getAuthSession / store.deleteAuthSession', () => {
  it('発行したトークンで getAuthSession が username を返す', () => {
    const username = 'auth-session-u1';
    const token = store.createAuthSession(username);

    expect(store.getAuthSession(token)).toBe(username);
  });

  it('存在しないトークンは undefined を返す', () => {
    expect(store.getAuthSession('no-such-token')).toBeUndefined();
  });

  it('deleteAuthSession 後は getAuthSession が undefined を返す', () => {
    const username = 'auth-session-u2';
    const token = store.createAuthSession(username);
    store.deleteAuthSession(token);

    expect(store.getAuthSession(token)).toBeUndefined();
  });

  it('期限切れセッションは undefined を返し破棄される', () => {
    jest.useFakeTimers();
    try {
      const username = 'auth-session-u3';
      const token = store.createAuthSession(username);

      jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

      expect(store.getAuthSession(token)).toBeUndefined();
      // 破棄済みなので、時間を戻しても復活しない
      expect(store.getAuthSession(token)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
