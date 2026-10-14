const accountKey = 'chillallot.ios-push-account';
const installationKey = 'chillallot.ios-push-installation';

// Dependencies are injected so permission, account changes, and late callbacks
// can be tested without contacting Apple or registering a real device.
export function createIosPushSession({plugin, storage, uuid, register, remove, onOpen,
  schedule = setTimeout, cancel = clearTimeout, ready = false}) {
  let account = null, generation = 0, pending = null, listenersPromise = null;
  let enabled = false, switching = false;
  const subscribers = new Set();
  const notify = () => subscribers.forEach(fn => fn(enabled));
  const read = key => storage.getItem(key);
  const installation = () => {
    const existing = read(installationKey);
    if (existing) return existing;
    const id = uuid(); storage.setItem(installationKey, id); return id;
  };
  const clearPending = error => {
    if (!pending) return;
    const task = pending; pending = null; cancel(task.timer); task.reject(error);
  };
  const listen = () => listenersPromise ||= (async () => {
    await plugin.addListener('registration', async ({value}) => {
      const task = pending;
      if (!task || task.account !== account || task.generation !== generation) return;
      pending = null; cancel(task.timer);
      try {
        if (!/^[a-f0-9]{32,512}$/i.test(value || '')) throw Error('The phone returned an invalid notification registration.');
        await register(installation(), value.toLowerCase());
        if (task.account !== account || task.generation !== generation) {
          storage.setItem(accountKey, task.account);
          // Account switching waits for this operation before ending its session.
          task.reject(Error('The signed-in account changed. Please try again.')); return;
        }
        storage.setItem(accountKey, account); enabled = true; notify(); task.resolve();
      } catch (error) {task.reject(error);}
    });
    await plugin.addListener('registrationError', () => clearPending(Error('Phone notifications could not register. Please try again.')));
    await plugin.addListener('pushNotificationActionPerformed', ({notification}) => {
      const id = notification?.data?.notification_id;
      if (typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)) onOpen(id);
    });
  })();
  const registerPhone = async () => {
    await listen();
    if (pending) throw Error('Notification registration is already in progress.');
    return new Promise((resolve, reject) => {
      const task = {account, generation, resolve, reject, timer: null};
      task.timer = schedule(() => {
        if (pending === task) clearPending(Error('Phone notification registration timed out. Please try again.'));
      }, 20000);
      pending = task;
      Promise.resolve().then(() => plugin.register()).catch(error => {if (pending === task) clearPending(error);});
    });
  };
  let registering = null;
  const trackedRegistration = () => {
    const promise = registerPhone(); registering = promise;
    return promise.finally(() => {if (registering === promise) registering = null;});
  };
  return {
    listen,
    subscribe(fn) {subscribers.add(fn); fn(enabled); return () => subscribers.delete(fn);},
    async setAccount(id) {
      if (id === account && !switching) return;
      const previous = account;
      generation++; clearPending(Error('The signed-in account changed.'));
      const expected = generation;
      account = null; switching = true; enabled = false; notify();
      try {
        if (registering) await registering.catch(() => {});
        if (expected !== generation) return;
        if (previous || read(accountKey)) {await plugin.unregister(); await plugin.removeAllDeliveredNotifications();}
        if (expected !== generation) return;
        account = id;
        if (!ready || !id || read(accountKey) !== id) return;
        const permission = await plugin.checkPermissions();
        if (expected !== generation) return;
        if (permission.receive === 'granted') await trackedRegistration();
        else {enabled = false; notify();}
      } finally {if (expected === generation) switching = false;}
    },
    async enable() {
      if (!ready) throw Error('Phone notification setup is being completed.');
      if (switching) throw Error('Your account is still connecting. Please try again.');
      if (!account) throw Error('Sign in to enable phone notifications.');
      const previous = read(accountKey);
      if (previous && previous !== account) throw Error('Sign out of the previous account on this device before enabling notifications.');
      const expected = generation;
      let permission = await plugin.checkPermissions();
      if (permission.receive === 'prompt') permission = await plugin.requestPermissions();
      if (expected !== generation) throw Error('The signed-in account changed. Please try again.');
      if (permission.receive !== 'granted') throw Error('Allow notifications for ChillAllot in iPhone Settings to continue.');
      await trackedRegistration();
    },
    async disable() {
      // Keep credentials alive until a late token callback and its save finish.
      generation++; clearPending(Error('Notifications were turned off.'));
      if (registering) await registering.catch(() => {});
      const id = read(installationKey);
      const owner = read(accountKey);
      if (id && account && (!owner || owner === account)) await remove(id);
      if (!owner || owner === account) storage.removeItem(accountKey);
      enabled = false; notify();
      await plugin.unregister();
      await plugin.removeAllDeliveredNotifications();
    },
  };
}
