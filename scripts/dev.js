#!/usr/bin/env node
/**
 * 開発サーバー起動スクリプト
 *
 * 前提: node --env-file=.env scripts/dev.js で起動すること
 *
 * 1. .env から RPID を読み込む
 * 2. app/.env に EXPO_PUBLIC_API_URL を書き出す（Expo が自動で読む）
 * 3. ngrok トンネルを起動（静的ドメイン）
 * 4. Express サーバーを起動（RPID 環境変数を注入）
 * 5. Expo（Metro）を起動
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const RPID = process.env.RPID;
if (!RPID) {
  console.error('[dev] エラー: RPID が未設定です。.env ファイルを確認してください。');
  console.error('[dev] .env.example をコピーして .env を作成し、RPID を設定してください。');
  process.exit(1);
}

const API_URL = `https://${RPID}`;
const ROOT_DIR = path.join(__dirname, '..');
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const APP_DIR = path.join(ROOT_DIR, 'app');
const APP_ENV_FILE = path.join(APP_DIR, '.env');

// app/.env を生成（Expo SDK 49+ が自動で EXPO_PUBLIC_* を読む）
fs.writeFileSync(APP_ENV_FILE, `EXPO_PUBLIC_API_URL=${API_URL}\n`);

function printBanner() {
  const line = '─'.repeat(60);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log(`\x1b[1m  Passkey PoC 開発サーバー\x1b[0m`);
  console.log(`  RPID : \x1b[33m${RPID}\x1b[0m`);
  console.log(`  URL  : \x1b[4m\x1b[36m${API_URL}\x1b[0m`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);
}

const processes = [];

function spawnProcess(cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
  p.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\x1b[31m[dev] ${cmd} が終了しました (code=${code})\x1b[0m`);
    }
  });
  processes.push(p);
  return p;
}

printBanner();

// ngrok: 静的ドメインでトンネルを開く
spawnProcess('ngrok', ['http', `--url=${RPID}`, '3000'], {});

// Express サーバー: RPID・Apple 設定を環境変数で渡す
spawnProcess('npm', ['run', 'dev'], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    RPID,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID ?? '',
    IOS_BUNDLE_ID: process.env.IOS_BUNDLE_ID ?? '',
  },
});

// Expo（Metro）: app/.env を書いた後に起動
spawnProcess('npm', ['start'], { cwd: APP_DIR });

// Ctrl+C で全プロセスを終了
process.on('SIGINT', () => {
  processes.forEach((p) => p.kill());
  process.exit(0);
});
