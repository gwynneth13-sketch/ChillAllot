import React,{useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {pushPublicKey as publicKey} from '../lib/pushPublicKey.js';
function keyBytes(value){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export default function PushPreferences({account,cloud}){
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const supported=typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 useEffect(()=>{let alive=true;if(supported&&cloud)navigator.serviceWorker.getRegistration('/').then(async reg=>{const sub=await reg?.pushManager.getSubscription();if(!sub)return;const {data}=await supabase.from('push_devices').select('endpoint').eq('endpoint',sub.endpoint).eq('user_id',account.id);if(alive)setEnabled(Boolean(data?.length&&Notification.permission==='granted'));}).catch(()=>{});return()=>{alive=false}},[account.id,cloud]);
 const enable=async()=>{
  setBusy(true);setError('');
  try{
   // Permission is requested only after the user presses the button.
   if(await Notification.requestPermission()!=='granted')throw Error('Notifications were not allowed. You can change this in your browser’s site settings.');
   const reg=await navigator.serviceWorker.register('/push-worker.js',{scope:'/'});await navigator.serviceWorker.ready;
   const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
   const {error}=await supabase.rpc('register_push_device',{subscription:sub.toJSON(),app_origin:window.location.origin});if(error)throw error;
   localStorage.setItem('chillallot.push-account',account.id);setEnabled(true);
  }catch(e){setError(e.message||'Could not enable phone notifications.');}finally{setBusy(false)}
 };
 const disable=async()=>{
  setBusy(true);setError('');try{const reg=await navigator.serviceWorker.getRegistration('/');const sub=await reg?.pushManager.getSubscription();if(sub){const {error}=await supabase.rpc('remove_push_device',{device_endpoint:sub.endpoint});if(error)throw error;await sub.unsubscribe();}localStorage.removeItem('chillallot.push-account');setEnabled(false);}catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <section className="unlock-preferences"><h2>Phone notifications</h2><p className="modal-description">Receive updates even when ChillAllot is closed. This applies to this browser.</p>{!supported?<p className="helper">Push notifications aren’t available in this browser configuration.</p>:!cloud?<p className="helper">Sign in to enable phone notifications.</p>:!publicKey?<p className="helper">Phone notification delivery is being prepared.</p>:<button type="button" className="outline small" disabled={busy} onClick={enabled?disable:enable}>{busy?'Please wait…':enabled?'Turn off on this device':'Enable on this device'}</button>}{error&&<p className="form-message" role="alert">{error}</p>}</section>;
}
