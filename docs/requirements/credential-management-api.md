# 仕様書: パスキー一覧・削除 API（credential-management-api）

- 作成日: 2026-07-04
- 変更レベル: Lv3（機能追加）
- ステータス: 承認済み（2026-07-04、docs/approvals/credential-management-api-spec.md）

## 目的

ユーザーが自分の登録済みパスキー（credential）を確認し、不要なもの（紛失端末のものなど）を削除できるようにする。

## 機能リスト

- `GET /credentials?username=<name>` — 登録済みパスキーの一覧を返す
- `DELETE /credentials/:credentialId?username=<name>` — 指定したパスキーを削除する

## 受け入れ基準（Acceptance Criteria）

```
【AC-1】一覧取得
  Given: username "alice" に 2 件の credential が登録済み
  When:  GET /credentials?username=alice
  Then:  200 で 2 件の配列を返す。各要素は id・deviceType・backedUp・transports のみ
         （publicKey・counter 等の内部情報は含めない）

【AC-2】未登録ユーザーの一覧
  Given: username "nobody" は未登録
  When:  GET /credentials?username=nobody
  Then:  200 で空配列を返す（404 にせず、ユーザーの存在有無を漏らさない — 既存 M-7 方針に整合）

【AC-3】削除成功
  Given: username "alice" に 2 件の credential が登録済み
  When:  DELETE /credentials/<1件目のid>?username=alice
  Then:  200 { ok: true } を返し、一覧が 1 件になる

【AC-4】最後の 1 件は削除拒否
  Given: username "alice" の credential が残り 1 件
  When:  DELETE /credentials/<そのid>?username=alice
  Then:  409 を返し、credential は削除されない（ロックアウト防止）

【AC-5】対象不一致の削除
  Given: 指定した credentialId が存在しない、または他ユーザーに属する
  When:  DELETE /credentials/<id>?username=alice
  Then:  404 を返す（他ユーザーの credential は削除できない）

【AC-6】バリデーション
  Given: -
  When:  username を指定せずに GET / DELETE を呼ぶ
  Then:  400 を返す
```

## 対象外（Out of Scope）

- 認可トークンによる保護（下記制約参照）
- アプリ（app/）側の管理画面 UI
- credential へのニックネーム付与・最終使用日時の追跡
- 監査ログ

## 前提・制約

- **認可は username のみ（意図的な簡易化）**: 本 API は PoC 検証用として認可なしで実装する。第三者が username を知っていれば他人のパスキーを削除できるため、**本番転用時は管理トークン方式（パスキー認証成功時に発行する短命トークン）への置き換えが必須**。この判断は 2026-07-04 にユーザーが明示的に選択したもの
- ストレージは既存の in-memory store（store.ts）を拡張する
- 既存エンドポイント・既存テストの挙動を変更しない
