import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { HomeScreen } from './src/screens/HomeScreen';
import { BASE_URL } from './src/config';
import { registerForPushNotifications } from './src/utils/notifications';

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

  function handleNotificationData(data: Record<string, unknown>) {
    const { approvalId, username, sessionToken } = data as {
      approvalId?: string;
      username?: string;
      sessionToken?: string;
    };
    if (approvalId && username && sessionToken) {
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
        const { pendingApproval } = await res.json();
        if (pendingApproval) {
          setPendingBanner(pendingApproval);
        }
      } catch {}
    });

    // cold start：通知タップでアプリが起動した場合 → 直接 ApprovalScreen
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationData(response.notification.request.content.data as Record<string, unknown>);
    });

    // 通知タップ時（バックグラウンド・killed state からの復帰、フォアグラウンドバナータップ）
    // → 直接 ApprovalScreen
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        setPendingBanner(null);
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
