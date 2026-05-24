import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { HomeScreen } from './src/screens/HomeScreen';
import { BASE_URL } from './src/config';
import { registerForPushNotifications } from './src/utils/notifications';
import { claimSessionToken } from './src/api/webauthnClient';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type ApprovalRequest = { approvalId: string; username: string; sessionToken: string };

export default function App() {
  // 通知タップ経由（直接 ApprovalScreen へ）
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  // D8: 手動起動時 polling 経由（HomeScreen にバナー表示）
  const [pendingBanner, setPendingBanner] = useState<ApprovalRequest | null>(null);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  // H2: push data には approvalId + username のみ。sessionToken は claim で取得
  async function handleNotificationData(data: Record<string, unknown>) {
    const { approvalId, username } = data as { approvalId?: string; username?: string };
    if (!approvalId || !username) return;

    const pushToken = await registerForPushNotifications();
    if (!pushToken) return;

    const sessionToken = await claimSessionToken(BASE_URL, approvalId, pushToken);
    if (sessionToken) {
      // H-5: claim 成功時のみ pendingBanner をクリア（startup polling と競合しても approval が消えない）
      setPendingBanner(null);
      setApprovalRequest({ approvalId, username, sessionToken });
    }
  }

  useEffect(() => {
    // D8: 手動起動時 → バナーのみ（直接 ApprovalScreen には遷移しない）
    registerForPushNotifications().then(async (token) => {
      if (!token) return;
      try {
        const res = await fetch(
          `${BASE_URL}/authentication/pending-approval?token=${encodeURIComponent(token)}`,
          { headers: { 'ngrok-skip-browser-warning': 'true' } }
        );
        const { pendingApproval } = await res.json() as {
          pendingApproval?: { approvalId: string; username: string } | null;
        };
        if (pendingApproval) {
          // H2: pending-approval は sessionToken を返さない。claim で取得
          const sessionToken = await claimSessionToken(BASE_URL, pendingApproval.approvalId, token);
          if (sessionToken) {
            setPendingBanner({ ...pendingApproval, sessionToken });
          }
        }
      } catch {}
    });

    // cold start：通知タップでアプリが起動した場合 → 直接 ApprovalScreen
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationData(response.notification.request.content.data as Record<string, unknown>);
    });

    // 通知タップ時（バックグラウンド・killed state からの復帰、フォアグラウンドバナータップ）
    // H-5: setPendingBanner(null) は handleNotificationData 内の claim 成功時にのみ実行
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleNotificationData(response.notification.request.content.data as Record<string, unknown>);
      }
    );

    return () => {
      responseListenerRef.current?.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="auto" />
        <HomeScreen
          approvalRequest={approvalRequest}
          onApprovalRequestConsumed={() => setApprovalRequest(null)}
          pendingBanner={pendingBanner}
          onBannerTapped={() => {
            setApprovalRequest(pendingBanner);
            setPendingBanner(null);
          }}
          onBannerDismissed={() => setPendingBanner(null)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
});
