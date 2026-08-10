# DeployGate Android配信CI/CD

変更レベル: Lv3（機能追加）
参考実装: https://github.com/taka1226s/cicd（private, `gh` CLIでアクセス確認済み）

## 目的

Androidアプリを DeployGate 経由でテスターへ配信できるようにする。GitHub Actions + fastlane で「手動配信」と「リリース作成時の自動配信」の2経路を用意し、コミット毎に配信通知が飛ばないようにする。

## 機能リスト

1. **手動配信ワークフロー**: GitHub Actionsの `workflow_dispatch` から任意のブランチ/コミットのAndroid Release APKをビルドし、DeployGateへアップロードする
2. **リリース自動化（release-please）**: `main` へのマージをトリガーに、Conventional Commitsを解析してRelease PR（バージョン番号・CHANGELOG提案）を自動作成/更新する。Release PRをマージすると、gitタグ・GitHub Releaseを作成し、続けてDeployGateへ自動配信する
3. **配信ロジックの共通化**: ビルド〜DeployGateアップロードの処理を再利用可能ワークフロー（`workflow_call`）として1箇所に集約し、手動配信・自動配信の両方から呼び出す
4. **CIへのビルド検証追加**: 既存 `.github/workflows/ci.yml` に、Android（`assembleDebug`）とiOS（シミュレータ向け、署名不要）のビルド検証ジョブを追加する。テスト（既存の `server` / `app` ジョブ）とは独立して実行してよい
5. **セットアップ手順の共通化**: Node/Java/Rubyのセットアップを Composite Action として切り出し、CI・配信ワークフローの双方から利用する
6. **fastlaneレーン整備**: `app/android/fastlane/Fastfile` に `build_debug`（CI検証用）と `publish_deploygate`（Release APKビルド+DeployGateアップロード）の2レーンを用意する

## 受け入れ基準（Acceptance Criteria）

```
【AC-1】手動配信でDeployGateへアップロードされる
  Given: GitHub Secrets（DEPLOYGATE_API_TOKEN, DEPLOYGATE_USER）がEnvironment "deploygate" に登録済みで、GitHub Actions標準のブランチ選択UIで対象ブランチを選べる状態にある
  When:  Actionsタブから「Deploy Android to DeployGate」をworkflow_dispatchで手動実行する（対象ブランチはActions標準のブランチ選択で指定。個別のコミットSHA指定はサポートしない＝Out of Scope）
  Then:  選択したブランチ先頭のAndroid Release APK（debug鍵署名の暫定運用）がビルドされ、DeployGateへアップロードされる。リリースノート（message）は任意入力欄とし、未入力時はデフォルト値（例: "CI配信"）が使われる

【AC-2】mainマージでRelease PRが自動作成/更新される
  Given: mainブランチに `feat:` / `fix:` 等Conventional Commits準拠のコミットがpushされている
  When:  そのコミットがmainにマージされる
  Then:  release-pleaseが差分のコミットを解析し、バージョン番号案とCHANGELOG更新を含むRelease PRを自動作成、または既存のRelease PRを更新する（release-please標準動作により、有効なRelease PRは常に最大1件のみ存在し、追加のmainマージは既存Release PRの更新として扱われる）。この時点ではDeployGateへの配信は発生しない
  Given(補足): mainへのマージ差分にConventional Commits準拠のコミット（`feat:`/`fix:`等、バージョン変動を伴う種別）が1件も含まれない場合
  Then(補足): release-pleaseはRelease PRを作成・更新しない（release-please標準動作）

【AC-3】Release PRマージで自動配信される
  Given: release-pleaseが作成した唯一のRelease PRが存在する。このRelease PRはrelease-pleaseが管理する専用ブランチ（例: `release-please--branches--main`）からmainへのPRであり、通常のfeature PRと区別できる
  When:  そのRelease PRをmainへマージする
  Then:  gitタグとGitHub Releaseが作成され、続けて同一workflow内でAndroid Release APKがビルドされ、DeployGateへ自動配信される（コミット毎の配信は発生しない）
  When(補足): タグ・GitHub Releaseの作成後、Android Release APKのビルドまたはDeployGateへのアップロードが失敗した場合
  Then(補足): 既に作成済みのタグ・GitHub Releaseはロールバックしない（失敗状態のまま残す）。ワークフロー全体は失敗として表示され、再配信は手動配信ワークフロー（AC-1、対象ブランチにこのタグ相当のコミットを含むブランチを指定）で行う

【AC-4】PR作成時にAndroid/iOSビルド検証が走る
  Given: mainへ向けたPRが作成される
  When:  ci.ymlがpull_requestトリガーで実行される
  Then:  既存の server/app テストジョブに加え、Android（assembleDebug）とiOS（シミュレータ向け、署名不要）のビルドジョブが、既存テストジョブと並列（依存なし）のjobとして追加実行される。GitHub Actions標準動作により、追加した2ジョブを含むいずれか1つでもjobが失敗すればワークフロー全体がfailure表示になる
  Then(補足): iOSビルドの成果物（シミュレータ向け.app）はactions/upload-artifactでアーティファクト化し、一定期間（例: 14日）保持後に自動破棄する。恒久保存はOut of Scope

【AC-5】Secretsが安全に管理される
  Given: DeployGateのAPIトークン・ユーザー名をユーザーが取得済み
  When:  `gh secret set <name> --repo <repo> --env deploygate` 等でGitHub Environment "deploygate" に登録する
  Then:  値はワークフローファイル・fastlaneコード・コミット・チャット履歴のいずれにも平文で記載しない。配信ワークフローは `environment: deploygate` を指定し、このEnvironment経由でのみSecretsを参照する。Actionsログへの値の露出防止はGitHub Actions標準のSecretsマスキング機能に依拠し、追加のマスキング実装はスコープに含めない

【AC-6】配信トリガーが限定される
  Given: 通常の開発（featureブランチへのpush、PR作成）が行われている
  When:  Release PRのマージでもworkflow_dispatchの手動実行でもないイベントが発生する
  Then:  DeployGateへの配信は発生しない
```

## 対象外（Out of Scope）

- iOSのDeployGate/TestFlight配信（Apple Developer Program未加入のため。iOSはシミュレータビルド検証のみ）
- Android正式署名鍵の発行・Play Store配布（配信ビルドはdebug鍵署名を暫定利用する）
- Dependabotの導入・依存自動更新設定
- 配信されたAPKの実機での動作検証（配信の仕組みが機能することの確認までがスコープ。実機での機能検証は別途手動で行う）
- lint・型チェックのCIへの追加（既存ci.ymlにこれらのステップがない場合でも、今回追加するのはビルド検証ジョブのみ）
- release-please導入に伴う `app/package.json` のバージョン運用ルールの変更（Conventional Commitsによる自動採番の対象範囲は本機能に閉じる）
- workflow_dispatchでの個別コミットSHA指定配信（ブランチ単位の選択のみサポート）
- タグ作成・GitHub Release作成は成功したがビルド/DeployGateアップロードが失敗した場合の自動ロールバック・自動リトライ（失敗時は手動配信ワークフローでの再配信が前提）
- iOSビルド成果物（シミュレータ向け.app）の恒久保存・配布

## 前提・制約

- 本プロジェクトはモノレポで、アプリ本体は `app/` 配下にある（参考リポジトリはリポジトリ直下）。追加するワークフロー・fastlane・Composite Actionは `app/` 配下を対象とするようパスを読み替える
- `app/android` `app/ios` は Expo bare workflow（`expo prebuild`）で生成済みのネイティブプロジェクトであり、CI上で `expo prebuild` を再実行しない前提とする
- DebugビルドタイプはMetro開発サーバーへの接続を前提とするため、配布先の端末単体では起動できない。配信用ビルドは `assembleRelease`（署名はdebug鍵を暫定流用）を使う
- 署名に使うdebug鍵は `app/android/app/debug.keystore`（既にリポジトリにコミット済みの固定鍵、Android標準のデバッグ用鍵）を使い続ける。実行のたびに鍵が変わることはないため、テスターは同一アプリとして上書きインストールできる
- release-pleaseが作成するリリースは既定の `GITHUB_TOKEN` によるものであり、`release: published` 等のイベントを他workflowのトリガーにはできない（GitHub Actionsの再帰実行防止仕様）。自動配信は同一workflow内で `needs` によりjobを連結する形で実現する
- DeployGateのAPIトークン・ユーザー名はユーザー自身が用意し、GitHub Environment `deploygate` に登録する（このプロセス内で値を扱わない）
- リポジトリの Settings → Actions → General → Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効化する必要がある（release-pleaseがRelease PRを作成するための前提）
