import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isPushSupported,
  isPushSubscribed,
  checkPermission,
  getSubscriptionCount,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPermissionStatus,
} from "@/services/pushService";
import { supabase } from "@/lib/supabase";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useToast } from "@/hooks/useToast";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { Switch } from "@/components/ui/switch";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

type PushStatus = "checking" | "enabled" | "disabled";

export function NotificationSettingsCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const profile = useCurrentProfile();

  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");
  const [pushError, setPushError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  // Notification.permission (via checkPermission()) is the browser/OS's own
  // raw grant state -- separate from whether a push *subscription* row
  // exists -- so an admin can tell "permission denied at the OS level" and
  // "iOS but not installed as an app yet" apart from "just never subscribed",
  // neither of which subscribeToPush()'s own error can distinguish.
  const [permission, setPermission] = useState<PushPermissionStatus>(() => checkPermission());
  const [subscriptionCount, setSubscriptionCount] = useState<number | null>(null);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    void isPushSubscribed().then((subscribed) => setPushStatus(subscribed ? "enabled" : "disabled"));
  }, []);

  useEffect(() => {
    if (!profile) return;
    void getSubscriptionCount(profile.id)
      .then(setSubscriptionCount)
      .catch((error: unknown) => console.warn("[NotificationSettingsCard] subscription count failed", error));
  }, [profile, pushStatus]);

  const handleToggle = async (nextEnabled: boolean) => {
    setPushError(null);
    setToggling(true);
    try {
      if (nextEnabled) {
        if (!isPushSupported()) {
          setPushError(t("admin.settings.pushUnsupported"));
          return;
        }
        if (!VAPID_PUBLIC_KEY) {
          setPushError(t("admin.settings.pushMisconfigured"));
          return;
        }
        await subscribeToPush(VAPID_PUBLIC_KEY);
        setPushStatus("enabled");
      } else {
        await unsubscribeFromPush();
        setPushStatus("disabled");
      }
    } catch (error) {
      console.warn("[NotificationSettingsCard] push toggle failed", error);
      setPushError(t("admin.settings.pushError"));
    } finally {
      setPermission(checkPermission());
      setToggling(false);
    }
  };

  const handleTestPush = async () => {
    if (!profile || testSending) return;
    setTestSending(true);
    showToast("info", t("admin.settings.pushTestSendingToast"));

    try {
      const { error } = await supabase.functions.invoke("dispatch-push", {
        body: {
          targetUserId: profile.id,
          payload: {
            title: t("admin.settings.pushTestTitle"),
            body: t("admin.settings.pushTestBody"),
            url: "/admin/settings",
            tag: "diagnostic-test",
          },
        },
      });
      if (error) throw error;
      showToast("success", t("admin.settings.pushTestSuccessToast"));
    } catch (error) {
      console.warn("[NotificationSettingsCard] test push failed", error);
      showToast("error", t("admin.settings.pushTestErrorToast"));
    } finally {
      setTestSending(false);
    }
  };

  const permissionTone =
    permission === "granted" ? "text-success" : permission === "denied" ? "text-destructive" : "text-foreground";
  const permissionLabel =
    permission === "granted"
      ? t("admin.settings.pushPermission.granted")
      : permission === "denied"
        ? t("admin.settings.pushPermission.denied")
        : permission === "unsupported"
          ? t("admin.settings.pushPermission.unsupported")
          : permission === "ios-install-required"
            ? t("admin.settings.pushPermission.iosInstallRequired")
            : t("admin.settings.pushPermission.default");

  return (
    <CardCustom title={t("admin.settings.notificationCardTitle")}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("admin.settings.pushExplanation")}</p>

        <div>
          <span className="text-xs text-muted">{t("admin.settings.pushPermissionLabel")}</span>
          <p className={`text-sm font-medium ${permissionTone}`}>{permissionLabel}</p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium text-foreground">{t("admin.settings.enablePushToggle")}</p>
            <p className="text-xs text-muted">
              {subscriptionCount === null
                ? t("admin.settings.pushDeviceCountLoading")
                : t("admin.settings.pushDeviceCount", { count: subscriptionCount })}
            </p>
          </div>
          <Switch
            checked={pushStatus === "enabled"}
            onChange={() => void handleToggle(pushStatus !== "enabled")}
            disabled={pushStatus === "checking" || toggling}
            aria-label={t("admin.settings.enablePushToggle")}
          />
        </div>

        {pushError && <p className="text-xs text-destructive">{pushError}</p>}

        <div className="border-t border-border pt-4">
          <ButtonCustom
            variant="primary"
            size="sm"
            isLoading={testSending}
            disabled={pushStatus !== "enabled"}
            onClick={() => void handleTestPush()}
            className="w-full"
          >
            {t("admin.settings.pushTestButton")}
          </ButtonCustom>
          {pushStatus !== "enabled" && (
            <p className="mt-1.5 text-xs text-muted">{t("admin.settings.pushTestRequiresEnabled")}</p>
          )}
        </div>
      </div>
    </CardCustom>
  );
}
