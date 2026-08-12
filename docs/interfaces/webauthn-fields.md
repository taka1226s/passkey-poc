# WebAuthn インタフェース項目

`@simplewebauthn/server`（サーバー）・`@simplewebauthn/browser`（Web）・`react-native-passkey`（アプリ）が扱う WebAuthn の各データ構造について、このリポジトリでどのフィールドを・どんな値で・何のために使っているかを整理したドキュメント。

対象読者: WebAuthn オプション生成・検証ロジック（`server.ts` の登録/認証処理）を変更・調査する人。関連: [server-api.md](./server-api.md)（HTTPインタフェース）、[os-integration.md](./os-integration.md)（OS連携）。

## 1. 登録オプション生成（`generateRegistrationOptions`）

`server.ts:180-194`（`POST /registration/begin`）

| パラメータ | 値 | 用途 |
|---|---|---|
| `rpName` | `'Passkey PoC'`（定数 `RP_NAME`） | Relying Party の表示名（OS のパスキーUIに表示） |
| `rpID` | `RPID`（`.env`、ngrok固定ドメイン） | このパスキーが有効なドメイン。認証時の `rpID` と一致しないと使えない |
| `userName` | リクエストの `username` | ユーザーの識別名（OS のアカウント選択UIに表示） |
| `userID` | `store.getOrCreateUser(username).id`（内部生成のランダムID） | WebAuthn仕様上の `user.id`。**username文字列そのものではなく分離したハンドル**を使う設計（usernameの変更・漏洩とは独立させるための一般的プラクティス） |
| `attestationType` | `'none'` | 端末のアテステーション（製造元証明）を要求しない。PoCでは端末の真正性証明までは不要と判断 |
| `excludeCredentials` | 既存 `user.credentials` の `{ id, transports }` 一覧 | 同一authenticatorでの重複登録を防ぐ（OS側が既存クレデンシャルなら登録UIを出さない） |
| `authenticatorSelection.residentKey` | `'required'` | ディスカバラブルクレデンシャル必須化。usernameless認証（`authentication/begin`でusername省略）を可能にする前提 |
| `authenticatorSelection.userVerification` | `'required'` | 生体認証・PIN等のユーザー検証を必須化（単なる端末所持だけでは不可） |

## 2. Options オブジェクトの完全な構造（実測値）

`generateRegistrationOptions`/`generateAuthenticationOptions`（`@simplewebauthn/server` 13.x）が実際に生成する JSON を、このプロジェクトの入力値（1.・3.のパラメータ）で実行して確認した結果。`POST /registration/begin`・`POST /authentication/begin` のレスポンスとしてそのままクライアントへ返る（`sessionId` はサーバー独自の付加フィールド）。

### 2-1. 登録オプション（`PublicKeyCredentialCreationOptionsJSON`）

```json
{
  "challenge": "OjAhrEbt4QuLRUN68dodBvfxX3eiLCw6ysxHNdED1IA",
  "rp": { "name": "Passkey PoC", "id": "example.ngrok-free.app" },
  "user": { "id": "ZHVtbXktdXNlci1pZA", "name": "alice", "displayName": "" },
  "pubKeyCredParams": [
    { "alg": -8, "type": "public-key" },
    { "alg": -7, "type": "public-key" },
    { "alg": -257, "type": "public-key" }
  ],
  "timeout": 60000,
  "attestation": "none",
  "excludeCredentials": [
    { "id": "existing-cred-id", "transports": ["internal"], "type": "public-key" }
  ],
  "authenticatorSelection": {
    "residentKey": "required",
    "userVerification": "required",
    "requireResidentKey": true
  },
  "extensions": { "credProps": true },
  "hints": []
}
```

| フィールド | このプロジェクトでの値 | 意味・由来 |
|---|---|---|
| `challenge` | ランダム生成（Base64URL） | 1回限りのチャレンジ。`ChallengeSession` に保存し `expectedChallenge` として照合（[照合関係](#7-照合関係登録時)参照） |
| `rp.name` / `rp.id` | `RP_NAME` / `RPID` | 入力パラメータ `rpName`/`rpID` がそのまま反映される |
| `user.id` | `store.getOrCreateUser().id`（Base64URLエンコード済み） | 入力の `userID` がエンコードされたもの |
| `user.name` | リクエストの `username` | 入力の `userName` |
| `user.displayName` | `''`（常に空文字） | 入力パラメータで指定していないため既定値。OSのUIで表示名として使われうるが本プロジェクトでは未設定 |
| `pubKeyCredParams` | `[Ed25519(-8), ES256(-7), RS256(-257)]` の固定3種 | **入力パラメータでは指定していない＝ライブラリの既定値**。対応authenticatorが多い順に優先度づけされたアルゴリズム一覧。OS/authenticator側がこの中から対応するものを選ぶ |
| `timeout` | `60000`（60秒） | **入力パラメータでは指定していない＝既定値**。UIでの操作待ちタイムアウト |
| `attestation` | `'none'` | 入力の `attestationType` がそのまま反映される |
| `excludeCredentials[].type` | `'public-key'`（固定） | 入力では `id`/`transports` のみ指定、`type` はライブラリが自動付与 |
| `authenticatorSelection.requireResidentKey` | `true` | **入力パラメータでは指定していない＝ライブラリが `residentKey: 'required'` から自動導出**。古いブラウザ/OS向けの後方互換フィールド（`residentKey` と意味的に同じことを表す旧仕様のフィールド） |
| `extensions.credProps` | `true`（固定） | **入力パラメータでは指定していない＝ライブラリの既定値**。認証器に「作成したcredentialがディスカバラブル（resident key）かどうか」を結果に含めるよう要求する拡張。**react-native-passkeyの `PasskeyCreateRequest.extensions` はこの形状に対応しておらず（`largeBlob`/`prf`のみサポート）、アプリはこのフィールドを送信前に除去している**（2-3参照） |
| `hints` | `[]`（空配列） | **入力パラメータでは指定していない＝既定値**。ブラウザにUIヒント（`security-key`/`client-device`/`hybrid`等）を与える WebAuthn Level 3 の新フィールド。**react-native-passkeyの型に存在せず、アプリは送信前に除去している**（2-3参照） |

### 2-2. 認証オプション（`PublicKeyCredentialRequestOptionsJSON`）

```json
{
  "rpId": "example.ngrok-free.app",
  "challenge": "uEGiX1OoX2lQqSWmdl2x3QB1O0sREn9uAmEzBSTDuJI",
  "allowCredentials": [
    { "id": "existing-cred-id", "transports": ["internal"], "type": "public-key" }
  ],
  "timeout": 60000,
  "userVerification": "required"
}
```

| フィールド | このプロジェクトでの値 | 意味・由来 |
|---|---|---|
| `rpId` | `RPID` | 入力の `rpID`。登録時は `rp.id`（ネスト）だったのに対し、認証時は `rpId`（フラット）という**フィールド名・構造の違い**に注意 |
| `challenge` | ランダム生成 | 登録時と同様、`expectedChallenge` として照合 |
| `allowCredentials` | ユーザーの `credentials` から `{id, transports}` を抽出、`type: 'public-key'` はライブラリが自動付与。**未登録/username省略時は空配列** | 3.（認証オプション生成）参照。usernameless認証のキーとなるフィールド |
| `timeout` | `60000` | 登録時と同じ既定値 |
| `userVerification` | `'required'` | 入力パラメータがそのまま反映 |

`extensions`/`hints` は入力パラメータを渡していないため、認証オプションの出力には含まれない（登録時は既定で付与されるのと対照的）。

### 2-3. `hints`・`extensions` を除去する理由（react-native-passkey側の型制約）

`app/src/hooks/usePasskey.ts:37` で `registrationBegin` の戻り値から `hints`/`extensions` を分解して除去している。`react-native-passkey`（`PasskeyTypes.d.ts`）の `PasskeyCreateRequest` 型を確認すると:

- `hints` フィールド自体が存在しない（未対応）
- `extensions` は `{ largeBlob?, prf? }` のみ受け付ける形状で、`generateRegistrationOptions` が生成する `{ credProps: true }` とは非互換

そのままオブジェクトを渡すと余分なフィールドとして無視される可能性はあるが、型不整合を避けるため明示的に除去している。**Web側（`GET /` のインラインJS、`@simplewebauthn/browser`）はこの除去を行っていない**（ブラウザのネイティブ `navigator.credentials.create()` は標準準拠のため `hints`/`extensions` をそのまま渡せる）。

## 3. 登録検証（`verifyRegistrationResponse`）

`server.ts:226-231`（`POST /registration/complete`）

| パラメータ | 値 | 用途 |
|---|---|---|
| `response` | リクエストの `credential`（`RegistrationResponseJSON`） | クライアントが生成した登録レスポンス全体をライブラリに渡す（個別フィールドはサーバー側で分解しない） |
| `expectedChallenge` | チャレンジセッション（`registration/begin`で発行・保存）の `challenge` | リプレイ攻撃防止。セッションは1回限り消費（`store.deleteChallengeSession`） |
| `expectedOrigin` | `allowedOrigins()` → `[ORIGIN_WEB, ORIGIN_LOCAL, ORIGIN_ANDROID]` | どの経路（Web/localhost/Androidネイティブ）からの登録かに関わらず許可する origin 一覧。iOSはユニバーサルリンク経由で `ORIGIN_WEB` を共用 |
| `expectedRPID` | `RPID` | レスポンスの `rpIdHash` と照合 |

### 検証成功後、`registrationInfo` から取り出して保存するフィールド

`server.ts:238-246` → `store.addCredential()`

| フィールド | 由来 | 保存先・用途 |
|---|---|---|
| `credential.id` | `registrationInfo.credential.id` | `CredentialRecord.id`。以後の credential 検索・削除・`allowCredentials` 構築のキー |
| `credential.publicKey` | `registrationInfo.credential.publicKey` | `CredentialRecord.publicKey`。認証時の署名検証に使用（`verifyAuthenticationResponse` の `credential.publicKey`） |
| `credential.counter` | `registrationInfo.credential.counter` | `CredentialRecord.counter`。サインカウンタ初期値。クローン検出（巻き戻り検知）の基準値 |
| `credentialDeviceType` | `registrationInfo.credentialDeviceType`（`'singleDevice'` \| `'multiDevice'`） | `CredentialRecord.deviceType`。`GET /credentials` の一覧表示にも使用 |
| `credentialBackedUp` | `registrationInfo.credentialBackedUp`（boolean） | `CredentialRecord.backedUp`。iCloud Keychain等でクラウド同期済みかどうか。Web UIで「同期済み」表示に使用 |
| `transports` | `registrationInfo` **ではなく** `credential.response.transports ?? []`（クライアント生レスポンス） | `CredentialRecord.transports`。`registrationInfo` には含まれないフィールドのため、レスポンス生データから直接取得している点に注意 |

## 4. 認証オプション生成（`generateAuthenticationOptions`）

`server.ts:334-341`（`POST /authentication/begin`）

| パラメータ | 値 | 用途 |
|---|---|---|
| `rpID` | `RPID` | 登録時と同じ |
| `userVerification` | `'required'` | 登録時と同じ、生体認証必須 |
| `allowCredentials` | ユーザーが見つかれば `user.credentials` の `{ id, transports }` 一覧、見つからなければ `[]` | **ユーザー列挙対策**（A3/A4）: username不明・未登録のいずれでも同形式のレスポンスを返す。空配列はusernameless認証（OS側にディスカバラブルクレデンシャルから選ばせる）を意味する |

## 5. 認証検証（`verifyAuthenticationResponse`）

`server.ts:287-298`（`POST /authentication/complete` と `POST /registration/authorize` で共通のパターン）

| パラメータ | 値 | 用途 |
|---|---|---|
| `response` | リクエストの `credential`（`AuthenticationResponseJSON`） | 登録時と同様、個別フィールドは分解せずライブラリに渡す |
| `expectedChallenge` / `expectedOrigin` / `expectedRPID` | 登録時と同様 | 同上 |
| `credential` | DB保存済みの `{ id, publicKey, counter, transports }`（`storedCred`） | 署名検証・カウンタ比較の基準として、**サーバー側が保持する信頼済みの値**を渡す（クライアントの申告値は使わない） |

### 検証成功後、`authenticationInfo` から取り出すフィールド

`server.ts:306`

| フィールド | 用途 |
|---|---|
| `newCounter` | 検証後の新しいサインカウンタ値。`storedCred.counter` と比較し `newCounter <= storedCred.counter` ならクローン攻撃（巻き戻り）とみなして400エラー。問題なければ `store.updateCounter` で更新 |

## 6. `transports` フィールドの扱い（登録時・認証時・Web UIでの上書き）

| 場面 | 挙動 |
|---|---|
| 登録時（サーバー） | `verifyRegistrationResponse` の戻り値には含まれないため、**リクエスト生データ** `credential.response.transports`（optional、`?? []`）を直接保存する |
| 認証時（サーバー） | 保存済み `storedCred.transports` を `generateAuthenticationOptions` の `allowCredentials[].transports` と `verifyAuthenticationResponse` の `credential.transports` に渡す。**認証レスポンス自体が申告する transports は使わない** |
| Web UI（`GET /` のインラインJS） | `authentication/begin` が返した `allowCredentials[].transports` を、実際の保存値に関係なく**一律 `['hybrid']` に強制上書き**してから `startAuthentication()` に渡す（`server.ts:919-922`）。クロスデバイス（QRコード経由）でのサインインを常に選ばせるための意図的な上書き |
| アプリ（`usePasskey.ts` / `webauthnClient.ts`） | このような上書きは行わない。サーバーから返された `allowCredentials` をそのまま `Passkey.get()` に渡す |

## 7. 照合関係（登録時）

「誰が・いつ発行した値」と「誰が・いつ検証する値」の対応関係をシーケンス図で示す。

```mermaid
sequenceDiagram
    participant App as アプリ / Web
    participant OS as OS（Credential Manager<br/>/ AuthenticationServices）
    participant Server as Express サーバー
    participant Store as ChallengeSession<br/>（インメモリ）

    App->>Server: POST /registration/begin { username }
    Server->>Server: challenge 生成
    Server->>Store: 保存 { challenge, username, expiresAt }
    Server-->>App: { challenge, rpID, user, sessionId }

    App->>OS: Passkey.create(options)
    Note over OS: challenge・rpID・origin を<br/>clientDataJSON / attestationObject に埋め込み署名
    OS-->>App: RegistrationResponseJSON<br/>{ id, response: { clientDataJSON, attestationObject, transports } }

    App->>Server: POST /registration/complete<br/>{ username, credential, sessionId }
    Server->>Store: getChallengeSession(sessionId)

    rect rgb(255, 245, 220)
        Note over Server: 照合① session.username === body.username<br/>不一致ならセッション破棄・400
        Note over Server: 照合② clientDataJSON.challenge === session.challenge（expectedChallenge）
        Note over Server: 照合③ clientDataJSON.origin ∈ allowedOrigins()（expectedOrigin）
        Note over Server: 照合④ attestationObject.rpIdHash === sha256(RPID)（expectedRPID）
    end

    alt すべて一致
        Server->>Server: credential 保存<br/>{ id, publicKey, counter, deviceType, backedUp, transports }
        Server-->>App: { verified: true, deviceToken }
    else いずれか不一致
        Server-->>App: 400 エラー
    end
```

| # | 照合対象A（クライアント発行/埋め込み） | 照合対象B（サーバー側の期待値） | 検証箇所 | 不一致時 |
|---|---|---|---|---|
| ① | body の `username` | `ChallengeSession.username`（`begin`時に保存） | `server.ts`（`complete`冒頭） | セッション即破棄・400（M4対策） |
| ② | `clientDataJSON.challenge` | `session.challenge`（`expectedChallenge`） | `verifyRegistrationResponse` 内部 | 400 |
| ③ | `clientDataJSON.origin` | `allowedOrigins()`（`expectedOrigin`、Web/localhost/Androidネイティブの複数許可） | 同上 | 400 |
| ④ | `attestationObject` の `rpIdHash` | `sha256(RPID)`（`expectedRPID`） | 同上 | 400 |

## 8. 照合関係（認証時）

```mermaid
sequenceDiagram
    participant App as アプリ / Web
    participant OS as OS（Credential Manager<br/>/ AuthenticationServices）
    participant Server as Express サーバー
    participant DB as ユーザーストア<br/>（インメモリ）

    App->>Server: POST /authentication/begin { username? }
    Server->>DB: getUser(username)（あれば）
    Server->>Server: challenge 生成
    Note over Server: allowCredentials = ユーザーの credentials<br/>（未指定/未登録なら空配列＝usernameless）
    Server-->>App: { challenge, rpID, allowCredentials, sessionId }

    App->>OS: Passkey.get(options)
    Note over OS: allowCredentials の中から秘密鍵を検索し<br/>challenge・rpID・origin に署名
    OS-->>App: AuthenticationResponseJSON<br/>{ id, response: { clientDataJSON, authenticatorData, signature, userHandle } }

    App->>Server: POST /authentication/complete<br/>{ credential, sessionId }
    Server->>Server: getChallengeSession(sessionId)

    rect rgb(220, 235, 255)
        Note over Server,DB: 照合① credential.id → getUserByCredentialId でユーザー逆引き
        Note over Server: 照合② session.username（あれば） === 逆引きしたユーザーの username
    end

    Server->>DB: storedCred = user.credentials.find(id 一致)

    rect rgb(255, 245, 220)
        Note over Server: 照合③ clientDataJSON.challenge === session.challenge（expectedChallenge）
        Note over Server: 照合④ clientDataJSON.origin ∈ allowedOrigins()（expectedOrigin）
        Note over Server: 照合⑤ authenticatorData の rpIdHash === sha256(RPID)（expectedRPID）
        Note over Server: 照合⑥ signature を storedCred.publicKey で検証
        Note over Server: 照合⑦ newCounter > storedCred.counter（巻き戻り検出）
    end

    alt すべて一致
        Server->>DB: counter 更新・lastAuthenticatedAt 記録
        alt push token 未登録
            Server-->>App: { verified: true, authToken }
        else push token 登録済み
            Server-->>App: { approvalId, code }
        end
    else いずれか不一致
        Server-->>App: 400 / 404 エラー
    end
```

| # | 照合対象A | 照合対象B | 検証箇所 | 不一致時 |
|---|---|---|---|---|
| ① | `credential.id` | ユーザーストア全体を走査（`getUserByCredentialId`） | `server.ts`（`complete`冒頭） | 404（credential不存在） |
| ② | `session.username`（`begin`でusername指定時のみ存在） | ①で逆引きしたユーザーの `username` | 同上 | 400（M3対策：usernameless認証を悪用したなりすまし防止） |
| ③ | `clientDataJSON.challenge` | `session.challenge`（`expectedChallenge`） | `verifyAuthenticationResponse` 内部 | 400 |
| ④ | `clientDataJSON.origin` | `allowedOrigins()`（`expectedOrigin`） | 同上 | 400 |
| ⑤ | `authenticatorData` の `rpIdHash` | `sha256(RPID)`（`expectedRPID`） | 同上 | 400 |
| ⑥ | `signature` | `storedCred.publicKey`（**サーバーが保持する値**。クライアント申告の公開鍵は使わない） | 同上 | 400 |
| ⑦ | `newCounter`（検証後の新カウンタ値） | `storedCred.counter`（保存済みの旧カウンタ値） | `server.ts`（A6対策） | `newCounter <= storedCred.counter` なら400（クローン攻撃疑い） |

**設計上のポイント**: ③④⑤は登録時と同一の照合ロジックを共有する（`expectedChallenge`/`expectedOrigin`/`expectedRPID`という同じ枠組み）。登録時との違いは、①②（credential所有者の特定・usernameバインディング）と⑥⑦（公開鍵署名検証・カウンタ巻き戻り検出）が認証時特有の照合であること。⑥はライブラリ内部で行われるためサーバーコード上には現れないが、`credential: { publicKey: storedCred.publicKey, ... }` として**サーバー側の信頼済み値を明示的に渡している**ことが実質的な担保になっている。

## 9. usernameless 認証の仕組み

`authentication/begin` で `username` を省略した場合に、サーバーがユーザーを一切知らない状態からどう本人特定するかを、これまでの各セクションの部品を組み合わせて説明する。

```mermaid
sequenceDiagram
    participant App as アプリ / Web
    participant OS as OS（Credential Manager<br/>/ AuthenticationServices）
    participant Server as Express サーバー
    participant DB as ユーザーストア

    Note over App,Server: 前提: 登録時に residentKey: 'required' で<br/>resident key（ディスカバラブルクレデンシャル）として保存済み

    App->>Server: POST /authentication/begin { }（username省略）
    Server->>Server: allowCredentials = []（空配列）
    Server-->>App: { challenge, rpID, allowCredentials: [], sessionId }

    App->>OS: Passkey.get(options)
    Note over OS: allowCredentials が空なので<br/>このrpID向けに保存された resident key を<br/>OS側が自力で列挙してユーザーに選ばせる
    OS-->>App: AuthenticationResponseJSON<br/>{ id, response: { ... } }

    App->>Server: POST /authentication/complete { credential, sessionId }
    Server->>DB: getUserByCredentialId(credential.id)<br/>（ユーザーストア全体を線形探索）
    DB-->>Server: 該当ユーザー
    Note over Server: userHandle は使わず<br/>credential.id の逆引きだけで本人特定
    Server-->>App: 認証完了
```

### 成立条件と各ステップの対応

| ステップ | 条件・処理 | 対応するセクション |
|---|---|---|
| ① 登録時にresident key必須化 | `authenticatorSelection.residentKey: 'required'`。これにより「誰の・どのRP向けの鍵か」を**OS/authenticator自身が記憶**するcredentialになる（通常のcredentialはRP側がIDを覚えて都度提示する必要がある） | [1. 登録オプション生成](#1-登録オプション生成generateregistrationoptions) |
| ② `allowCredentials` を空にする | `username` 未指定 → `user` が見つからない → `allowCredentials: []` | [4. 認証オプション生成](#4-認証オプション生成generateauthenticationoptions) |
| ③ OSが自力でcredentialを列挙 | `allowCredentials` が空だと、OSは特定のcredential IDに絞らず、そのrpID向けに保存された全resident keyからユーザーに選ばせる（Android Credential Manager / iOS のアカウント選択UI） | [os-integration.md](./os-integration.md) |
| ④ credential.idのみで本人特定 | サーバーはusernameを一切受け取っていないが、レスポンスの `credential.id` を `getUserByCredentialId()` で全ユーザー走査し逆引きする | [8. 照合関係（認証時）の照合①](#8-照合関係認証時) |

### 補足: `userHandle` は使っていない

WebAuthn仕様では、認証レスポンスの `response.userHandle`（登録時に指定した `user.id`）を使ってユーザーを特定するのが一般的なパターンだが、このプロジェクトのサーバーコードには `userHandle` への参照が一切なく、**`credential.id` の総当たり逆引き（`store.ts` の `getUserByCredentialId`、Map全走査の線形探索）のみ**でユーザーを特定している。ユーザー数が増えると探索コストが線形に増加する点は、インメモリストアを使う本 PoC の規模では問題にならないが、本番相当のデータ量では `credential.id` → `username` の逆引きインデックスを別途持つ設計に切り替える必要がある。

### usernameless と通常認証（username指定あり）の挙動差

[8. 照合関係（認証時）](#8-照合関係認証時)の照合②（`session.username` とcredential所有者の一致確認）は、`username` を指定した場合のみ働く。usernameless時は `session.username` が存在しないため、この照合はスキップされる（＝サーバーは「credentialの持ち主が誰であるか」だけを信頼し、「呼び出し側が期待していた特定のusernameと一致するか」までは確認しない）。これは意図的な設計であり、usernameless認証の目的（クライアント側がusernameを知らない状態で始める）と整合する。

## 10. `RegistrationResponseJSON` / `AuthenticationResponseJSON` のフィールドアクセス方針

サーバー・アプリのいずれも、**レスポンスオブジェクト全体を検証ライブラリ（またはOS API）に丸ごと渡す**方針で、個別フィールド（`rawId`, `response.attestationObject`, `response.clientDataJSON`, `response.authenticatorData`, `response.signature`, `response.userHandle` 等）を明示的に取り出すことはしていない。例外的に個別アクセスしている箇所は以下のみ：

| 箇所 | フィールド | 用途 |
|---|---|---|
| `server.ts`（`registration/authorize`, `authentication/complete`） | `credential.id` | `store.getUserByCredentialId(credential.id)` によるユーザー逆引き |
| `server.ts:245`（`registration/complete`） | `credential.response.transports` | 上記6.参照 |
| `usePasskey.ts:37`（`registrationBegin` の戻り値） | `hints`, `extensions` を分解して除去 | `PublicKeyCredentialCreationOptionsJSON` 側のフィールドで、`react-native-passkey` に渡す前に取り除いている（除去理由のコメントはコード内になし） |
| Web UI（`server.ts:863`, `919`） | `sessionId` を分解して除去 | サーバー独自の付加フィールドのため、WebAuthn標準のoptionsオブジェクトから分離してから `startRegistration`/`startAuthentication` に渡す |

型定義上も、アプリ側（`webauthnClient.ts:3-4`）は `RegistrationResponseJSON` / `AuthenticationResponseJSON` を `Record<string, unknown>` として扱っており、TypeScript レベルでも個別フィールドへの型付きアクセスはしていない。

## 関連ドキュメント

- サーバーインタフェース: [server-api.md](./server-api.md)
- OS とのインタフェース: [os-integration.md](./os-integration.md)
- README の「認証フロー」セクション（シーケンス図）
