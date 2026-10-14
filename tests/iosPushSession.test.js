import test from 'node:test';
import assert from 'node:assert/strict';
import {createIosPushSession} from '../src/lib/iosPushSession.js';

const token = 'ab'.repeat(32);
function setup({permission='granted',ready=true,save=async()=>{}}={}) {
  const events=new Map(), values=new Map(), calls=[];
  const plugin={
    async addListener(name,fn){events.set(name,fn);return {remove:async()=>events.delete(name)};},
    async checkPermissions(){calls.push('check');return {receive:permission};},
    async requestPermissions(){calls.push('prompt');return {receive:'granted'};},
    async register(){calls.push('register');queueMicrotask(()=>events.get('registration')({value:token}));},
    async unregister(){calls.push('unregister');},
    async removeAllDeliveredNotifications(){calls.push('clear');},
  };
  const session=createIosPushSession({plugin,ready,
    storage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    uuid:()=> '00000000-0000-0000-0000-000000000001',
    register:async(id,value)=>{calls.push(['save',id,value]);await save();},
    remove:async id=>calls.push(['remove',id]),onOpen:id=>calls.push(['open',id]),
  });
  return {session,plugin,events,values,calls};
}
test('permission is requested only by explicit enable; late taps survive sign-in',async()=>{
  const {session,events,calls}=setup({permission:'prompt'});
  await session.listen();await session.setAccount('owner');
  assert.equal(calls.includes('prompt'),false);
  await session.enable();assert.equal(calls.includes('prompt'),true);
  const id='00000000-0000-0000-0000-000000000012';
  events.get('pushNotificationActionPerformed')({notification:{data:{notification_id:id}}});
  assert.deepEqual(calls.at(-1),['open',id]);
});
test('denied permission never registers a device',async()=>{
  const {session,calls}=setup({permission:'denied'});await session.setAccount('owner');
  await assert.rejects(session.enable(),/Allow notifications/);
  assert.equal(calls.includes('register'),false);
});
test('disabled setup keeps the registration path inactive',async()=>{
  const {session,calls}=setup({ready:false});await session.setAccount('owner');
  await assert.rejects(session.enable(),/setup is being completed/);
  assert.equal(calls.includes('register'),false);
});
test('relaunch refreshes an opted-in token without another permission prompt',async()=>{
  const {session,values,calls}=setup();values.set('chillallot.ios-push-account','owner');
  await session.setAccount('owner');assert.equal(calls.includes('register'),true);
  assert.equal(calls.includes('prompt'),false);
  await session.setAccount('different-user');
  assert.equal(calls.filter(c=>c==='register').length,1);
  await assert.rejects(session.enable(),/previous account/);
  assert.equal(calls.filter(c=>c==='register').length,1);
});
test('disabling waits for an in-flight token save before removing registration',async()=>{
  let finishSave,startedSave;
  const started=new Promise(resolve=>{startedSave=resolve;});
  const {session,calls,values}=setup({save:()=>{startedSave();return new Promise(resolve=>{finishSave=resolve;});}});
  await session.setAccount('owner');
  const enabling=session.enable();const rejected=assert.rejects(enabling,/signed-in account changed/);
  await started;const disabling=session.disable();
  assert.equal(calls.some(c=>Array.isArray(c)&&c[0]==='remove'),false);
  finishSave();await rejected;await disabling;
  assert.equal(values.has('chillallot.ios-push-account'),false);
  assert.deepEqual(calls.slice(-3),[['remove','00000000-0000-0000-0000-000000000001'],'unregister','clear']);
});
