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
