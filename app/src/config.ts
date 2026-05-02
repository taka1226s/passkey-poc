// Expo SDK 49+ は EXPO_PUBLIC_* 変数をアプリコードで自動展開する
// dev.js が起動時に app/.env へ EXPO_PUBLIC_API_URL を書き出す
export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
