import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreferenceWriter} from '../src/lib/preferenceWriter.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};}
test('slow saves finish before newer values; intermediate edits coalesce',async()=>{
 const first=deferred(),saved=[],results=[];
 const writer=createPreferenceWriter(async value=>{saved.push(value);if(saved.length===1)return first.promise;return {};},error=>results.push(error));
 writer.write({sound:true});writer.write({sound:false});writer.write({sound:false,shopping:false});
 assert.equal(saved.length,1);first.resolve({});await tick();
 assert.deepEqual(saved,[{sound:true},{sound:false,shopping:false}]);assert.deepEqual(results,[null]);
});
test('leaving a scope cancels queued saves and ignores late results',async()=>{
 const request=deferred(),saved=[],results=[];
 const writer=createPreferenceWriter(value=>{saved.push(value);return request.promise},error=>results.push(error));
 writer.write('old');writer.write('queued');writer.dispose();writer.write('after departure');
 request.resolve({error:new Error('late failure')});await tick();
 assert.deepEqual(saved,['old']);assert.deepEqual(results,[]);
});
test('thrown and returned failures are reported; later saves recover',async()=>{
 let attempts=0;const results=[];
 const writer=createPreferenceWriter(async()=>{attempts++;if(attempts===1)throw new Error('offline');if(attempts===2)return {error:new Error('denied')};return {};},error=>results.push(error?.message||null));
 writer.write(1);await tick();writer.write(2);await tick();writer.write(3);await tick();
 assert.deepEqual(results,['offline','denied',null]);
});
