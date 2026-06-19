import { INotification } from "./types";

let activeNotifications: INotification[] = [];

export const getNotificationsConfig = () => {
  return {
    cron: process.env.NOTIFICATIONS_CRON ?? "0 9,18 * * *",
    timezone: process.env.NOTIFICATIONS_TIMEZONE ?? "Europe/Madrid",
  };
};

export const initialize = (notifications: (INotification | null)[]) => {
  activeNotifications = notifications.filter(
    (notification) => notification !== null,
  );
};

export const isThereAnyChannelConfigured = () => {
  return activeNotifications.length > 0;
};

export const sendNotifications = async (text: string) => {
  for (const notification of activeNotifications) {
    await notification.sendNotification(text);
  }
};
