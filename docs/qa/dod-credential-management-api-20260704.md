# DoD 記録: パスキー一覧・削除 API（credential-management-api）

- 実施日: 2026-07-04
- 判定: **合格**
- 対象コミット: 819c980 / 04cced4 / bafbf33 / c9307f3（fb2ddd8 からの 4 コミット）

## 1. 受け入れ基準トレーサビリティ

`grep -n "AC-[0-9]" src/store.test.ts src/server.test.ts` で機械的に抽出。

| AC-ID | 内容（要約） | 対応テスト | 結果 |
|-------|------------|-----------|------|
| AC-1 | 一覧取得（公開情報のみ） | server.test.ts:676「AC-1: 登録済みユーザーの一覧を公開情報のみで返す」 | passed |
| AC-2 | 未登録ユーザーは 200 空配列 | server.test.ts:698、store.test.ts:50 | passed |
| AC-3 | 削除成功 | server.test.ts:711、store.test.ts:15 | passed |
| AC-4 | 最後の 1 件は 409 | server.test.ts:726、store.test.ts:29 | passed |
| AC-5 | 不存在・他ユーザーは 404 | server.test.ts:737・747、store.test.ts:40・54 | passed |
| AC-6 | username なしは 400 | server.test.ts:704・765 | passed |

対応テストのない AC: なし。

## 2. テスト・カバレッジ・型チェック（実測）

`npm run test:coverage`（server/、2026-07-04 実行）:

- **Test Suites: 2 passed / Tests: 64 passed, 0 failed**（既存テストの退行なし）

| ファイル | Lines 実測 | 基準 | 判定 |
|---------|-----------|------|------|
| store.ts（ビジネスロジック） | 93.75% | 80% 以上 | 合格 |
| server.ts | 66.66% | - | 下記参照 |

- 今回追加したコード（store.ts:144-155、server.ts:550-589）は**未カバー行に含まれず全分岐テスト済み**（クリティカルパス 100% を満たす）
- server.ts の未カバー行（594-731 等）はすべて既存の WebAuthn ceremony・Web UI・push 送信部分で、本変更の対象外
- 型チェック: ts-jest の diagnostics（有効）で全ファイル通過。`tsc --noEmit` は tsconfig の `moduleResolution: "node"` 非推奨エラー（TS5107）で失敗するが、これは fb2ddd8 時点から存在する既存問題（tsconfig は本変更で未修正・変更コード起因ではない）。**別タスクとして tsconfig の更新を推奨**
- lint: プロジェクトに lint スクリプトなし（既存構成どおり）

## 3. システムテスト（実動作確認）

`PORT=3199 npx ts-node src/server.ts` でサーバーを実際に起動し curl で確認（2026-07-04）:

| 操作 | 結果 |
|------|------|
| GET /health | `{"ok":true}` |
| GET /credentials?username=nobody | `{"credentials":[]}` [200]（AC-2） |
| GET /credentials（username なし） | `{"error":"username は必須です"}` [400]（AC-6） |
| DELETE /credentials/no-such-id?username=alice | `{"error":"認証情報が見つかりません"}` [404]（AC-5） |
| DELETE /credentials/some-id（username なし） | `{"error":"username は必須です"}` [400]（AC-6） |

AC-1/AC-3/AC-4 の実機確認は WebAuthn ceremony（実端末の authenticator）が必要なため curl 単体では不可。実 Express アプリを HTTP 経由で駆動する Supertest 結合テスト（store 直接シード）で検証済み。実機での動線確認は次回の実機検証時に実施可能。

## 4. 独立レビュー

docs/qa/review-credential-management-api-20260704.md 参照。

- code-reviewer サブエージェント（別コンテキスト）: High/Medium 指摘なし、Low 2 件は対応不要と判断（理由を記録済み）
- /security-review（別コンテキスト）: NO FINDINGS
- 自動セキュリティレビューの IDOR 指摘 2 件: 仕様承認済みの意図的判断として対応不要（理由を記録済み）

## 5. 仕様準拠

- 承認記録（docs/approvals/credential-management-api-spec.md）と実装範囲が一致。仕様凍結後の無承認変更なし
- Out of Scope（認可トークン・app UI・ニックネーム・監査ログ）は実装していない

## 6. ドキュメント・CI

- テスト仕様書: docs/test-specs/credential-management-api.md あり
- CI: .github/workflows/ci.yml あり（push 前のためローカル実行結果を証拠とする。push 後に `gh run list` で確認可能）

## 残課題（合格に影響しない）

- tsconfig の `moduleResolution: "node"` が TypeScript 6 で非推奨（TS5107）。既存問題のため別タスク（Lv1〜2）で対応を推奨
