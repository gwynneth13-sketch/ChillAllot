import {requireSupabase} from './supabase.js';
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function deviceUnlockSupported(){return !!(globalThis.isSecureContext&&globalThis.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());}
async function request(action,values={}){const {data,error}=await requireSupabase().functions.invoke('app-unlock',{body:{action,...values}});if(error||data?.error)throw Error(data?.error||'Unlock service is not available yet. Please try again later.');return data;}
function serialize(credential){const r=credential.response;return {id:credential.id,rawId:encode(credential.rawId),type:credential.type,clientExtensionResults:credential.getClientExtensionResults(),authenticatorAttachment:credential.authenticatorAttachment,response:{clientDataJSON:encode(r.clientDataJSON),...(r.attestationObject?{attestationObject:encode(r.attestationObject),transports:r.getTransports?.()||[]}:{}),...(r.authenticatorData?{authenticatorData:encode(r.authenticatorData),signature:encode(r.signature),userHandle:r.userHandle?encode(r.userHandle):undefined}:{})}};}
export async function registerUnlock(){
 const {options,challengeId}=await request('register-options');const publicKey={...options,challenge:decode(options.challenge),user:{...options.user,id:decode(options.user.id)},excludeCredentials:options.excludeCredentials?.map(c=>({...c,id:decode(c.id)}))};
 const credential=await navigator.credentials.create({publicKey});if(!credential)throw Error('Setup was cancelled.');return request('register-verify',{challengeId,response:serialize(credential)});
}
export async function verifyUnlock(credentialId){
 const {options,challengeId}=await request('authenticate-options',{credentialId});const publicKey={...options,challenge:decode(options.challenge),allowCredentials:options.allowCredentials?.map(c=>({...c,id:decode(c.id)}))};
 const credential=await navigator.credentials.get({publicKey});if(!credential)throw Error('Unlock was cancelled.');const result=await request('authenticate-verify',{challengeId,response:serialize(credential)});if(!result.verified)throw Error('Unlock was not verified.');return result;
}
export function shouldLock(hiddenAt,now,delay){return hiddenAt!==null&&now-hiddenAt>=Number(delay)*1000;}
