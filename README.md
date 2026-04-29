# Passkey PoC

Android 実機でパスキー（FIDO2/WebAuthn）認証を検証するための PoC です。

## 検証項目

| ID | 内容 | 状態 |
|----|------|------|
| AC-1 | Android アプリでパスキーを登録する | 完了 |
| AC-2 | 同一デバイスでパスキー認証する | 完了 |
| AC-3 | PC ブラウザから Android の QR コード経由で認証する（CTAP2 Hybrid） | 完了 |

---

## 構成

```
passkey-poc/
├── app/          # React Native（Expo bare）アプリ
├── server/       # Express + @simplewebauthn/server
└── scripts/
    └── tunnel-server.js  # Cloudflare URL 自動検出 & サーバー起動スクリプト
```

### 技術スタック

| 層 | 技術 |
|----|------|
| Android アプリ | React Native 0.81 / Expo 54 / TypeScript |
| パスキー操作 | react-native-passkey 3.3.3（Android Credential Manager） |
| サーバー | Node.js / Express 5 / TypeScript |
| WebAuthn 検証 | @simplewebauthn/server 13 |
| HTTPS トンネル | Cloudflare Quick Tunnel（cloudflared） |

---

## 前提条件

- macOS（Apple Silicon / Intel）
- Node.js 18 以上
- Android 実機（Android 9 以上、Google アカウントでサインイン済み）
- USB ケーブル（USB デバッグ有効）
- 以下がインストール済み

```bash
brew install cloudflared android-platform-tools
```

- Java 17（Gradle ビルド用）

```bash
brew install openjdk@17
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## セットアップ

### 1. 依存パッケージのインストール

```bash
# ルート
npm install

# サーバー
cd server && npm install && cd ..

# アプリ
cd app && npm install && cd ..
```

### 2. アプリのビルドとインストール

Android 実機を USB で接続した状態で実行します。

```bash
cd app
npx expo run:android
cd ..
```

> ビルドは初回のみ必要です。JS の変更は Metro の Hot Reload で反映されます。

---

## 起動

```bash
npm run dev
```

以下が自動で起動します。

| プロセス | 内容 |
|---------|------|
| `adb reverse tcp:3000 tcp:3000` | Android → Mac の localhost をトンネル |
| Cloudflare トンネル | HTTPS 公開 URL を発行 |
| Express サーバー | RPID を自動検出した URL にセットして起動 |
| Expo Metro | JS バンドルサーバー |

URL が発行されると以下のバナーが表示されます。

```
────────────────────────────────────────────────────────────
  AC-3 クロスデバイス認証テスト URL
  https://xxxx-yyyy-zzzz.trycloudflare.com
────────────────────────────────────────────────────────────
```

---

## 使い方

### AC-1：パスキー登録（Android アプリ）

1. アプリを開く
2. ユーザー名を入力して「パスキーを登録」をタップ
3. 生体認証（指紋 / 顔認証）を完了する
4. 「登録が完了しました」と表示されれば成功

### AC-2：同一デバイス認証（Android アプリ）

1. AC-1 と同じユーザー名を入力して「パスキーでサインイン」をタップ
2. 生体認証を完了する
3. 「認証が完了しました」と表示されれば成功

### AC-3：クロスデバイス認証（PC ブラウザ + Android）

> Bluetooth を両デバイスでオンにしてください。

1. PC の Chrome でバナーに表示された URL を開く
2. AC-1 で登録したユーザー名を入力して「パスキーでサインイン」をクリック
3. ブラウザに QR コードが表示される
4. Android でカメラアプリを起動して QR コードをスキャンする
5. Android で生体認証を完了する
6. ブラウザに `{"verified": true}` が表示されれば成功

---

## アーキテクチャ

### 通信フロー

```
[Android アプリ]
     |
     | HTTP（adb reverse）
     v
[Express サーバー :3000]
     |
     | HTTPS（Cloudflare トンネル）
     v
[PC ブラウザ / Credential Manager]
```

### Android アプリの API 通信

アプリは常に `http://localhost:3000` を使用します（USB + adb reverse 経由）。

```
Android アプリ → localhost:3000 → [adb reverse] → Mac localhost:3000
```

### RPID と Digital Asset Links

Android Credential Manager はパスキー操作時に RPID の Digital Asset Links を検証します。

```
Credential Manager → https://<RPID>/.well-known/assetlinks.json
```

このため RPID には HTTPS で公開されている Cloudflare URL を使用します。

### APK 署名と Origin 検証

パスキー登録・認証のレスポンスには以下の origin が含まれます。

```
android:apk-key-hash:<Base64URL-encoded-SHA256>
```

サーバーはこの値を `app/android/app/debug.keystore` の SHA-256 フィンガープリントと照合します。

| 項目 | 値 |
|------|-----|
| キーストア | `app/android/app/debug.keystore` |
| SHA-256 | `FA:C6:17:...:3B:9C` |
| Base64URL | `-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w` |

---

## 注意事項

- サーバーはインメモリストアを使用しているため、**再起動するとユーザーデータが消えます**。再起動後は AC-1 からやり直してください。
- Cloudflare Quick Tunnel は起動のたびに URL が変わりますが、`npm run dev` が自動検出して RPID に反映します。
- `npx expo run:android` で再ビルドすると APK が再署名され、APK ハッシュが変わる場合があります。その場合は `app/android/app/debug.keystore` を固定して使い続けてください。
- AC-3 テストは PC の Chrome 推奨です（Safari は CTAP2 Hybrid の対応状況が異なります）。
