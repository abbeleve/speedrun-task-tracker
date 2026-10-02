// Web Push on this browser (a PC or an Android phone): it subscribes with the
// backend's key, and the backend pushes when a block starts or runs out (see
// backend/app/push.py). public/sw.js shows what arrives.

import * as api from './api';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

// Service workers need a secure page: https, or localhost while developing.
export function pushSupported(): boolean {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// The backend's key arrives base64url-encoded; the browser takes raw bytes.
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function sameKey(held: ArrayBuffer | null, key: Uint8Array): boolean {
  if (!held || held.byteLength !== key.length) return false;
  return new Uint8Array(held).every((byte, i) => byte === key[i]);
}

async function heldSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// A subscription made with another key (the server's database was replaced)
// can no longer be pushed to, so it is swapped for a fresh one.
async function subscribe(): Promise<void> {
  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(await api.loadPushKey());
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey ?? null, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await api.savePushSubscription(subscription.toJSON(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

// Where this browser stands, read on load. A subscription it already holds is
// sent again: that keeps its time zone current and restores it on the server
// if it had been dropped there.
export async function syncPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || !(await heldSubscription())) return 'off';
  await subscribe();
  return 'on';
}

// Must be called straight from a click: only then may the browser ask.
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  await subscribe();
  return 'on';
}

// The server forgets an unreachable endpoint by itself, so a failed request
// does not keep the browser subscribed.
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const subscription = await heldSubscription();
  if (!subscription) return;
  await api.deletePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}
