import { INotification, NotificationConfig } from "./types";

let activeNotifications: INotification[] = [];

function envFirst(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export const getNotificationsConfig = (): NotificationConfig => {
  return {
    cron:
      envFirst("NOTIFICATIONS_CRON", "WHATSAPP_DIGEST_CRON") ?? "0 9,18 * * *",
    timezone:
      envFirst("NOTIFICATIONS_TIMEZONE", "WHATSAPP_TIMEZONE") ??
      "Europe/Madrid",
  };
};

export const getNotificationsSendIntervalMs = (): number => {
  return positiveInt(
    envFirst("NOTIFICATION_SEND_INTERVAL_MS", "WHATSAPP_SEND_INTERVAL_MS"),
    5000,
  );
};

export const initialize = (notifications: (INotification | null)[]) => {
  activeNotifications = notifications.filter(
    (notification) => notification !== null,
  );
};

export const isThereAnyChannelConfigured = () => {
  return activeNotifications.length > 0;
};

export const sendNotifications = async (text: string): Promise<number> => {
  if (activeNotifications.length === 0) return 0;

  for (const notification of activeNotifications) {
    await notification.sendNotification(text);
  }

  return activeNotifications.length;
};
