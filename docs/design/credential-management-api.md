# 設計書: パスキー一覧・削除 API（credential-management-api）

- 作成日: 2026-07-04
- 対象仕様: docs/requirements/credential-management-api.md（承認済み）
- ステータス: 承認待ち

## 1. 要件の整理

| AC | 内容 | 実装箇所 |
|----|------|---------|
| AC-1 | 一覧取得（公開情報のみ） | `GET /credentials` + `store.getUser` |
| AC-2 | 未登録ユーザーは 200 空配列 | 同上（user なし → `[]`） |
| AC-3 | 削除成功 | `DELETE /credentials/:credentialId` + `store.removeCredential` |
| AC-4 | 最後の 1 件は 409 | store 側でガード（アトミック性のため） |
| AC-5 | 不存在・他ユーザー所有は 404 | store 側で対象ユーザーの credentials のみ検索 |
| AC-6 | username 未指定は 400 | ルートハンドラのバリデーション |

## 2. アーキテクチャ設計

既存の 2 ファイル構成（server.ts = ルート、store.ts = in-memory ストア）を踏襲し、新規ファイルは作らない。

### store.ts への追加

```
removeCredential(username, credentialId):
  'removed' | 'not_found' | 'last_credential'
```

- `users.get(username)` の `credentials` 配列内のみを検索する（他ユーザーの credential は見えない → AC-5 を構造的に保証）
- 見つからない → `'not_found'`
- `credentials.length <= 1` → `'last_credential'`（削除しない）
- それ以外 → 配列から除去して `'removed'`

判定と削除を store の単一メソッドに閉じることで、「ハンドラで件数確認 → 削除」の分離による不整合を避ける。

一覧は既存の `store.getUser(username)` をそのまま使い、新メソッドは追加しない。

### server.ts への追加エンドポイント

```
GET /credentials?username=<name>
  400: username なし
  200: { credentials: [{ id, deviceType, backedUp, transports }] }
       （user 不在時は空配列。publicKey・counter は含めない — AC-1/AC-2）

DELETE /credentials/:credentialId?username=<name>
  400: username なし
  404: 'not_found'      → { error: '認証情報が見つかりません' }
  409: 'last_credential' → { error: '最後のパスキーは削除できません' }
  200: 'removed'        → { ok: true }
```

- `credentialId` は base64url 文字列（パスパラメータ）。Express が URL デコードするが、base64url は特殊文字を含まないためそのまま比較可能
- レスポンスの整形（内部フィールドの除外）はハンドラ内の明示的な map で行う（スプレッドでの除外はしない — フィールド追加時の漏えい防止）

### エラーハンドリング方針

既存踏襲: バリデーションエラーは 400 + 日本語メッセージ、詳細な内部情報は返さない。同期処理のみで try-catch は不要。

## 3. 実装上の懸念点

- **認可なし（仕様の前提・制約に記載済み）**: username を知る第三者が一覧・削除可能。PoC 限定の意図的判断。コードコメントで本番転用時の要対応を明記する
- **列挙攻撃**: AC-2 により GET はユーザー存在有無を漏らさない。DELETE の 404 は「credential 不存在」と「ユーザー不存在」を区別しない（同一メッセージ）
- **ロックアウト防止**: AC-4 の 409 ガード。全削除したい場合の救済は対象外（仕様どおり）
- **競合**: in-memory・単一プロセス・同期処理のため race condition なし
- **既存への影響**: 既存エンドポイント・store メソッドは変更しない。追加のみ

## 4. 実装順序（TDD）

1. `store.removeCredential` の単体テスト → 実装（not_found / last_credential / removed の 3 分岐）
2. `GET /credentials` の Supertest（AC-1・AC-2・AC-6）→ 実装
3. `DELETE /credentials/:credentialId` の Supertest（AC-3・AC-4・AC-5・AC-6）→ 実装
4. 既存テストの全通過確認

テストは既存の `server/src/server.test.ts` の登録ヘルパー（verifyRegistrationResponse のモック等）を流用する。テスト名に AC-ID を含める。

フロントエンド作業なし（app/ 側 UI は対象外）。
