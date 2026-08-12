# サーバーインタフェース仕様

`server/src/server.ts` が提供する HTTP API の仕様書。実装（アプリ・Web）とサーバー間の契約を定義する。

対象読者: このサーバーを呼び出すクライアント（アプリ / Web）を実装・保守する人。

## 共通事項

- ベース URL: `https://<RPID>`（`.env` の `RPID`。ngrok 固定ドメイン）
- リクエスト形式: `Content-Type: application/json`（GET/DELETE はボディなし）
- 認可方式: **Cookie は使わない**。ログインセッションは `Authorization: Bearer <authToken>` ヘッダーで送る（詳細は「認可方式」参照）
- CORS: `cors()` デフォルト設定（全オリジン許可。PoC のため未制限）
- エラーレスポンスは共通形式 `{ "error": "エラーメッセージ" }`（一部 `requiresReauth: true` 等の追加フィールドを持つ）
- サーバーはインメモリストアのため、再起動でユーザーデータ・セッション・承認状態はすべて消える

## 認可方式

| 方式 | 使用エンドポイント | 説明 |
|---|---|---|
| `Authorization: Bearer <authToken>` | `POST /registration/begin`（初回登録時）、`GET /credentials`、`DELETE /credentials/:id` | ID/PASS ログインまたはパスキーログイン（no-push 分岐）で発行されるログインセッション。TTL 24時間 |
| `registrationToken`（body） | `POST /registration/begin`（2台目以降の追加登録時） | 既存パスキーでの再認証（`POST /registration/authorize`）で発行。使い捨て・TTL 5分 |
| `sessionId`（body、WebAuthn チャレンジセッション） | `POST /registration/complete`, `POST /authentication/complete`, `POST /registration/authorize` | `*/begin` 発行、使い捨て・TTL 5分。認可ではなく CSRF 的な整合性確認 |
| `deviceToken`（body） | `POST /push-token` | 登録・承認成功時に発行。使い捨て・TTL 15分 |
| `sessionToken`（push approval 用、body/query） | `/authentication/claim`, `/authentication/approval-info`, `/authentication/approve`, `/authentication/reject` | `authToken` とは別概念。push 通知経由の承認フロー専用 |
| なし（無認可） | `GET /health`, `GET /.well-known/*`, `GET /authentication/approval-status`, `GET /authentication/status` | 意図的に無認可（後述の「無認可エンドポイントの設計意図」参照） |

### 無認可エンドポイントの設計意図

- `GET /authentication/approval-status`: push approval のポーリング用。`approvalId` が漏洩しても `status` と `username` しか読めず、認証情報の奪取はできない設計（`authToken` を返さない設計判断の理由）
- `GET /authentication/status`: `lastAuthenticatedAt` 自体は返さず `authenticated: boolean` のみ返し、ユーザー存在有無を漏らさない

## エンドポイント一覧

### ヘルスチェック

#### `GET /health`
- 認可: 不要
- レスポンス 200: `{ ok: true }`

### ID/PASS 認証

#### `POST /auth/signup`
- 認可: 不要
- リクエスト body: `{ username: string, password: string }`（password は8文字以上）
- レスポンス 200: `{ authToken: string }`
- エラー:
  - 400 `username、password は必須です`
  - 400 `パスワードは8文字以上で入力してください`
  - 409 `このユーザー名は既に使われています`

#### `POST /auth/login`
- 認可: 不要
- リクエスト body: `{ username: string, password: string }`
- レスポンス 200: `{ authToken: string }`
- エラー: 401 `ユーザー名またはパスワードが違います`（ユーザー不存在とパスワード不一致を区別しない列挙対策）

#### `POST /auth/logout`
- 認可: 不要（body 内 `authToken` で対象セッションを特定）
- リクエスト body: `{ authToken?: string }`
- レスポンス 200: `{ ok: true }`（`authToken` 未指定でも常に成功）

### パスキー登録

#### `POST /registration/begin`
- 認可: 条件付き
  - 既存ユーザーで credential 保有済み → `registrationToken` 必須（C-1 再認証）
  - それ以外（初回登録） → `Authorization: Bearer <authToken>` 必須、かつセッションの username と body の username が一致すること
- リクエスト body: `{ username: string, registrationToken?: string }`
- レスポンス 200: `{ ...WebAuthn RegistrationOptions, sessionId: string }`
- エラー:
  - 400 `username は必須です`
  - 403 `既存のパスキーへの追加登録には再認証が必要です`（`requiresReauth: true` 付き）
  - 401 `ログインが必要です`（authToken 無効 / username 不一致）

#### `POST /registration/complete`
- 認可: 不要（`sessionId` によるチャレンジ検証、`credential` の WebAuthn 署名検証で担保）
- リクエスト body: `{ username: string, credential: RegistrationResponseJSON, sessionId: string }`
- レスポンス 200: `{ verified: true, deviceToken: string }`
- エラー: 400（必須項目欠落／チャレンジ無効／ユーザー不存在／検証失敗、いずれもメッセージ違い）

#### `POST /registration/authorize`
- 認可: 不要（既存 credential の WebAuthn 署名検証そのものが認可）
- 用途: 2台目以降のパスキー追加登録に必要な `registrationToken` を、既存パスキーでの再認証により取得する
- リクエスト body: `{ credential: AuthenticationResponseJSON, sessionId: string }`
- レスポンス 200: `{ registrationToken: string }`
- エラー: 400 / 404（チャレンジ無効・credential不存在・ユーザー不一致・カウンター巻き戻し等）

### パスキー認証

#### `POST /authentication/begin`
- 認可: 不要
- リクエスト body: `{ username?: string }`（省略時 usernameless 認証）
- レスポンス 200: `{ ...WebAuthn AuthenticationOptions, sessionId: string }`

#### `POST /authentication/complete`
- 認可: 不要（`credential` の WebAuthn 署名検証で担保）
- リクエスト body: `{ credential: AuthenticationResponseJSON, sessionId: string }`
- レスポンス 200（分岐）:
  - push token 未登録ユーザー → `{ verified: true, authToken: string }`
  - push token 登録済みユーザー → `{ approvalId: string, code: number }`（`authToken` は発行しない。理由は「無認可エンドポイントの設計意図」参照）
- エラー: 400 / 404（チャレンジ無効・credential不存在・ユーザー不一致・カウンター巻き戻し等）

### push approval（push 通知経由の承認フロー）

#### `GET /authentication/approval-info`
- 認可: `sessionToken`（query）
- リクエスト query: `approvalId`, `sessionToken`
- レスポンス 200: `{ choices: number[], ipAddress?, userAgent?, createdAt, username }`
- エラー: 400 / 404 / 409（`既に ${status} 状態です`）

#### `GET /authentication/pending-approval`
- 認可: `token`（push token、query）
- リクエスト query: `token`
- レスポンス 200: `{ pendingApproval: null | { approvalId, username } }`

#### `POST /authentication/claim`
- 認可: `pushToken`（body、所持証明）
- 用途: push 通知受信後、push token 所持を証明して `sessionToken` を取得（1回限り）
- リクエスト body: `{ approvalId, pushToken }`
- レスポンス 200: `{ sessionToken: string }`
- エラー: 400 / 404 / 409（`sessionToken は既に取得済みです`）

#### `GET /authentication/approval-status`
- 認可: 不要（意図的、上記参照）
- リクエスト query: `approvalId`
- レスポンス 200: `{ status: 'pending'|'approved'|'rejected'|'expired', username }`

#### `POST /authentication/approve`
- 認可: `sessionToken`（body）
- リクエスト body: `{ approvalId, sessionToken, selectedCode: number }`
- レスポンス 200: `{ ok: true, deviceToken: string }`
- エラー: 400 / 404 / 409 / Number Matching 不一致時 400（誤答検知でrejected化）

#### `POST /authentication/reject`
- 認可: `sessionToken`（body）
- リクエスト body: `{ approvalId, sessionToken, reason?: 'user_rejected'|'not_me' }`
- レスポンス 200: `{ ok: true }`

#### `GET /authentication/status`
- 認可: 不要
- リクエスト query: `username`, `since?`（epoch ms 文字列）
- レスポンス 200: `{ authenticated: boolean }`

### push token 登録

#### `POST /push-token`
- 認可: `deviceToken`（body、登録・承認成功時に発行）
- リクエスト body: `{ username, token, deviceToken }`
- レスポンス 200: `{ ok: true }`
- エラー: 400 / 403（`deviceToken が無効または期限切れです`）

### パスキー管理（一覧・削除）

#### `GET /credentials`
- 認可: `Authorization: Bearer <authToken>` 必須
- レスポンス 200: `{ credentials: { id, deviceType, backedUp, transports }[] }`
- エラー: 401 `ログインが必要です`

#### `DELETE /credentials/:credentialId`
- 認可: `Authorization: Bearer <authToken>` 必須
- レスポンス 200: `{ ok: true }`
- エラー: 401 / 404（不存在・他ユーザー所有、区別しない） / 409（最後の1件）

### well-known（OS 検証用）

#### `GET /.well-known/apple-app-site-association`
#### `GET /.well-known/assetlinks.json`

これら2つは OS 側がアプリの正当性を検証するためのエンドポイント。詳細は [os-integration.md](./os-integration.md) を参照。

### Web UI

#### `GET /`
- クロスデバイス認証検証用のインライン HTML/JS ページ（ID/PASS ログイン・サインアップ、パスキーでのサインイン、パスキー追加登録、認証情報一覧・削除の UI を含む）

## 承認状態の遷移（push approval）

```
pending ──┬── approve ──→ approved
          ├── reject  ──→ rejected
          └── 5分経過 ──→ expired
```

## 関連ドキュメント

- OS とのインタフェース: [os-integration.md](./os-integration.md)
- WebAuthn インタフェース項目: [webauthn-fields.md](./webauthn-fields.md)
- README の「API リファレンス」「認証フロー」セクション（シーケンス図つき）
- `docs/design/credential-management-api.md`, `docs/design/deploygate-android-cicd.md`
