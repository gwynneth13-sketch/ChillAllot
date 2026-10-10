import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationTargetStore,notificationRecovery} from '../src/lib/notificationRecovery.js';

function windowFixture(href='https://example.test/?notification=bill&invite=ABC#section',blocked=false){
 const values=new Map();
 const win={location:{href},sessionStorage:{
  getItem:key=>{if(blocked)throw Error('blocked');return values.get(key)||null;},
  setItem:(key,value)=>{if(blocked)throw Error('blocked');values.set(key,value);},
  removeItem:key=>{if(blocked)throw Error('blocked');values.delete(key);}
 },history:{replaceState:(_state,_title,url)=>{win.location.href=String(url);}}};
 return win;
}
function harness(store,options={}){
 const queue=[];let unavailable=0,errors=0;
 const runner=notificationRecovery({store,lookup:async id=>({id}),open:async()=> 'handled',
  onUnavailable:()=>unavailable++,onError:()=>errors++,
  schedule:fn=>{queue.push(fn);return fn;},cancel:fn=>{const index=queue.indexOf(fn);if(index>=0)queue.splice(index,1);},...options});
 return {...runner,queue,get unavailable(){return unavailable;},get errors(){return errors;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('notification survives signed-out reload even with blocked storage; clearing preserves invite and hash',()=>{
 const win=windowFixture(undefined,true),store=notificationTargetStore(win);
 store.remember(store.get());
 assert.equal(notificationTargetStore(win).get(),'bill');
 store.clear('bill');
 assert.equal(store.get(),null);
 assert.equal(win.location.href,'https://example.test/?invite=ABC#section');
});
test('a failed bill load retains the target; a later retry opens it and only then clears',async()=>{
 const store=notificationTargetStore(windowFixture());let attempts=0;
 const recovery=harness(store,{open:async()=>{assert.equal(store.get(),'bill');return ++attempts===1?'retry':'handled';}});
 await recovery.run();assert.equal(store.get(),'bill');assert.equal(recovery.queue.length,1);
 recovery.queue.shift()();await flush();
 assert.equal(attempts,2);assert.equal(store.get(),null);assert.equal(recovery.errors,0);
});
test('unmount during lookup cannot open or clear; next signed-in mount recovers',async()=>{
 const store=notificationTargetStore(windowFixture());let resolve,opened=0;
 const recovery=harness(store,{lookup:()=>new Promise(r=>{resolve=r;}),open:async()=>{opened++;return 'handled';}});
 const pending=recovery.run();recovery.stop();resolve({id:'bill'});await pending;
 assert.equal(opened,0);assert.equal(store.get(),'bill');
 await harness(store).run();assert.equal(store.get(),null);
});
test('newer notification waits for old lookup, which cannot navigate or erase it',async()=>{
 const store=notificationTargetStore(windowFixture());let resolve;const opened=[];
 const recovery=harness(store,{lookup:id=>id==='bill'?new Promise(r=>{resolve=r;}):Promise.resolve({id}),
  open:async data=>{opened.push(data.id);return 'handled';}});
 const pending=recovery.run();store.remember('new');await recovery.run();
 resolve({id:'bill'});await pending;await flush();
 assert.deepEqual(opened,['new']);assert.equal(store.get(),null);
});
test('new click during asynchronous opening invalidates the old navigation and acknowledgement',async()=>{
 const store=notificationTargetStore(windowFixture());let finish;const opened=[];
 const recovery=harness(store,{open:async(data,current)=>{
  if(data.id==='bill')await new Promise(resolve=>{finish=resolve;});
  if(current())opened.push(data.id);return 'handled';
 }});
 const pending=recovery.run();await flush();store.remember('new');finish();await pending;await flush();
 assert.deepEqual(opened,['new']);assert.equal(store.get(),null);
});
test('waiting for a household switch preserves the target for the next household mount',async()=>{
 const store=notificationTargetStore(windowFixture());const recovery=harness(store,{open:async()=> 'wait'});
 await recovery.run();assert.equal(store.get(),'bill');assert.equal(recovery.queue.length,0);
 recovery.stop();await harness(store).run();assert.equal(store.get(),null);
});
test('bounded lookup retries keep the link for refresh; inaccessible notices are terminal',async()=>{
 const store=notificationTargetStore(windowFixture());let lookups=0;
 const recovery=harness(store,{lookup:async()=>{lookups++;throw Error('offline');}});
 await recovery.run();recovery.queue.shift()();await flush();recovery.queue.shift()();await flush();
 assert.equal(lookups,3);assert.equal(recovery.errors,1);assert.equal(recovery.queue.length,0);assert.equal(store.get(),'bill');
 const unavailable=harness(store,{lookup:async()=>null});await unavailable.run();
 assert.equal(unavailable.unavailable,1);assert.equal(store.get(),null);
});
