#!/usr/bin/env node
/**
 * Cloudflare トンネルを起動し、URL を検出したら RPID をセットしてサーバーを起動する
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

let serverProcess = null;

function printBanner(url) {
  const line = '─'.repeat(60);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log(`\x1b[1m  AC-3 クロスデバイス認証テスト URL\x1b[0m`);
  console.log(`  \x1b[4m\x1b[36m${url}\x1b[0m`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);
}

function startServer(rpid) {
  const url = `https://${rpid}`;
  printBanner(url);
  console.log(`[server] RPID=${rpid} で起動します\n`);
  serverProcess = spawn('npm', ['run', 'dev'], {
    cwd: SERVER_DIR,
    env: { ...process.env, RPID: rpid },
    stdio: 'inherit',
  });
  serverProcess.on('exit', (code) => {
    console.log(`[server] 終了 (code=${code})`);
  });
}

function startTunnel() {
  const tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let urlDetected = false;

  const onData = (data) => {
    const text = data.toString();
    // トンネルのログをそのまま流す
    process.stdout.write(text.replace(/^/gm, '[tunnel] '));

    if (!urlDetected) {
      const match = text.match(TUNNEL_URL_PATTERN);
      if (match) {
        urlDetected = true;
        const rpid = match[0].replace('https://', '');
        startServer(rpid);
      }
    }
  };

  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);

  tunnel.on('exit', (code) => {
    console.log(`[tunnel] 終了 (code=${code})`);
    serverProcess?.kill();
    process.exit(code ?? 0);
  });

  return tunnel;
}

const tunnelProcess = startTunnel();

// Ctrl+C で両プロセスを終了
process.on('SIGINT', () => {
  tunnelProcess.kill();
  serverProcess?.kill();
  process.exit(0);
});
