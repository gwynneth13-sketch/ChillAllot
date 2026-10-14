import {Capacitor} from '@capacitor/core';
import {PushNotifications} from '@capacitor/push-notifications';
import {supabase} from './supabase.js';
import {notificationTargetStore} from './notificationRecovery.js';
import {createIosPushSession} from './iosPushSession.js';

export const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
export const iosPushReady = import.meta.env.VITE_IOS_PUSH_READY === 'true';
const environment = import.meta.env.VITE_APNS_ENVIRONMENT || 'sandbox';
const request = async (name, values) => {
  const {error} = await supabase.rpc(name, values);
  if (error) throw Error(error.code === 'PGRST202' ? 'Phone notification setup is being completed.' : error.message);
};
export const iosPush = isNativeIos ? createIosPushSession({
  plugin: PushNotifications, storage: localStorage, uuid: () => crypto.randomUUID(), ready: iosPushReady,
  register: (id, token) => request('register_ios_push_device', {
    device_installation: id, device_token: token, device_environment: environment,
  }),
  remove: id => request('remove_ios_push_device', {device_installation: id}),
  onOpen: id => {
    notificationTargetStore(window).remember(id);
    window.dispatchEvent(new CustomEvent('chillallot:open-notification', {detail: {id}}));
  },
}) : null;

// Listen before React mounts so a cold-start tap survives account loading.
if (iosPush) void iosPush.listen().catch(() => {});
