import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isPushSupported,
  isPushSubscribed,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/services/pushService";
import { CardCustom } from "@/components/ui/card-custom";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

type PushStatus = "checking" | "enabled" | "disabled";

export function NotificationSettingsCard() {
  const { t } = useTranslation();
  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");
  const [pushError, setPushError] = useState<string | null>(null);
  // Notification.permission is the browser's own raw grant state (separate
  // from whether a push *subscription* row exists) -- shown so an admin can
  // tell "permission denied at the OS/browser level" apart from "just never
  // subscribed", which subscribeToPush's own error can't distinguish.
  const [permission, setPermission] = useState<NotificationPermission | null>(
    isPushSupported() ? Notification.permission : null,
  );

  useEffect(() => {
    void isPushSubscribed().then((subscribed) => setPushStatus(subscribed ? "enabled" : "disabled"));
  }, []);

  const handleEnablePush = async () => {
    setPushError(null);
    if (!isPushSupported()) {
      setPushError(t("admin.settings.pushUnsupported"));
      return;
    }
    if (!VAPID_PUBLIC_KEY) {
      setPushError(t("admin.settings.pushMisconfigured"));
      return;
    }
    try {
      await subscribeToPush(VAPID_PUBLIC_KEY);
      setPushStatus("enabled");
      setPermission(await requestNotificationPermission());
    } catch (error) {
      console.warn("[NotificationSettingsCard] push subscription failed", error);
      setPushError(t("admin.settings.pushError"));
      if (isPushSupported()) setPermission(Notification.permission);
    }
  };

  const handleDisablePush = async () => {
    await unsubscribeFromPush();
    setPushStatus("disabled");
  };

  const permissionLabel =
    permission === "granted"
      ? t("admin.settings.pushPermission.granted")
      : permission === "denied"
        ? t("admin.settings.pushPermission.denied")
        : t("admin.settings.pushPermission.default");

  return (
    <CardCustom title={t("admin.settings.notificationCardTitle")}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("admin.settings.pushExplanation")}</p>

        <div>
          <span className="text-xs text-muted">{t("admin.settings.pushPermissionLabel")}</span>
          <p
            className={`text-sm font-medium ${
              permission === "granted"
                ? "text-success"
                : permission === "denied"
                  ? "text-destructive"
                  : "text-foreground"
            }`}
          >
            {permissionLabel}
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <span className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted">
            <span
              className={`h-2 w-2 rounded-full ${pushStatus === "enabled" ? "bg-success" : "bg-muted"}`}
              aria-hidden
            />
            {pushStatus === "enabled" ? t("admin.settings.pushEnabled") : t("admin.settings.pushDisabled")}
          </span>

          {pushError && <p className="mb-2 text-xs text-destructive">{pushError}</p>}

          {pushStatus === "enabled" ? (
            <button
              type="button"
              onClick={() => void handleDisablePush()}
              className="w-full rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
            >
              {t("admin.settings.disablePush")}
            </button>
          ) : (
            <button
              type="button"
              disabled={pushStatus === "checking"}
              onClick={() => void handleEnablePush()}
              className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {t("admin.settings.enablePush")}
            </button>
          )}
        </div>
      </div>
    </CardCustom>
  );
}
