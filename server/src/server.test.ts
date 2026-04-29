import request from 'supertest';
import { app } from './server';
import { store } from './store';

describe('GET /health', () => {
  it('200 を返す', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /registration/begin', () => {
  it('username を渡すと PublicKeyCredentialCreationOptions を返す', async () => {
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: 'test-user' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('challenge');
    expect(res.body).toHaveProperty('rp');
    expect(res.body).toHaveProperty('user');
    expect(res.body.rp.id).toBe('localhost');
  });

  it('username が空のとき 400 を返す', async () => {
    const res = await request(app)
      .post('/registration/begin')
      .send({ username: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /authentication/begin', () => {
  it('クレデンシャル登録済み username のとき PublicKeyCredentialRequestOptions を返す', async () => {
    const username = 'auth-test-user';
    const user = store.getOrCreateUser(username);
    // テスト用ダミークレデンシャルを直接注入
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

    // クリーンアップ
    user.credentials.length = 0;
  });

  it('未登録 username のとき 404 を返す', async () => {
    const res = await request(app)
      .post('/authentication/begin')
      .send({ username: 'no-such-user' });
    expect(res.status).toBe(404);
  });
});
