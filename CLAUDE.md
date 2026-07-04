種別: 正式

# passkey-poc — 開発ガイド

Android / iOS 実機でパスキー（FIDO2/WebAuthn）認証を検証するプロジェクト。検証項目と全体像は README.md を参照。

## 技術スタック

- `app/` — React Native（Expo bare）+ TypeScript。テスト: Jest（`app/` で `npm test`）
- `server/` — Express 5 + @simplewebauthn/server + TypeScript。テスト: Jest + ts-jest + Supertest（`server/` で `npm test` / `npm run test:coverage`）
- `scripts/dev.js` — ngrok・サーバー・Metro の一括起動（ルートで `npm run dev`）

## プロセス成果物

正式プロジェクトのため、仕様駆動プロセス（CLAUDE.md グローバル設定の Lv1〜3）を厳密適用する：

- 仕様書 `docs/requirements/` / 設計書 `docs/design/` / テスト仕様書 `docs/test-specs/`
- 承認記録 `docs/approvals/`（実装ゲート有効）/ DoD・レビュー記録 `docs/qa/`

## 注意

- `.env`（RPID 等）は git 管理外。値の変更時は README の手順に従う
- WebAuthn チャレンジ・セッションの扱いはセキュリティレビュー済みの実装（git log 参照）を崩さない
