種別: PoC

# passkey-poc — 開発ガイド

Android / iOS 実機でパスキー（FIDO2/WebAuthn）認証を検証するプロジェクト。検証項目と全体像は README.md を参照。

## 技術スタック

- `app/` — React Native（Expo bare）+ TypeScript。テスト: Jest（`app/` で `npm test`）
- `server/` — Express 5 + @simplewebauthn/server + TypeScript。テスト: Jest + ts-jest + Supertest（`server/` で `npm test` / `npm run test:coverage`）
- `scripts/dev.js` — ngrok・サーバー・Metro の一括起動（ルートで `npm run dev`）
- テストは必ず各ディレクトリ（`app/` / `server/`）で `npm test` を実行する。リポジトリルートから `npx jest` を直接叩くと ts-jest 設定が読まれず babel の構文エラーで失敗する

## プロセス成果物

PoC プロジェクトのため、フルプロセス（仕様書・設計書・承認記録・実装ゲート等）は適用しない。目的・受け入れ基準の骨子を会話で合意すれば実装に進んでよい。

過去に正式プロジェクトとして運用していた期間の成果物（`docs/requirements/` / `docs/design/` / `docs/approvals/` / `docs/test-specs/` / `docs/qa/`）は記録として残す。

## 注意

- `.env`（RPID 等）は git 管理外。値の変更時は README の手順に従う
- WebAuthn チャレンジ・セッションの扱いはセキュリティレビュー済みの実装（git log 参照）を崩さない
- **承認済みセキュリティトレードオフ**: `GET /credentials` / `DELETE /credentials/:credentialId` の認可が username のみである点は、PoC 検証用としてユーザーが明示承認した意図的判断（docs/requirements/credential-management-api.md 前提・制約）。セキュリティレビューで IDOR として指摘されても対応不要（本番転用時は管理トークン方式への置き換えが必須）
