# テスト仕様書: パスキー一覧・削除 API（credential-management-api）

- 作成日: 2026-07-04
- 対象仕様: docs/requirements/credential-management-api.md
- 対象設計: docs/design/credential-management-api.md

## テスト対象

- `server/src/store.ts` — `removeCredential(username, credentialId)`（単体テスト）
- `server/src/server.ts` — `GET /credentials` / `DELETE /credentials/:credentialId`（結合テスト、Supertest）

## 前提条件

- テストは `server/` で `npm test`（Jest + ts-jest + Supertest）で実行する
- credential の登録は WebAuthn フローを通さず `store.getOrCreateUser` + `store.addCredential` で直接セットアップする（既存テストの方式を踏襲）
- テストごとに独立した username を使い、テスト間の干渉を避ける

## テストケース

### 単体テスト: store.removeCredential

| # | Given | When | Then |
|---|-------|------|------|
| U-1 | 2 件登録済みのユーザー | 1 件目の id で removeCredential | `'removed'` を返し、credentials が 1 件になる |
| U-2 | 1 件登録済みのユーザー | その id で removeCredential | `'last_credential'` を返し、credential は残る |
| U-3 | 登録済みユーザー | 存在しない id で removeCredential | `'not_found'` を返す |
| U-4 | 未登録ユーザー | 任意の id で removeCredential | `'not_found'` を返す |
| U-5 | ユーザー A に属する credential | ユーザー B の username で removeCredential | `'not_found'` を返し、A の credential は残る |

### 結合テスト: GET /credentials

| # | AC | Given | When | Then |
|---|----|-------|------|------|
| G-1 | AC-1 | alice に 2 件登録済み | GET /credentials?username=alice | 200。2 件の配列。各要素は id・deviceType・backedUp・transports のみ（publicKey・counter を含まない） |
| G-2 | AC-2 | nobody は未登録 | GET /credentials?username=nobody | 200。空配列 |
| G-3 | AC-6 | - | GET /credentials（username なし） | 400 |

### 結合テスト: DELETE /credentials/:credentialId

| # | AC | Given | When | Then |
|---|----|-------|------|------|
| D-1 | AC-3 | alice に 2 件登録済み | DELETE /credentials/<1件目>?username=alice | 200 { ok: true }。一覧が 1 件になる |
| D-2 | AC-4 | alice の credential が残り 1 件 | DELETE /credentials/<その id>?username=alice | 409。credential は削除されない |
| D-3 | AC-5 | 存在しない credentialId | DELETE /credentials/no-such-id?username=alice | 404 |
| D-4 | AC-5 | bob の credential を指定 | DELETE /credentials/<bob の id>?username=alice | 404。bob の credential は残る |
| D-5 | AC-6 | - | DELETE /credentials/<id>（username なし） | 400 |

## 期待結果の確認方法

- HTTP ステータスコードとレスポンスボディを Supertest でアサート
- 削除の副作用は `store.getUser(username)!.credentials` の件数・内容で確認

## テスト範囲外

- app/（React Native）側の UI テスト
- 実機ブラウザからの E2E（WebAuthn ceremony を含むフロー）
- 認可トークン（仕様の対象外）
