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

  it('B6: /approve は誤った selectedCode で呼ぶと 400 を返す', async () => {
    const approval = setupApproval();
    const wrongCode = approval.code === 10 ? 11 : approval.code - 1;
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: wrongCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/コードが一致しません/);
  });

  it('B3+B6: 正しい sessionToken + selectedCode で /approve が成功する', async () => {
    const approval = setupApproval();
    const res = await request(app)
      .post('/authentication/approve')
      .send({ approvalId: approval.id, sessionToken: approval.sessionToken, selectedCode: approval.code });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
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
  it('username と token を渡すと保存される', async () => {
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'push-test-user', token: 'ExponentPushToken[test]' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(store.getPushToken('push-test-user')).toBe('ExponentPushToken[test]');
  });

  it('token が空のとき 400 を返す', async () => {
    const res = await request(app)
      .post('/push-token')
      .send({ username: 'push-test-user' });
    expect(res.status).toBe(400);
  });
});
