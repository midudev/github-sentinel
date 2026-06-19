export interface INotification {
  sendNotification(text: string): Promise<void>;
}

export type NotificationConfig = {
  cron: string;
  timezone: string;
};
