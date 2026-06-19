import { INotification } from "../types";

const CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php";

const MAX_MESSAGE_LENGTH = 3500;

class Whatsapp implements INotification {
  async sendNotification(text: string): Promise<void> {
    const phone = process.env.WHATSAPP_PHONE?.trim();
    const apikey = process.env.CALLMEBOT_API_KEY?.trim();
    if (!phone || !apikey) {
      throw new Error(
        "Faltan WHATSAPP_PHONE y/o CALLMEBOT_API_KEY en el entorno.",
      );
    }

    const truncated =
      text.length > MAX_MESSAGE_LENGTH
        ? `${text.slice(0, MAX_MESSAGE_LENGTH - 20)}\n… (truncado)`
        : text;

    const url = new URL(CALLMEBOT_URL);
    url.searchParams.set("phone", phone.replace(/\D/g, ""));
    url.searchParams.set("text", truncated);
    url.searchParams.set("apikey", apikey);

    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });

    const body = await res.text();
    if (!res.ok || /APIKey is invalid|ERROR/i.test(body)) {
      throw new Error(`CallMeBot ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

export const create = (): INotification | null => {
  const enabled =
    (process.env.WHATSAPP_ENABLED ?? "true").toLowerCase() !== "false";
  const phone = process.env.WHATSAPP_PHONE?.trim();
  const apikey = process.env.CALLMEBOT_API_KEY?.trim();

  if (!phone || !apikey) {
    console.log(
      "[Whatsapp Channel] WhatsApp no configurado (faltan WHATSAPP_PHONE / CALLMEBOT_API_KEY). Scheduler en pausa.",
    );
    return null;
  }

  if (!enabled) {
    console.log(
      "[Whatsapp Channel] WhatsApp desactivado por WHATSAPP_ENABLED=false.",
    );

    return null;
  }

  return new Whatsapp();
};
