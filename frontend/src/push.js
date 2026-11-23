/* Abonnement Web Push VAPID. La clé publique vient du serveur, jamais du code. */
import { api } from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function activerNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const autorisation = await Notification.requestPermission();
  if (autorisation !== "granted") return false;
  const { key, configure } = await api.get("/api/notifications/vapid-key");
  if (!configure || !key) return false;
  const registration = await navigator.serviceWorker.ready;
  let abonnement = await registration.pushManager.getSubscription();
  if (!abonnement) {
    abonnement = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api.post("/api/notifications/subscribe", {
    subscription: abonnement.toJSON(),
  });
  return true;
}

export async function desactiverNotifications() {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const abonnement = await registration.pushManager.getSubscription();
  if (!abonnement) return false;
  await api.post("/api/notifications/unsubscribe", {
    endpoint: abonnement.endpoint,
  });
  await abonnement.unsubscribe();
  return true;
}
