import express from 'express';
import cors from 'cors';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { store } from './store';

const RPID = process.env['RPID'] ?? 'easier-red-bold-glossary.trycloudflare.com';
const RP_NAME = 'Passkey PoC';
const ORIGIN_WEB = `https://${RPID}`;
const ORIGIN_LOCAL = 'http://localhost:3000';

const ANDROID_APK_HASH =
  process.env['ANDROID_APK_HASH'] ?? '-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w';
const ORIGIN_ANDROID = `android:apk-key-hash:${ANDROID_APK_HASH}`;

const ANDROID_SHA256_FINGERPRINT =
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
const ANDROID_PACKAGE_NAME = 'com.anonymous.app';

const APPLE_TEAM_ID = process.env['APPLE_TEAM_ID'] ?? '';
const IOS_BUNDLE_ID = process.env['IOS_BUNDLE_ID'] ?? '';

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function allowedOrigins(): string[] {
  return [ORIGIN_WEB, ORIGIN_LOCAL, ORIGIN_ANDROID];
}

const MIN_PASSWORD_LENGTH = 8;

// ログインセッション(authToken)を Authorization: Bearer ヘッダーから解決する。
// Cookieは使わず、Web/App共通でヘッダー方式に統一する（設計判断は docs/design 参照）。
function requireAuthSession(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return store.getAuthSession(token) ?? null;
}

export const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/push-token', (req, res) => {
  const { username, token, deviceToken } = req.body as {
    username?: string;
    token?: string;
    deviceToken?: string;
  };
  if (!username || !token || !deviceToken) {
    res.status(400).json({ error: 'username、token、deviceToken は必須です' });
    return;
  }
  const validUsername = store.validateAndConsumeDeviceToken(deviceToken);
  if (!validUsername || validUsername !== username) {
    res.status(403).json({ error: 'deviceToken が無効または期限切れです' });
    return;
  }
  store.getOrCreateUser(username);
  store.savePushToken(username, token);
  res.json({ ok: true });
});

app.get('/.well-known/apple-app-site-association', (_req, res) => {
  res.json({
    webcredentials: {
      apps: APPLE_TEAM_ID && IOS_BUNDLE_ID ? [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`] : [],
    },
    applinks: {
      apps: [],
      details: APPLE_TEAM_ID && IOS_BUNDLE_ID
        ? [{ appID: `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`, paths: ['*'] }]
        : [],
    },
  });
});

app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.json([
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: [ANDROID_SHA256_FINGERPRINT],
      },
    },
  ]);
});

// ---- ID/PASS 認証 ----

app.post('/auth/signup', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username、password は必須です' });
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください` });
    return;
  }
  const existing = store.getUser(username);
  if (existing?.passwordHash) {
    res.status(409).json({ error: 'このユーザー名は既に使われています' });
    return;
  }
  store.getOrCreateUser(username);
  store.setPassword(username, password);
  const authToken = store.createAuthSession(username);
  res.json({ authToken });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username、password は必須です' });
    return;
  }
  // ユーザー不存在とパスワード不一致を区別しない（列挙対策、A3/A4方針を踏襲）
  if (!store.verifyPassword(username, password)) {
    res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
    return;
  }
  const authToken = store.createAuthSession(username);
  res.json({ authToken });
});

app.post('/auth/logout', (req, res) => {
  const { authToken } = req.body as { authToken?: string };
  if (authToken) store.deleteAuthSession(authToken);
  res.json({ ok: true });
});

// ---- 登録フロー ----

app.post('/registration/begin', async (req, res) => {
  const { username, registrationToken } = req.body as { username?: string; registrationToken?: string };
  if (!username) {
    res.status(400).json({ error: 'username は必須です' });
    return;
  }

  // C-1: 既存ユーザーへの追加登録は既存 credential での再認証（registrationToken）を必須化
  const existingUser = store.getUser(username);
  if (existingUser && existingUser.credentials.length > 0) {
    if (!registrationToken || !store.validateAndConsumeRegistrationToken(registrationToken, username)) {
      res.status(403).json({
        error: '既存のパスキーへの追加登録には再認証が必要です',
        requiresReauth: true,
      });
      return;
    }
  } else {
    // 最初のパスキー登録は ID/PASS ログインセッション必須（任意usernameでの自由登録=squatting対策）
    const sessionUsername = requireAuthSession(req);
    if (!sessionUsername || sessionUsername !== username) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
  }

  const user = store.getOrCreateUser(username);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RPID,
    userName: username,
    userID: user.id,
    attestationType: 'none',
    excludeCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  const sessionId = store.createChallengeSession(options.challenge, username);
  res.json({ ...options, sessionId });
});

app.post('/registration/complete', async (req, res) => {
  const { username, credential, sessionId } = req.body as {
    username?: string;
    credential?: RegistrationResponseJSON;
    sessionId?: string;
  };
  if (!username || !credential || !sessionId) {
    res.status(400).json({ error: 'username、credential、sessionId は必須です' });
    return;
  }

  const session = store.getChallengeSession(sessionId);
  if (!session || session.username !== username) {
    store.deleteChallengeSession(sessionId);
    res.status(400).json({ error: 'チャレンジが無効または期限切れです' });
    return;
  }
  store.deleteChallengeSession(sessionId);

  const user = store.getUser(username);
  if (!user) {
    res.status(400).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: session.challenge,
      expectedOrigin: allowedOrigins(),
      expectedRPID: RPID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: '検証に失敗しました' });
      return;
    }

    const { credential: cred } = verification.registrationInfo;
    store.addCredential(username, {
      id: cred.id,
      publicKey: cred.publicKey as Uint8Array<ArrayBuffer>,
      counter: cred.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: credential.response.transports ?? [],
    });

    const deviceToken = store.createDeviceToken(username);
    res.json({ verified: true, deviceToken });
  } catch (err) {
    res.status(400).json({ error: '登録の検証に失敗しました' });
  }
});

// C-1: 既存 credential での再認証 → registrationToken 発行
app.post('/registration/authorize', async (req, res) => {
  const { credential, sessionId } = req.body as {
    credential?: AuthenticationResponseJSON;
    sessionId?: string;
  };
  if (!credential || !sessionId) {
    res.status(400).json({ error: 'credential と sessionId は必須です' });
    return;
  }

  const session = store.getChallengeSession(sessionId);
  if (!session) {
    res.status(400).json({ error: 'チャレンジが無効または期限切れです' });
    return;
  }
  store.deleteChallengeSession(sessionId);

  const user = store.getUserByCredentialId(credential.id);
  if (!user) {
    res.status(404).json({ error: '認証情報が見つかりません' });
    return;
  }

  if (session.username && session.username !== user.username) {
    res.status(400).json({ error: '認証情報のユーザーが一致しません' });
    return;
  }

  const storedCred = user.credentials.find((c) => c.id === credential.id)!;

  try {
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: session.challenge,
      expectedOrigin: allowedOrigins(),
      expectedRPID: RPID,
      credential: {
        id: storedCred.id,
        publicKey: storedCred.publicKey,
        counter: storedCred.counter,
        transports: storedCred.transports,
      },
    });

    if (!verification.verified) {
      res.status(400).json({ error: '検証に失敗しました' });
      return;
    }

    // C-2: counter 巻き戻し検出（A6 相当）
    const newCounter = verification.authenticationInfo.newCounter;
    if (storedCred.counter > 0 && newCounter <= storedCred.counter) {
      console.error('[security] counter rollback detected in /registration/authorize:', {
        username: user.username,
        credentialId: storedCred.id,
        stored: storedCred.counter,
        received: newCounter,
      });
      res.status(400).json({ error: '認証カウンターが無効です' });
      return;
    }
    store.updateCounter(user.username, storedCred.id, newCounter);
    const registrationToken = store.createRegistrationToken(user.username);
    res.json({ registrationToken });
  } catch {
    res.status(400).json({ error: '認証に失敗しました' });
  }
});

// ---- 認証フロー ----

app.post('/authentication/begin', async (req, res) => {
  const { username } = req.body as { username?: string };

  const user = username ? store.getUser(username) : undefined;

  // A3: ユーザー存在の有無に関わらず同形式のレスポンスを返す
  // A4: ユーザーが見つかれば allowCredentials を設定、なければ空（usernameless）
  const options = await generateAuthenticationOptions({
    rpID: RPID,
    userVerification: 'required',
    allowCredentials: user?.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })) ?? [],
  });

  const sessionId = store.createChallengeSession(options.challenge, username);
  res.json({ ...options, sessionId });
});

app.post('/authentication/complete', async (req, res) => {
  const { credential, sessionId } = req.body as {
    credential?: AuthenticationResponseJSON;
    sessionId?: string;
  };
  if (!credential || !sessionId) {
    res.status(400).json({ error: 'credential と sessionId は必須です' });
    return;
  }

  const session = store.getChallengeSession(sessionId);
  if (!session) {
    res.status(400).json({ error: 'チャレンジが無効または期限切れです' });
    return;
  }
  store.deleteChallengeSession(sessionId);

  // A4: クレデンシャル ID からユーザーを逆引き
  const user = store.getUserByCredentialId(credential.id);
  if (!user) {
    res.status(404).json({ error: '認証情報が見つかりません' });
    return;
  }

  // M3: begin で username を指定した場合、credential 所有者が一致するか検証
  if (session.username && session.username !== user.username) {
    res.status(400).json({ error: '認証情報のユーザーが一致しません' });
    return;
  }

  const storedCred = user.credentials.find((c) => c.id === credential.id)!;

  try {
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: session.challenge,
      expectedOrigin: allowedOrigins(),
      expectedRPID: RPID,
      credential: {
        id: storedCred.id,
        publicKey: storedCred.publicKey,
        counter: storedCred.counter,
        transports: storedCred.transports,
      },
    });

    if (!verification.verified) {
      res.status(400).json({ error: '検証に失敗しました' });
      return;
    }

    // A6: counter 巻き戻し検出（simplewebauthn がエラーを throw するが明示的に確認）
    const newCounter = verification.authenticationInfo.newCounter;
    if (storedCred.counter > 0 && newCounter <= storedCred.counter) {
      console.error('[security] counter rollback detected:', {
        username: user.username,
        credentialId: storedCred.id,
        stored: storedCred.counter,
        received: newCounter,
      });
      res.status(400).json({ error: '認証カウンターが無効です' });
      return;
    }
    store.updateCounter(user.username, storedCred.id, newCounter);
    store.recordAuthentication(user.username);

    const pushToken = store.getPushToken(user.username);

    // push token がない場合は 動線 B（直接完了）— approval は作らない
    // WebAuthn署名検証済みのためログインセッション(authToken)を発行する。
    // push-approval分岐(下記)では発行しない — /authentication/approval-status が
    // 無認可でポーリング可能なため、ここでauthTokenを含めるとapprovalId漏洩だけで
    // セッション奪取が可能になってしまう（詳細はdocs/design参照）
    if (!pushToken) {
      const authToken = store.createAuthSession(user.username);
      res.json({ verified: true, authToken });
      return;
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const approval = store.createApproval(user.username, {
      pushToken,
      ipAddress,
      userAgent,
    });

    setTimeout(() => {
      const a = store.getApproval(approval.id);
      if (a?.status === 'pending') store.updateApprovalStatus(approval.id, 'expired');
    }, APPROVAL_TIMEOUT_MS).unref();

    sendApprovalPushNotification(pushToken, user.username, approval.id).catch(() => {});

    res.json({ approvalId: approval.id, code: approval.code });
  } catch (err) {
    // エラー内容を外部に漏らさない
    console.error('[authentication/complete error]', err);
    res.status(400).json({ error: '認証に失敗しました' });
  }
});

// ---- 承認フロー ----

app.get('/authentication/approval-info', (req, res) => {
  const { approvalId, sessionToken } = req.query as {
    approvalId?: string;
    sessionToken?: string;
  };
  if (!approvalId || !sessionToken) {
    res.status(400).json({ error: 'approvalId と sessionToken は必須です' });
    return;
  }
  const approval = store.getApproval(approvalId);
  if (!approval || approval.sessionToken !== sessionToken) {
    res.status(404).json({ error: '承認リクエストが見つかりません' });
    return;
  }
  if (approval.status !== 'pending') {
    res.status(409).json({ error: `既に ${approval.status} 状態です` });
    return;
  }
  res.json({
    choices: approval.choices,
    ipAddress: approval.ipAddress,
    userAgent: approval.userAgent,
    createdAt: approval.createdAt,
    username: approval.username,
  });
});

app.get('/authentication/pending-approval', (req, res) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res.status(400).json({ error: 'token は必須です' });
    return;
  }
  const approval = store.getPendingApprovalByPushToken(token);
  if (!approval) {
    res.json({ pendingApproval: null });
    return;
  }
  res.json({
    pendingApproval: {
      approvalId: approval.id,
      username: approval.username,
    },
  });
});

// push token 所持を証明して sessionToken を取得（push data に sessionToken を含めない設計）
app.post('/authentication/claim', (req, res) => {
  const { approvalId, pushToken } = req.body as { approvalId?: string; pushToken?: string };
  if (!approvalId || !pushToken) {
    res.status(400).json({ error: 'approvalId と pushToken は必須です' });
    return;
  }
  const approval = store.getApproval(approvalId);
  if (!approval || !approval.pushToken || approval.pushToken !== pushToken || approval.status !== 'pending') {
    res.status(404).json({ error: '承認リクエストが見つかりません' });
    return;
  }
  // H-1: sessionToken は1回限り取得可能
  const claimed = store.markSessionTokenClaimed(approvalId);
  if (!claimed) {
    res.status(409).json({ error: 'sessionToken は既に取得済みです' });
    return;
  }
  res.json({ sessionToken: approval.sessionToken });
});

app.get('/authentication/approval-status', (req, res) => {
  const { approvalId } = req.query as { approvalId?: string };
  if (!approvalId) {
    res.status(400).json({ error: 'approvalId は必須です' });
    return;
  }
  const approval = store.getApproval(approvalId);
  if (!approval) {
    res.status(404).json({ error: '承認リクエストが見つかりません' });
    return;
  }
  res.json({ status: approval.status, username: approval.username });
});

app.post('/authentication/approve', (req, res) => {
  const { approvalId, sessionToken, selectedCode } = req.body as {
    approvalId?: string;
    sessionToken?: string;
    selectedCode?: number;
  };
  if (!approvalId || !sessionToken || selectedCode === undefined) {
    res.status(400).json({ error: 'approvalId、sessionToken、selectedCode は必須です' });
    return;
  }
  const approval = store.getApproval(approvalId);
  if (!approval || approval.sessionToken !== sessionToken) {
    res.status(404).json({ error: '承認リクエストが見つかりません' });
    return;
  }
  if (approval.status !== 'pending') {
    res.status(409).json({ error: `既に ${approval.status} 状態です` });
    return;
  }
  // M-8: 提出コードが提示選択肢内であることを検証（ブルートフォース防止）
  if (!approval.choices.includes(selectedCode)) {
    store.updateApprovalStatus(approvalId, 'rejected');
    res.status(400).json({ error: 'コードが無効です。セキュリティのためリクエストを無効化しました' });
    return;
  }
  if (selectedCode !== approval.code) {
    store.incrementFailedAttempts(approvalId);
    store.updateApprovalStatus(approvalId, 'rejected');
    res.status(400).json({ error: 'コードが一致しません。セキュリティのためリクエストを無効化しました' });
    return;
  }
  store.updateApprovalStatus(approvalId, 'approved');
  store.recordAuthentication(approval.username);
  const deviceToken = store.createDeviceToken(approval.username);
  res.json({ ok: true, deviceToken });
});

app.post('/authentication/reject', (req, res) => {
  const { approvalId, sessionToken, reason } = req.body as {
    approvalId?: string;
    sessionToken?: string;
    reason?: 'user_rejected' | 'not_me';
  };
  if (!approvalId || !sessionToken) {
    res.status(400).json({ error: 'approvalId と sessionToken は必須です' });
    return;
  }
  const approval = store.getApproval(approvalId);
  if (!approval || approval.sessionToken !== sessionToken) {
    res.status(404).json({ error: '承認リクエストが見つかりません' });
    return;
  }
  if (approval.status !== 'pending') {
    res.status(409).json({ error: `既に ${approval.status} 状態です` });
    return;
  }
  const rejectionReason = reason === 'not_me' ? 'not_me' : 'user_rejected';
  // H-2: 不正アクセスの疑いをサーバー側に記録
  if (rejectionReason === 'not_me') {
    console.warn('[security] 不正アクセスの疑いによる拒否:', {
      approvalId,
      username: approval.username,
      ipAddress: approval.ipAddress,
      userAgent: approval.userAgent,
    });
  }
  store.rejectApproval(approvalId, rejectionReason);
  res.json({ ok: true });
});

app.get('/authentication/status', (req, res) => {
  const { username, since } = req.query as { username?: string; since?: string };
  if (!username) {
    res.status(400).json({ error: 'username は必須です' });
    return;
  }
  const lastAuthenticatedAt = store.getLastAuthenticatedAt(username);
  const sinceMs = since ? parseInt(since, 10) : 0;
  const authenticated = lastAuthenticatedAt !== undefined && lastAuthenticatedAt > sinceMs;
  // M-7: lastAuthenticatedAt を返さない（ユーザー存在有無を漏らさない）
  res.json({ authenticated });
});

// ---- パスキー管理（一覧・削除） ----
// 認可は Authorization: Bearer <authToken>（ログインセッション）のみ。
// 旧: username クエリのみで認可していたPoC上のIDORトレードオフは、
// ID/PASSログイン導入に伴いこの機会に解消した。

app.get('/credentials', (req, res) => {
  const username = requireAuthSession(req);
  if (!username) {
    res.status(401).json({ error: 'ログインが必要です' });
    return;
  }
  const user = store.getUser(username);
  const credentials = (user?.credentials ?? []).map((c) => ({
    id: c.id,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    transports: c.transports,
  }));
  res.json({ credentials });
});

app.delete('/credentials/:credentialId', (req, res) => {
  const { credentialId } = req.params;
  const username = requireAuthSession(req);
  if (!username) {
    res.status(401).json({ error: 'ログインが必要です' });
    return;
  }
  const result = store.removeCredential(username, credentialId);
  if (result === 'not_found') {
    // credential 不存在とユーザー不存在・他ユーザー所有を区別しない（列挙対策）
    res.status(404).json({ error: '認証情報が見つかりません' });
    return;
  }
  if (result === 'last_credential') {
    res.status(409).json({ error: '最後のパスキーは削除できません' });
    return;
  }
  res.json({ ok: true });
});

// ---- Web UI ----

app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Passkey PoC</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 60px auto; padding: 0 16px; }
    input { width: 100%; padding: 10px; font-size: 16px; margin-bottom: 12px; box-sizing: border-box; }
    button { width: 100%; padding: 12px; font-size: 16px; background: #007AFF; color: #fff; border: none; border-radius: 8px; cursor: pointer; margin-bottom: 10px; }
    button.secondary { background: #34C759; }
    button.danger { background: #f8d7da; color: #a00; }
    button.link { background: none; color: #007AFF; text-decoration: underline; padding: 4px; }
    button:disabled { opacity: 0.5; }
    hr { margin: 24px 0; border: none; border-top: 1px solid #eee; }
    #status { margin-top: 20px; padding: 14px; border-radius: 8px; display: none; }
    .waiting { background: #fff3cd; }
    .approved { background: #d4edda; }
    .rejected { background: #f8d7da; }
    #code-box { display: none; text-align: center; margin: 16px 0; padding: 20px; background: #1a1a2e; border-radius: 12px; }
    #code-number { font-size: 64px; font-weight: bold; letter-spacing: 8px; color: #fff; font-family: monospace; }
    #code-label { font-size: 12px; color: #aaa; margin-top: 4px; }
    #logged-in-section { display: none; }
    .cred-item { display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f5f5f5; border-radius: 8px; margin-bottom: 8px; }
    .cred-item span { font-family: monospace; font-size: 12px; word-break: break-all; }
    .cred-item button { width: auto; margin: 0; padding: 6px 10px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Passkey PoC</h1>

  <div id="auth-section">
    <h3>ログイン / 新規登録（ID/PASS）</h3>
    <input id="auth-username" placeholder="ユーザー名" autocomplete="username" />
    <input id="auth-password" type="password" placeholder="パスワード（8文字以上）" autocomplete="current-password" />
    <button onclick="login()">ログイン</button>
    <button class="secondary" onclick="signup()">新規登録</button>

    <hr>
    <h3>パスキーでサインイン（パスワードレス）</h3>
    <input id="username" placeholder="ユーザー名（任意）" />
    <button id="btn" onclick="beginAuth()">パスキーでサインイン</button>
  </div>

  <div id="logged-in-section">
    <p><strong id="welcome-text"></strong></p>
    <button class="secondary" onclick="addPasskey()">このデバイスにパスキーを追加登録</button>
    <button class="link" onclick="logout()">ログアウト</button>
    <hr>
    <h3>登録済みパスキー</h3>
    <div id="cred-list"></div>
  </div>

  <div id="code-box">
    <div id="code-label">スマートフォンに表示された番号を選択してください</div>
    <div id="code-number">--</div>
  </div>
  <div id="status"></div>

  <script type="module">
    import { startAuthentication, startRegistration } from 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13/esm/index.js';

    let pollTimer = null;
    // authToken はページ内メモリのみで保持（リロードで消える。永続化はしない）
    let authToken = null;
    let authUsername = null;

    function setStatus(msg, cls) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = cls;
      el.style.display = 'block';
    }

    function showCode(code) {
      const box = document.getElementById('code-box');
      document.getElementById('code-number').textContent = String(code);
      box.style.display = 'block';
    }

    function hideCode() {
      document.getElementById('code-box').style.display = 'none';
    }

    function render() {
      const loggedIn = !!authToken;
      document.getElementById('auth-section').style.display = loggedIn ? 'none' : 'block';
      document.getElementById('logged-in-section').style.display = loggedIn ? 'block' : 'none';
      if (loggedIn) {
        document.getElementById('welcome-text').textContent = authUsername + ' としてログイン中';
        loadCredentials();
      }
    }

    function setSession(token, username) {
      authToken = token;
      authUsername = username;
      render();
    }

    async function loadCredentials() {
      const res = await fetch('/credentials', {
        headers: { 'Authorization': 'Bearer ' + authToken },
      });
      if (!res.ok) return;
      const { credentials } = await res.json();
      const list = document.getElementById('cred-list');
      list.innerHTML = '';
      if (credentials.length === 0) {
        list.innerHTML = '<p style="color:#888;font-size:14px;">まだパスキーが登録されていません</p>';
        return;
      }
      for (const cred of credentials) {
        const item = document.createElement('div');
        item.className = 'cred-item';
        const idShort = cred.id.slice(0, 16) + '...';
        const label = document.createElement('span');
        label.textContent = idShort + (cred.backedUp ? ' (同期済み)' : '');
        item.appendChild(label);
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '削除';
        delBtn.onclick = () => deleteCredential(cred.id);
        item.appendChild(delBtn);
        list.appendChild(item);
      }
    }

    async function deleteCredential(credentialId) {
      const res = await fetch('/credentials/' + encodeURIComponent(credentialId), {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + authToken },
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus('削除エラー: ' + (body.error || res.status), 'rejected');
        return;
      }
      loadCredentials();
    }

    window.signup = async () => {
      const username = document.getElementById('auth-username').value.trim();
      const password = document.getElementById('auth-password').value;
      try {
        const res = await fetch('/auth/signup', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username, password }),
        });
        const body = await res.json();
        if (!res.ok) { setStatus('登録エラー: ' + body.error, 'rejected'); return; }
        setSession(body.authToken, username);
        setStatus('新規登録が完了しました。続けてパスキーを追加登録できます。', 'approved');
      } catch (err) {
        setStatus('エラー: ' + err.message, 'rejected');
      }
    };

    window.login = async () => {
      const username = document.getElementById('auth-username').value.trim();
      const password = document.getElementById('auth-password').value;
      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username, password }),
        });
        const body = await res.json();
        if (!res.ok) { setStatus('ログインエラー: ' + body.error, 'rejected'); return; }
        setSession(body.authToken, username);
        setStatus('ログインしました。', 'approved');
      } catch (err) {
        setStatus('エラー: ' + err.message, 'rejected');
      }
    };

    window.logout = async () => {
      await fetch('/auth/logout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ authToken }),
      }).catch(() => {});
      authToken = null;
      authUsername = null;
      render();
      setStatus('ログアウトしました。', 'approved');
    };

    window.addPasskey = async () => {
      try {
        setStatus('パスキーを登録中...', 'waiting');
        const beginRes = await fetch('/registration/begin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken,
          },
          body: JSON.stringify({ username: authUsername }),
        });
        const beginBody = await beginRes.json();
        if (!beginRes.ok) { setStatus('登録エラー: ' + beginBody.error, 'rejected'); return; }

        const { sessionId, ...optionsJSON } = beginBody;
        const credential = await startRegistration({ optionsJSON });

        const completeRes = await fetch('/registration/complete', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username: authUsername, credential, sessionId }),
        });
        const completeBody = await completeRes.json();
        if (!completeRes.ok || !completeBody.verified) {
          setStatus('登録エラー: ' + (completeBody.error || '検証に失敗しました'), 'rejected');
          return;
        }
        setStatus('パスキーを登録しました。', 'approved');
        loadCredentials();
      } catch (err) {
        setStatus('エラー: ' + err.message, 'rejected');
      }
    };

    async function pollApproval(approvalId) {
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/authentication/approval-status?approvalId=' + approvalId);
          const { status, username } = await res.json();
          if (status === 'approved') {
            clearInterval(pollTimer);
            hideCode();
            document.getElementById('btn').disabled = false;
            setStatus('ログイン成功！ ' + username + ' としてサインインしました。', 'approved');
          } else if (status === 'rejected') {
            clearInterval(pollTimer);
            hideCode();
            document.getElementById('btn').disabled = false;
            setStatus('ログインが拒否されました。', 'rejected');
          } else if (status === 'expired') {
            clearInterval(pollTimer);
            hideCode();
            document.getElementById('btn').disabled = false;
            setStatus('承認がタイムアウトしました。再度お試しください。', 'rejected');
          }
        } catch {}
      }, 1500);
    }

    window.beginAuth = async () => {
      const username = document.getElementById('username').value.trim() || undefined;
      document.getElementById('btn').disabled = true;
      setStatus('パスキーで認証中...', 'waiting');
      try {
        const opts = await fetch('/authentication/begin', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username }),
        }).then(r => r.json());

        const { sessionId, ...optionsJSON } = opts;
        if (optionsJSON.allowCredentials) {
          optionsJSON.allowCredentials = optionsJSON.allowCredentials.map(c => ({ ...c, transports: ['hybrid'] }));
        }

        const credential = await startAuthentication({ optionsJSON });
        const result = await fetch('/authentication/complete', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ credential, sessionId }),
        }).then(r => r.json());
        if (result.approvalId) {
          showCode(result.code);
          setStatus('スマートフォンアプリで数字を選択して承認してください...', 'waiting');
          pollApproval(result.approvalId);
        } else if (result.verified) {
          document.getElementById('btn').disabled = false;
          setStatus('認証完了（直接モード）', 'approved');
          // no-push分岐のみ authToken が返る。push-approval分岐（result.approvalId経由）では
          // セキュリティ上の理由により authToken を発行しない（詳細は docs/design 参照）
          if (result.authToken) {
            setSession(result.authToken, username || '(usernameless)');
          }
        } else {
          document.getElementById('btn').disabled = false;
          setStatus('エラー: ' + JSON.stringify(result), 'rejected');
        }
      } catch (err) {
        document.getElementById('btn').disabled = false;
        setStatus('エラー: ' + err.message, 'rejected');
      }
    };

    render();
  </script>
</body>
</html>`);
});

async function sendApprovalPushNotification(
  token: string,
  username: string,
  approvalId: string,
): Promise<void> {
  console.log('[push] 承認リクエスト送信開始:', token);
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'ログインリクエスト',
      body: 'ログインリクエストがあります',
      data: { approvalId, username },
      priority: 'high',
      channelId: 'default',
    }),
  });
  const result = await res.json();
  console.log('[push] 送信結果:', JSON.stringify(result));
}

if (require.main === module) {
  const PORT = process.env['PORT'] ?? 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('ADB port forwarding: adb reverse tcp:3000 tcp:3000');
  });
}
