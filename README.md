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

1. PC の Chrome でバナーに表示された URL を開く
2. AC-1 で登録したユーザー名を入力して「パスキーでサインイン」をクリック
3. ブラウザに QR コードが表示される
4. Android でカメラアプリを起動して QR コードをスキャンする
5. Android で生体認証を完了する
6. ブラウザに `{"verified": true}` が表示されれば成功

### AC-3（アプリ内 QR スキャナー経由）

アプリ内スキャナーを使うと、認証完了後にアプリへ自動遷移します。

1. アプリでユーザー名を入力する
2. 「QR でサインイン（別デバイス）」をタップ
3. アプリ内カメラが開く
4. PC ブラウザの QR コードをスキャンする
5. 「生体認証を完了してください」画面が表示される
6. Credential Manager で生体認証を完了する
7. アプリに戻り「クロスデバイス認証が完了しました」と表示される

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

## CTAP2 Hybrid における BLE の挙動

### 仕様上の役割

CTAP2 Hybrid（caBLE）では BLE は**近接確認（Proximity Verification）**に使用されます。QR コードをスキャンした端末が物理的に近くにいることを暗号的に保証し、中間者攻撃（MITM）を防ぐことが目的です。

### 実際の通信経路

認証データの転送は BLE ではなく **Google の中継サーバー経由の HTTPS** で行われます。

```
Chrome ─── HTTPS ──→ Google Tunnel Server ←── HTTPS ─── Android
                     （caBLE relay）
           BLE（近接確認のみ・任意）
```

### 検証結果

Android の Bluetooth をオフにした状態で QR コードをスキャンすると、BLE の有効化を求めるプロンプトが表示されます。これを**拒否しても認証が成功**することを確認しました。

Google の実装では BLE は任意であり、拒否した場合は Cloud Tunnel のみで認証が完了します。

| BLE の状態 | 動作 | 近接確認 |
|-----------|------|---------|
| ON | Cloud Tunnel + BLE 近接確認 | あり |
| OFF（拒否） | Cloud Tunnel のみ | **なし** |

### BLE を必須化できるか

**WebAuthn 仕様および現在の Google 実装では、RP（サーバー側）から BLE を必須にする手段はありません。**

WebAuthn のレスポンスには BLE が使われたかどうかの情報が含まれないため、サーバーは判断できません。BLE の強制は Chrome と Android Credential Manager の実装に委ねられており、現状 Google はこれを任意としています。

本番プロダクトでクロスデバイス認証を採用する場合、BLE 近接確認はベストエフォートであり保証されないことを設計に織り込む必要があります。

---

## パスキー・認証分野における BLE の位置づけ

### FIDO Alliance の立場

FIDO2 仕様では BLE は「トランスポート」の一つとして定義されていますが、**認証保証レベル（AAL: Authenticator Assurance Level）には影響しません**。

AAL を決める要素は以下であり、BLE は含まれません。

| 要素 | AAL への影響 |
|------|------------|
| 秘密鍵の保管場所（TPM / Secure Enclave） | あり |
| 生体認証・PIN によるユーザー検証 | あり |
| デバイスバインディング | あり |
| BLE 近接確認 | **なし** |

### 主要プラットフォームの方針

| プラットフォーム | BLE の扱い |
|----------------|-----------|
| Google（Android） | 任意。Cloud Tunnel のみでも認証成立（本 PoC で実証） |
| Apple（iOS / macOS） | AirDrop 等では使うが、パスキー認証フローでは BLE に依存しない |
| Microsoft（Windows Hello） | Phone Sign-in で補助的に使用 |

### パスキーの本質的な強度

パスキーが「フィッシングに強い」理由は BLE ではなく **origin 検証**にあります。

```
正規サイト (example.com) → RPID と一致 → 署名検証成功
偽サイト   (evil.com)    → RPID 不一致 → 署名検証失敗
```

BLE が防ごうとしているのはこれとは別の攻撃です。

```
BLE が対象とする攻撃:
  QRLjacking（QR コードを取得して遠隔地からスキャン）

BLE がなくても防げる攻撃:
  通常のフィッシング（偽サイトで認証させる）
```

### NIST SP 800-63B での位置づけ

米国 NIST の認証ガイドラインでは BLE は認証要素として定義されていません。

| 要素 | NIST の認定 |
|------|-----------|
| パスキー（秘密鍵） | 所持要素として認定 |
| 生体認証 | 生体要素として認定 |
| BLE 近接確認 | **認証要素として未定義** |

### 結論

パスキー・認証分野において BLE は「認証強度を上げるもの」ではなく、**「物理的な操作文脈を補足するオプショナルなシグナル」**として扱われています。

パスキーの本質的な強度は**秘密鍵の非エクスポータビリティと origin 検証**にあり、BLE はその強度に寄与しません。CTAP2 Hybrid に BLE が含まれているのは QRLjacking への対策ですが、Google の実装が示す通り業界としても BLE をハードゲートにするコンセンサスは形成されていません。

---

## QRLjacking への対策状況

### QRLjacking とは

攻撃者が自分のブラウザで生成した QR コードを被害者にスキャンさせ、攻撃者のセッションで認証を完了させる攻撃です。

```
1. 攻撃者が /authentication/begin を呼び出して QR コードを取得
2. QR コードをフィッシングページに埋め込む
3. 被害者がスキャンして生体認証を完了
4. 攻撃者のブラウザセッションで認証完了
```

### BLE が任意の現状での対策状況

**BLE が任意の現状では QRLjacking を完全には防げません。**

| 保護 | 有効か | 理由 |
|------|--------|------|
| QR の短期失効 | 部分的 | 有効期限内なら攻撃可能 |
| origin 検証 | 部分的 | 正規 RP へ攻撃者がセッションを開始すれば突破できない |
| ワンタイムチャレンジ | 部分的 | 新しい QR を都度生成すれば回避可能 |
| BLE 近接確認 | **無効** | Google 実装では任意・拒否しても認証成立（本 PoC で実証） |

origin 検証は「偽サイトへの認証」は防ぎますが、「正規サイトへの認証を攻撃者が誘導する」パターンは防げません。

### 現実的な脅威レベル

QRLjacking の実行には以下がすべて必要であり、難易度は高いです。

- ユーザー名（メールアドレス等）を知っている
- フィッシングページを構築できる
- 被害者が QR コードをスキャンするよう誘導できる
- QR の有効期限内に完了させられる

Google が BLE を任意にしているのは、これらの条件を考慮した上で実用上のリスクは許容範囲と判断しているためと考えられます。

---

## Apple の見解と実装の比較

Apple は Google と根本的に異なるアプローチで QRLjacking 問題を回避しています。

### Apple のクロスデバイス認証（Continuity）

Apple デバイス間では CTAP2 の QR コードフローを使わず、独自の **Continuity** 技術を使います。

```
Mac Safari での認証
  ↓
近くの iPhone に通知（QR コードなし）
  ↓
iPhone で Face ID / Touch ID
  ↓
BLE + Wi-Fi で近接確認（両方必須）
  ↓
Mac で認証完了
```

BLE と Wi-Fi の両方で近接を確認するため、遠隔地からの QRLjacking は物理的に成立しません。

### Google との設計思想の比較

| | Apple | Google |
|---|---|---|
| クロスデバイスの仕組み | Continuity（独自） | CTAP2 Hybrid（QR） |
| BLE | **必須**（Wi-Fi との併用） | 任意 |
| QR コード | 使わない（Apple デバイス間） | 使う |
| QRLjacking 耐性 | **高い** | 低い |
| 他プラットフォームとの相互運用 | 限定的 | 高い |

Apple の答えは「QR コードを使わない設計」であり、BLE を任意にして相互運用性を優先した Google とは設計思想が異なります。

### まとめ

| 観点 | Apple | Google |
|------|-------|--------|
| セキュリティ強度（QRLjacking） | 高い | 低い |
| 相互運用性（非 Apple 端末） | 限定的 | 高い |
| BLE の位置づけ | ハードゲート | オプショナルシグナル |

どちらが正しいかはユースケース次第です。クローズドなエコシステム内で高いセキュリティを求めるなら Apple、幅広いデバイス対応を求めるなら Google のアプローチが適しています。

---

## アプリ内 QR スキャナーの設計と制約

### ネイティブカメラからの動線を制御できない理由

FIDO:// URI のハンドリングは Google Play Services（Credential Manager）がシステムレベルで排他的に登録しています。

```
ネイティブカメラで FIDO:// QR をスキャン
  ↓
Android OS の Intent ルーティング
  ↓
Google Play Services が排他ハンドラとして処理（chooser 表示なし）
  ↓
アプリへの関与・通知なし
```

アプリが FIDO:// の intent-filter を AndroidManifest に登録しても、GMS が優先ハンドラとして機能するため chooser が表示されず、アプリは起動されません（本 PoC で実証済み）。

### 認証完了後のアプリ遷移の制約

| スキャン動線 | 認証完了後のアプリ遷移 | 理由 |
|------------|---------------------|------|
| アプリ内 QR スキャナー | **自動遷移する** | ポーリング中のため検知可能 |
| ネイティブカメラ | **遷移しない** | アプリがフローに関与しない |

ネイティブカメラからの動線で認証完了後にアプリへ遷移させるには、**プッシュ通知（FCM 等）**が必要です。

```
PC ブラウザ → /authentication/complete → サーバー
  ↓
FCM でデバイスに Push 通知
  ↓
アプリが通知を受け取り起動・遷移
```

これは PoC の範囲外のため未実装です。

### ポーリングの仕組み

アプリ内 QR スキャナー経由の場合、以下の仕組みで認証完了を検知します。

```
QR スキャン → Credential Manager に FIDO:// URI を渡す
  ↓
アプリは 1 秒間隔で /authentication/status をポーリング
  ↓
PC ブラウザが /authentication/complete を呼ぶ
  ↓
サーバーが lastAuthenticatedAt を記録
  ↓
ポーリングで authenticated: true を検出 → アプリに遷移
```

Credential Manager はボトムシートで表示されるためアプリが background に遷移せず、`AppState` の変更イベントは発火しません。このため AppState ではなく定期ポーリングを採用しています。タイムアウトは 60 秒です。

---

## 注意事項

- サーバーはインメモリストアを使用しているため、**再起動するとユーザーデータが消えます**。再起動後は AC-1 からやり直してください。
- Cloudflare Quick Tunnel は起動のたびに URL が変わりますが、`npm run dev` が自動検出して RPID に反映します。
- `npx expo run:android` で再ビルドすると APK が再署名され、APK ハッシュが変わる場合があります。その場合は `app/android/app/debug.keystore` を固定して使い続けてください。
- AC-3 テストは PC の Chrome 推奨です（Safari は CTAP2 Hybrid の対応状況が異なります）。
- アプリ内 QR スキャナーでクロスデバイス認証を行う場合は、スキャン前にユーザー名を入力してください（ポーリングにユーザー名が必要です）。
