種別: 正式

# passkey-poc — 開発ガイド

Android / iOS 実機でパスキー（FIDO2/WebAuthn）認証を検証するプロジェクト。検証項目と全体像は README.md を参照。

## 技術スタック

- `app/` — React Native（Expo bare）+ TypeScript。テスト: Jest（`app/` で `npm test`）
- `server/` — Express 5 + @simplewebauthn/server + TypeScript。テスト: Jest + ts-jest + Supertest（`server/` で `npm test` / `npm run test:coverage`）
- `scripts/dev.js` — ngrok・サーバー・Metro の一括起動（ルートで `npm run dev`）
- テストは必ず各ディレクトリ（`app/` / `server/`）で `npm test` を実行する。リポジトリルートから `npx jest` を直接叩くと ts-jest 設定が読まれず babel の構文エラーで失敗する

## プロセス成果物

正式プロジェクトのため、仕様駆動プロセス（CLAUDE.md グローバル設定の Lv1〜3）を厳密適用する：

- 仕様書 `docs/requirements/` / 設計書 `docs/design/` / テスト仕様書 `docs/test-specs/`
- 承認記録 `docs/approvals/`（実装ゲート有効）/ DoD・レビュー記録 `docs/qa/`

## 注意

- `.env`（RPID 等）は git 管理外。値の変更時は README の手順に従う
- WebAuthn チャレンジ・セッションの扱いはセキュリティレビュー済みの実装（git log 参照）を崩さない
- **承認済みセキュリティトレードオフ**: `GET /credentials` / `DELETE /credentials/:credentialId` の認可が username のみである点は、PoC 検証用としてユーザーが明示承認した意図的判断（docs/requirements/credential-management-api.md 前提・制約）。セキュリティレビューで IDOR として指摘されても対応不要（本番転用時は管理トークン方式への置き換えが必須）
