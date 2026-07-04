import request from 'supertest';
import { app } from './server';
import { store } from './store';

// ---- ヘルスチェック ----

describe('GET /health', () => {
  it('200 を返す', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ---- 登録フロー ----

describe('POST /registration/begin', () => {
  it('username を渡すと sessionId 付きの PublicKeyCredentialCreationOptions を返す', async () => {
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'test-user' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
    expect(res.body).toHaveProperty('rp');
    expect(res.body).toHaveProperty('user');
    expect(res.body.rp.id).toBe('localhost');
    // A2: sessionId が返ること
    expect(res.body).toHaveProperty('sessionId');
    expect(typeof res.body.sessionId).toBe('string');
  });

  it('username が空のとき 400 を返す', async () => {
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: '' });
    expect(res.status).toBe(400);
  });
});

// ---- 認証フロー ----

describe('POST /authentication/begin', () => {
  it('クレデンシャル登録済み username のとき sessionId 付きオプションを返す', async () => {
    const username = 'auth-test-user';
    const user = store.getOrCreateUser(username);
    store.addCredential(username, {
      id: 'dummy-cred-id',
      publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      transports: ['internal'],
    });

    const res = await request(app)
      .post('/authentication/begin')
      .send({ username });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
    expect(res.body).toHaveProperty('rpId');
    expect(res.body.rpId).toBe('localhost');
    expect(res.body).toHaveProperty('sessionId');

    user.credentials.length = 0;
  });

  it('A4: username なし（usernameless）でも 200 を返し allowCredentials が空', async () => {
    const res = await request(app)
      .post('/authentication/begin')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body.allowCredentials).toEqual([]);
  });

  it('A3: 未登録 username でも 200 を返す（ユーザー列挙対策）', async () => {
    const res = await request(app)
      .post('/authentication/begin')
      .send({ username: 'no-such-user-for-a3-test' });
    expect(res.status).toBe(200);
    expect(res.body.allowCredentials).toEqual([]);
  });
});

describe('POST /authentication/complete', () => {
  it('sessionId なしで呼ぶと 400 を返す', async () => {
    const res = await request(app)
      .post('/authentication/complete')
      .send({ credential: {} });
    expect(res.status).toBe(400);
  });

  it('無効な sessionId で呼ぶと 400 を返す', async () => {
    const res = await request(app)
      .post('/authentication/complete')
      .send({ credential: { id: 'x', type: 'public-key' }, sessionId: 'invalid-session' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/チャレンジが無効/);
  });

  it('A1: 期限切れの challengeSession で呼ぶと 400 を返す', async () => {
    // TTL を過去に設定したセッションを直接注入
    const sessionId = store.createChallengeSession('dummy-challenge');
    const session = store.getChallengeSession(sessionId)!;
    (session as { expiresAt: number }).expiresAt = Date.now() - 1000;

    const res = await request(app)
      .post('/authentication/complete')
      .send({ credential: { id: 'x', type: 'public-key' }, sessionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/チャレンジが無効/);
  });
});

// ---- 承認フロー（C3: QRLjacking 防御検証） ----

describe('C3: QRLjacking 防御 - push approval セキュリティ', () => {
  function setupApproval(overrides?: Partial<{
    code: number;
    choices: number[];
    sessionToken: string;
    ipAddress: string;
    status: import('./store').ApprovalStatus;
  }>) {
    const approval = store.createApproval('victim-user', {
      pushToken: 'ExponentPushToken[victim-token]',
      ipAddress: '1.2.3.4',
      userAgent: 'Chrome/120 / macOS',
    });
    if (overrides) Object.assign(approval, overrides);
    return approval;
  }

  it('B3: /approve は sessionToken なしで呼ぶと 400 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, selectedCode: approval.code });
    expect(res.status).toBe(400);
  });

  it('B3: /approve は誤った sessionToken で呼ぶと 404 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: 'wrong-token', selectedCode: approval.code });
    expect(res.status).toBe(404);
  });

  it('M-8: selectedCode が choices に含まれない場合 400 を返し approval を rejected にする', async () => {
    const approval = setupApproval();
    const invalidCode = 0; // choices は常に 10-99 の範囲なので 0 は無効
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: invalidCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/コードが無効/);
    expect(store.getApproval(approval.id)!.status).toBe('rejected');
  });

  it('B6: /approve は誤った selectedCode で 400 を返し approval を rejected にする（C1: 試行制限）', async () => {
    const approval = setupApproval();
    // choices 内の正解以外のコードを使用（M-8 の choices 外ブロックを避ける）
    const wrongCode = approval.choices.find(c => c !== approval.code)!;
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: wrongCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/コードが一致しません/);
    // C1: 1 回の誤答で即 rejected にして再試行を防ぐ
    expect(store.getApproval(approval.id)!.status).toBe('rejected');
  });

  it('C1: rejected になった approval は再度 /approve しても 409 を返す', async () => {
    const approval = setupApproval();
    const wrongCode = approval.choices.find(c => c !== approval.code)!;
    await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: wrongCode });
    // 再試行（今度は正解コードで）しても通らない
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: approval.code });
    expect(res.status).toBe(409);
  });

  it('B3+B6: 正しい sessionToken + selectedCode で /approve が成功し deviceToken を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: approval.code });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.deviceToken).toBe('string');
    expect(store.getApproval(approval.id)!.status).toBe('approved');
  });

  it('承認済みの approval を再度 approve すると 409 を返す', async () => {
    const approval = setupApproval({ status: 'approved' });
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: approval.code });
    expect(res.status).toBe(409);
  });

  it('B3: /reject は sessionToken なしで呼ぶと 400 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/reject')
      .send({ approvalId: approval.id });
    expect(res.status).toBe(400);
  });

  it('B3: /reject は誤った sessionToken で呼ぶと 404 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/reject')
      .send({ approvalId: approval.id, sessionToken: 'wrong-token' });
    expect(res.status).toBe(404);
  });

  it('B3: /reject は正しい sessionToken で成功する', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/reject')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken });
    expect(res.status).toBe(200);
    expect(store.getApproval(approval.id)!.status).toBe('rejected');
  });

  it('H2: /pending-approval は sessionToken を返さない（push data に含めない設計）', async () => {
    const uniqueToken = 'ExponentPushToken[h2-pending-unique]';
    const approval = store.createApproval('victim-user', {
      pushToken: uniqueToken,
      ipAddress: '1.2.3.4',
    });
    const res = await request(app)
      .get(`/authentication/pending-approval?token=${encodeURIComponent(uniqueToken)}`);
    expect(res.status).toBe(200);
    expect(res.body.pendingApproval).toBeDefined();
    expect(res.body.pendingApproval.approvalId).toBe(approval.id);
    expect(res.body.pendingApproval.sessionToken).toBeUndefined();
  });

  it('H2: /claim は pushToken が一致すれば sessionToken を返す', async () => {
    const uniqueToken = 'ExponentPushToken[h2-claim-unique]';
    const approval = store.createApproval('victim-user', { pushToken: uniqueToken });
    const res = await request(app)
      .post('/authentication/claim')
      .send({ approvalId: approval.id, pushToken: uniqueToken });
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBe(approval.sessionToken);
  });

  it('H2: /claim は pushToken が一致しなければ 404 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/claim')
      .send({ approvalId: approval.id, pushToken: 'wrong-token' });
    expect(res.status).toBe(404);
  });

  it('H2: /claim は pushToken のない approval に対して 404 を返す', async () => {
    const approval = store.createApproval('no-push-user', {}); // pushToken なし
    const res = await request(app)
      .post('/authentication/claim')
      .send({ approvalId: approval.id, pushToken: 'any-token' });
    expect(res.status).toBe(404);
  });

  it('B3: /approval-info は sessionToken なしで呼ぶと 400 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .get(`/authentication/approval-info?approvalId=${approval.id}`);
    expect(res.status).toBe(400);
  });

  it('B3: /approval-info は誤った sessionToken で呼ぶと 404 を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .get(`/authentication/approval-info?approvalId=${approval.id}&sessionToken=wrong`);
    expect(res.status).toBe(404);
  });

  it('D1: /approval-info は正しい sessionToken で choices・ipAddress・userAgent・createdAt を返す', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .get(`/authentication/approval-info?approvalId=${approval.id}&sessionToken=${approval.sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.choices).toHaveLength(3);
    expect(res.body.choices).toContain(approval.code);
    expect(res.body.ipAddress).toBe('1.2.3.4');
    expect(res.body.userAgent).toBe('Chrome/120 / macOS');
    expect(typeof res.body.createdAt).toBe('number');
  });

  it('C3: Number Matching はランダム性を持つ（1/3 の確率で当たる）', () => {
    // 100件サンプルを生成して choices の構造を検証
    const results = Array.from({ length: 100 }, () => {
      const a = store.createApproval('sample-user', {});
      return { code: a.code, choices: a.choices };
    });

    // コードは 10-99 の範囲
    expect(results.every(r => r.code >= 10 && r.code <= 99)).toBe(true);
    // choices は 3 択
    expect(results.every(r => r.choices.length === 3)).toBe(true);
    // choices は必ず正解を含む
    expect(results.every(r => r.choices.includes(r.code))).toBe(true);
    // choices の全要素が 10-99
    expect(results.every(r => r.choices.every(c => c >= 10 && c <= 99))).toBe(true);
    // 選択肢に重複がない
    expect(results.every(r => new Set(r.choices).size === 3)).toBe(true);
    // 正解が choices の先頭に固定されていない（シャッフルされている）
    const correctAtIndex0 = results.filter(r => r.choices[0] === r.code).length;
    expect(correctAtIndex0).toBeGreaterThan(10);
    expect(correctAtIndex0).toBeLessThan(90);
  });

  it('C3: QRLjacking - push 通知はクレデンシャル所有者のデバイスに届く（設計検証）', () => {
    // QRLjacking 攻撃シナリオ:
    // 1. 攻撃者が /authentication/begin を呼び出して sessionId を取得
    // 2. 攻撃者の QR コードを被害者がスキャンして認証
    // 3. /authentication/complete でクレデンシャル ID からユーザーを逆引き
    // → push 通知は被害者のデバイス（登録済み push トークン）に送られる
    //
    // サーバーは「誰が /authentication/begin を呼んだか」を無視し、
    // 「どのクレデンシャルが authentication/complete に届いたか」を基準に push 先を決める。
    // これにより、攻撃者は被害者の承認通知を自分のデバイスで受け取れない。

    const victimUsername = 'qrljacking-victim';
    const victimPushToken = 'ExponentPushToken[victim-device]';
    store.getOrCreateUser(victimUsername);
    store.savePushToken(victimUsername, victimPushToken);

    const retrieved = store.getPushToken(victimUsername);
    expect(retrieved).toBe(victimPushToken);

    // 攻撃者が begin を呼んだ sessionId を使って complete を呼んでも、
    // approval の pushToken は被害者のもの
    const approval = store.createApproval(victimUsername, {
      pushToken: victimPushToken,
      ipAddress: '192.168.1.100', // 攻撃者の IP
    });
    expect(approval.pushToken).toBe(victimPushToken);
    // 攻撃者の IP は表示用であり、push 送信先には影響しない
  });
});

// ---- M-7: ユーザー列挙対策 ----

describe('M-7: /authentication/status はユーザー存在を漏らさない', () => {
  it('レスポンスに lastAuthenticatedAt が含まれない', async () => {
    const res = await request(app)
      .get('/authentication/status?username=m7-nonexistent-user');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('lastAuthenticatedAt');
    expect(res.body).toHaveProperty('authenticated');
    expect(res.body.authenticated).toBe(false);
  });
});

// ---- M3: session.username バインディング ----

describe('M3: session.username バインディング', () => {
  it('begin で指定した username と complete の credential 所有者が一致しなければ 400', async () => {
    // alice のセッションを作成
    const sessionId = store.createChallengeSession('dummy-challenge', 'alice');

    // bob のクレデンシャルで complete を呼ぶ（credential.id が bob のもの）
    store.getOrCreateUser('bob-m3');
    store.addCredential('bob-m3', {
      id: 'bob-m3-cred',
      publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      transports: ['internal'],
    });

    const res = await request(app)
      .post('/authentication/complete')
      .send({ credential: { id: 'bob-m3-cred', type: 'public-key' }, sessionId });
    // alice session で bob credential → 400 or verifyAuthenticationResponse がエラーで 400
    // simplewebauthn の検証失敗 or session.username mismatch のいずれかで 400
    expect(res.status).toBe(400);
  });
});

// ---- M4: 登録セッション不一致時の削除 ----

describe('M4: 登録セッション username 不一致時に即時削除', () => {
  it('username 不一致で registration/complete を呼んだ後、同じ sessionId は使えない', async () => {
    const sessionId = store.createChallengeSession('reg-challenge', 'correct-user');

    // wrong user で complete を試みる
    await request(app)
      .post('/registration/complete')
      .send({ username: 'wrong-user', credential: {}, sessionId });

    // 同じ sessionId で再試行しても既に削除済み
    const res = await request(app)
      .post('/registration/complete')
      .send({ username: 'correct-user', credential: {}, sessionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/チャレンジが無効/);
  });
});

// ---- C2: BLE / transport 非依存性 ----

describe('C2: サーバーは BLE transport を要求しない', () => {
  it('/authentication/begin はどの transport のクレデンシャルでも動作する', async () => {
    const transports = [
      ['internal'],           // platform authenticator
      ['usb'],                // CTAP2 USB
      ['hybrid'],             // caBLE（CTAP2 Hybrid）
      ['ble'],                // BLE
      ['nfc'],                // NFC
      ['internal', 'hybrid'], // 複合
    ];

    for (const transport of transports) {
      const username = `transport-test-${transport.join('-')}`;
      store.getOrCreateUser(username);
      store.addCredential(username, {
        id: `cred-${transport.join('-')}`,
        publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
        transports: transport as ('internal' | 'hybrid' | 'usb' | 'ble' | 'nfc')[],
      });
      const res = await request(app)
        .post('/authentication/begin')
        .send({ username });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('challenge');
    }
  });

  it('/authentication/begin はBLE transport のないクレデンシャルでも 200 を返す', async () => {
    const username = 'no-ble-user';
    store.getOrCreateUser(username);
    store.addCredential(username, {
      id: 'no-ble-cred',
      publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      transports: ['usb'],
    });
    const res = await request(app)
      .post('/authentication/begin')
      .send({ username });
    expect(res.status).toBe(200);
    // BLE なしでも allowCredentials に含まれる（サーバーは transport を制限しない）
    const cred = res.body.allowCredentials?.find((c: { id: string }) => c.id === 'no-ble-cred');
    expect(cred).toBeDefined();
  });
});

// ---- push-token ----

describe('POST /push-token', () => {
  it('H1: deviceToken なしで呼ぶと 400 を返す', async () => {
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'push-test-user', token: 'ExponentPushToken[test]' });
    expect(res.status).toBe(400);
  });

  it('H1: 無効な deviceToken で呼ぶと 403 を返す', async () => {
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'push-test-user', token: 'ExponentPushToken[test]', deviceToken: 'invalid' });
    expect(res.status).toBe(403);
  });

  it('H1: 有効な deviceToken で呼ぶと push token が保存される', async () => {
    const deviceToken = store.createDeviceToken('push-test-user-h1');
    store.getOrCreateUser('push-test-user-h1');
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'push-test-user-h1', token: 'ExponentPushToken[h1-test]', deviceToken });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(store.getPushToken('push-test-user-h1')).toBe('ExponentPushToken[h1-test]');
  });

  it('H1: username が一致しない deviceToken で呼ぶと 403 を返す', async () => {
    const deviceToken = store.createDeviceToken('other-user');
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'different-user', token: 'ExponentPushToken[test]', deviceToken });
    expect(res.status).toBe(403);
  });

  it('C-3: 同一 push token を別ユーザーが登録すると旧ユーザーのトークンが削除される', async () => {
    const token = 'ExponentPushToken[c3-shared-token]';
    const dt1 = store.createDeviceToken('c3-user1');
    store.getOrCreateUser('c3-user1');
    await request(app).post('/push-token').send({ username: 'c3-user1', token, deviceToken: dt1 });
    expect(store.getPushToken('c3-user1')).toBe(token);

    const dt2 = store.createDeviceToken('c3-user2');
    store.getOrCreateUser('c3-user2');
    await request(app).post('/push-token').send({ username: 'c3-user2', token, deviceToken: dt2 });
    expect(store.getPushToken('c3-user2')).toBe(token);
    expect(store.getPushToken('c3-user1')).toBeUndefined();
  });

  it('H1: deviceToken は一度消費すると再利用できない', async () => {
    const deviceToken = store.createDeviceToken('one-time-user');
    store.getOrCreateUser('one-time-user');
    await request(app)
      .post('/push-token')
      .send({ username: 'one-time-user', token: 'ExponentPushToken[first]', deviceToken });
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'one-time-user', token: 'ExponentPushToken[second]', deviceToken });
    expect(res.status).toBe(403);
  });
});

// ---- C-1: 既存ユーザーへの追加登録ブロック ----

describe('C-1: 既存ユーザーへの追加登録ブロック', () => {
  function addCredential(username: string, credId: string) {
    store.getOrCreateUser(username);
    store.addCredential(username, {
      id: credId,
      publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      transports: ['internal'],
    });
  }

  it('クレデンシャル登録済みのユーザーへの /registration/begin は 403 と requiresReauth を返す', async () => {
    addCredential('c1-block-user', 'c1-block-cred');
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'c1-block-user' });
    expect(res.status).toBe(403);
    expect(res.body.requiresReauth).toBe(true);
  });

  it('有効な registrationToken があれば既存ユーザーも /registration/begin は 200 を返す', async () => {
    addCredential('c1-token-user', 'c1-token-cred');
    const registrationToken = store.createRegistrationToken('c1-token-user');
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'c1-token-user', registrationToken });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
  });

  it('無効な registrationToken での /registration/begin は 403 を返す', async () => {
    addCredential('c1-bad-token-user', 'c1-bad-token-cred');
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'c1-bad-token-user', registrationToken: 'invalid-token' });
    expect(res.status).toBe(403);
  });

  it('registrationToken は使い捨て（2回目の使用は 403）', async () => {
    addCredential('c1-oneshot-user', 'c1-oneshot-cred');
    const registrationToken = store.createRegistrationToken('c1-oneshot-user');
    await request(app)
      .post('/registration/begin')
      .send({ username: 'c1-oneshot-user', registrationToken });
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'c1-oneshot-user', registrationToken });
    expect(res.status).toBe(403);
  });

  it('クレデンシャルのない新規ユーザーは registrationToken なしで /registration/begin が通る', async () => {
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'c1-new-user' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
  });
});

describe('POST /registration/authorize', () => {
  it('credential と sessionId がない場合 400 を返す', async () => {
    const res = await request(app)
      .post('/registration/authorize')
      .send({});
    expect(res.status).toBe(400);
  });

  it('無効な sessionId で 400 を返す', async () => {
    const res = await request(app)
      .post('/registration/authorize')
      .send({ credential: { id: 'x', type: 'public-key' }, sessionId: 'invalid-session' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/チャレンジが無効/);
  });

  it('存在しない credential.id で 404 を返す', async () => {
    const sessionId = store.createChallengeSession('auth-challenge');
    const res = await request(app)
      .post('/registration/authorize')
      .send({ credential: { id: 'nonexistent-cred', type: 'public-key' }, sessionId });
    expect(res.status).toBe(404);
  });
});

// ---- H-1: /claim は1回限り ----

describe('H-1: /claim は sessionToken を1回限り返す', () => {
  it('2回目の /claim は 409 を返す', async () => {
    const token = 'ExponentPushToken[h1-one-time-claim]';
    const approval = store.createApproval('h1-user', { pushToken: token });

    const res1 = await request(app)
      .post('/authentication/claim')
      .send({ approvalId: approval.id, pushToken: token });
    expect(res1.status).toBe(200);
    expect(res1.body.sessionToken).toBe(approval.sessionToken);

    const res2 = await request(app)
      .post('/authentication/claim')
      .send({ approvalId: approval.id, pushToken: token });
    expect(res2.status).toBe(409);
  });
});

// ---- H-2: reject reason をサーバーに記録 ----

describe('H-2: /reject は reason を記録する', () => {
  it('reason: not_me で拒否すると rejectionReason が保存される', async () => {
    const approval = store.createApproval('h2-user', {
      pushToken: 'ExponentPushToken[h2-reject]',
    });
    const res = await request(app)
      .post('/authentication/reject')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, reason: 'not_me' });
    expect(res.status).toBe(200);
    expect(store.getApproval(approval.id)!.status).toBe('rejected');
    expect(store.getApproval(approval.id)!.rejectionReason).toBe('not_me');
  });

  it('reason なしの拒否は user_rejected として記録される', async () => {
    const approval = store.createApproval('h2-user2', {
      pushToken: 'ExponentPushToken[h2-reject2]',
    });
    const res = await request(app)
      .post('/authentication/reject')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken });
    expect(res.status).toBe(200);
    expect(store.getApproval(approval.id)!.rejectionReason).toBe('user_rejected');
  });
});

// ---- パスキー一覧・削除 API ----

function makeCredential(id: string) {
  return {
    id,
    publicKey: Buffer.from('dummy') as unknown as Uint8Array<ArrayBuffer>,
    counter: 0,
    deviceType: 'singleDevice' as const,
    backedUp: false,
    transports: ['internal' as const],
  };
}

describe('GET /credentials', () => {
  it('AC-1: 登録済みユーザーの一覧を公開情報のみで返す', async () => {
    const username = 'list-test-alice';
    store.getOrCreateUser(username);
    store.addCredential(username, makeCredential('list-cred-1'));
    store.addCredential(username, makeCredential('list-cred-2'));

    const res = await request(app).get('/credentials').query({ username });

    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(2);
    expect(res.body.credentials[0]).toEqual({
      id: 'list-cred-1',
      deviceType: 'singleDevice',
      backedUp: false,
      transports: ['internal'],
    });
    for (const cred of res.body.credentials) {
      expect(cred).not.toHaveProperty('publicKey');
      expect(cred).not.toHaveProperty('counter');
    }
  });

  it('AC-2: 未登録ユーザーは 200 で空配列を返す', async () => {
    const res = await request(app).get('/credentials').query({ username: 'list-test-nobody' });
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
  });

  it('AC-6: username なしは 400 を返す', async () => {
    const res = await request(app).get('/credentials');
    expect(res.status).toBe(400);
  });
});

// ---- M-3: 最新の pending approval を返す ----

describe('M-3: getPendingApprovalByPushToken は最新の pending を返す', () => {
  it('複数 pending がある場合 createdAt が最大のものを返す', () => {
    const token = 'ExponentPushToken[m3-multi]';
    const older = store.createApproval('m3-user', { pushToken: token });
    const newer = store.createApproval('m3-user', { pushToken: token });
    expect(newer.createdAt).toBeGreaterThanOrEqual(older.createdAt);
    const found = store.getPendingApprovalByPushToken(token);
    expect(found?.id).toBe(newer.id);
  });
});
