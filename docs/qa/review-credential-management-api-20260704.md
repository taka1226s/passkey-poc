# レビュー記録: パスキー一覧・削除 API（credential-management-api）

- 実施日: 2026-07-04
- 対象: コミット範囲 fb2ddd8..c9307f3（server/src/ の変更）

## 1. 独立コードレビュー（code-reviewer サブエージェント）

実装セッションとは別コンテキストの code-reviewer サブエージェントで実施。

- **High / Medium: 指摘なし**（マージをブロックする問題なし）
- 確認済み観点: 仕様準拠（AC-1〜6）、removeCredential の分岐順序、情報漏えい（M-7 整合・404 の非区別・409 の追加漏えいなし）、公開フィールドの限定（publicKey・counter 除外、transports の非 undefined 保証）、既存挙動の不変、テスト品質

### Low（対応不要と判断）

| # | 指摘 | 対応 |
|---|------|------|
| L-1 | makeCredential ヘルパーが server.test.ts と store.test.ts に重複 | 対応不要。PoC 規模では共通化が過剰（レビュアー自身も対応任意と評価） |
| L-2 | username がクエリ配列の場合の型（`?username[]=x`） | 対応不要。Map.get で未ヒットとなり安全側（GET→空配列、DELETE→404）。既存エンドポイントと同一パターン |

## 2. セキュリティレビュー（/security-review）

別コンテキストのサブエージェントで、新規追加コードに限定して実施。

- **結果: NO FINDINGS（指摘なし）**
- 確認済み観点: 削除のユーザースコープ分離（横断削除不可）、分岐順序（最後の 1 件が splice される状態遷移なし）、prototype pollution（Map キーのため無効）、Express 5 クエリパーサの配列/オブジェクト混入（安全側に倒れる）、credentialId 経由のインジェクション・path traversal（メモリ内文字列比較のみでシンクなし）、XSS（res.json のみ）、CI ワークフローのスクリプトインジェクション（なし）

## 3. 自動セキュリティレビュー（バックグラウンド）の指摘への対応

自動レビューが GET/DELETE の「認可なし（IDOR）」を HIGH で 2 件指摘。

- **対応: 対応不要（承認済みの意図的判断）**
- 理由: 仕様書（docs/requirements/credential-management-api.md 前提・制約）で 2026-07-04 にユーザーが明示的に選択した PoC 検証用の簡易化。本番転用時は管理トークン方式への置き換えが必須である旨を仕様書・server.ts のコードコメントの両方に明記済み。指摘された推奨修正（短命管理トークン）は仕様の Out of Scope として記録されている
