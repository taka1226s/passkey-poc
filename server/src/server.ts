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

export const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/push-token', (req, res) => {
  const { username, token } = req.body as { username?: string; token?: string };
  if (!username || !token) {
    res.status(400).json({ error: 'username と token は必須です' });
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

// ---- 登録フロー ----

app.post('/registration/begin', async (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username) {
    res.status(400).json({ error: 'username は必須です' });
    return;
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

    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ error: '登録の検証に失敗しました' });
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
    const ipAddress = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const approval = store.createApproval(user.username, {
      pushToken: pushToken ?? undefined,
      ipAddress,
      userAgent,
    });

    setTimeout(() => {
      const a = store.getApproval(approval.id);
      if (a?.status === 'pending') store.updateApprovalStatus(approval.id, 'expired');
    }, APPROVAL_TIMEOUT_MS);

    if (pushToken) {
      sendApprovalPushNotification(pushToken, user.username, approval.id, approval.sessionToken).catch(() => {});
    }

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
      sessionToken: approval.sessionToken,
    },
  });
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
  if (selectedCode !== approval.code) {
    res.status(400).json({ error: 'コードが一致しません' });
    return;
  }
  store.updateApprovalStatus(approvalId, 'approved');
  store.recordAuthentication(approval.username);
  res.json({ ok: true });
});

app.post('/authentication/reject', (req, res) => {
  const { approvalId, sessionToken } = req.body as {
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
  store.updateApprovalStatus(approvalId, 'rejected');
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
  res.json({ authenticated, lastAuthenticatedAt });
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
    button { width: 100%; padding: 12px; font-size: 16px; background: #007AFF; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
    button:disabled { opacity: 0.5; }
    #status { margin-top: 20px; padding: 14px; border-radius: 8px; display: none; }
    .waiting { background: #fff3cd; }
    .approved { background: #d4edda; }
    .rejected { background: #f8d7da; }
    #code-box { display: none; text-align: center; margin: 16px 0; padding: 20px; background: #1a1a2e; border-radius: 12px; }
    #code-number { font-size: 64px; font-weight: bold; letter-spacing: 8px; color: #fff; font-family: monospace; }
    #code-label { font-size: 12px; color: #aaa; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Passkey PoC</h1>
  <input id="username" placeholder="ユーザー名（任意）" />
  <button id="btn" onclick="beginAuth()">パスキーでサインイン</button>
  <div id="code-box">
    <div id="code-label">スマートフォンに表示された番号を選択してください</div>
    <div id="code-number">--</div>
  </div>
  <div id="status"></div>
  <script type="module">
    import { startAuthentication } from 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13/esm/index.js';

    let pollTimer = null;

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
        } else {
          document.getElementById('btn').disabled = false;
          setStatus('エラー: ' + JSON.stringify(result), 'rejected');
        }
      } catch (err) {
        document.getElementById('btn').disabled = false;
        setStatus('エラー: ' + err.message, 'rejected');
      }
    };
  </script>
</body>
</html>`);
});

async function sendApprovalPushNotification(
  token: string,
  username: string,
  approvalId: string,
  sessionToken: string,
): Promise<void> {
  console.log('[push] 承認リクエスト送信開始:', token);
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'ログインリクエスト',
      body: `${username} としてのログインリクエストがあります`,
      data: { approvalId, username, sessionToken },
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
