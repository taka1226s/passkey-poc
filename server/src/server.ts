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

// デバッグキーストアの APK ハッシュ（keytool の SHA-256 を Base64URL 変換）
const ANDROID_APK_HASH =
  process.env['ANDROID_APK_HASH'] ?? '-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w';
const ORIGIN_ANDROID = `android:apk-key-hash:${ANDROID_APK_HASH}`;

// Digital Asset Links 用（コロン区切り大文字）
const ANDROID_SHA256_FINGERPRINT =
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
const ANDROID_PACKAGE_NAME = 'com.anonymous.app';

function allowedOrigins(): string[] {
  return [ORIGIN_WEB, ORIGIN_LOCAL, ORIGIN_ANDROID];
}

export const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Digital Asset Links（Android Credential Manager の検証に必須）
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

  store.setChallenge(username, options.challenge);
  res.json(options);
});

app.post('/registration/complete', async (req, res) => {
  const { username, credential } = req.body as {
    username?: string;
    credential?: RegistrationResponseJSON;
  };
  if (!username || !credential) {
    res.status(400).json({ error: 'username と credential は必須です' });
    return;
  }

  const user = store.getUser(username);
  if (!user?.currentChallenge) {
    res.status(400).json({ error: '先に /registration/begin を呼び出してください' });
    return;
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: user.currentChallenge,
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
    res.status(400).json({ error: String(err) });
  }
});

app.post('/authentication/begin', async (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username) {
    res.status(400).json({ error: 'username は必須です' });
    return;
  }

  const user = store.getUser(username);
  if (!user || user.credentials.length === 0) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID: RPID,
    userVerification: 'required',
    allowCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
  });

  store.setChallenge(username, options.challenge);
  res.json(options);
});

app.post('/authentication/complete', async (req, res) => {
  const { username, credential } = req.body as {
    username?: string;
    credential?: AuthenticationResponseJSON;
  };
  if (!username || !credential) {
    res.status(400).json({ error: 'username と credential は必須です' });
    return;
  }

  const user = store.getUser(username);
  if (!user?.currentChallenge) {
    res.status(400).json({ error: '先に /authentication/begin を呼び出してください' });
    return;
  }

  const storedCred = user.credentials.find((c) => c.id === credential.id);
  if (!storedCred) {
    res.status(404).json({ error: 'クレデンシャルが見つかりません' });
    return;
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: user.currentChallenge,
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

    store.updateCounter(username, storedCred.id, verification.authenticationInfo.newCounter);
    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// クロスデバイス認証（AC-3）用の簡易 HTML ページ
app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>Passkey PoC</title></head>
<body>
  <h1>Passkey PoC - クロスデバイス認証テスト</h1>
  <input id="username" placeholder="username" />
  <button onclick="beginAuth()">パスキーでサインイン</button>
  <pre id="result"></pre>
  <script type="module">
    import { startAuthentication } from 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13/esm/index.js';
    window.beginAuth = async () => {
      const username = document.getElementById('username').value;
      const opts = await fetch('/authentication/begin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username }),
      }).then(r => r.json());
      const credential = await startAuthentication({ optionsJSON: opts });
      const result = await fetch('/authentication/complete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, credential }),
      }).then(r => r.json());
      document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    };
  </script>
</body>
</html>`);
});

if (require.main === module) {
  const PORT = process.env['PORT'] ?? 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('ADB port forwarding: adb reverse tcp:3000 tcp:3000');
  });
}
