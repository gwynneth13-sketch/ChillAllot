import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from 'npm:@simplewebauthn/server@14.0.0';
const origin=Deno.env.get('APP_UNLOCK_ORIGIN')||'';
const rpID=origin?new URL(origin).hostname:'';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(!origin||!origin.startsWith('https://')||req.headers.get('origin')!==origin)return reply({error:'This app address is not enabled for unlock.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Use POST.'},405);
 try{
 const token=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!token)return reply({error:'Sign in to continue.'},401);
 const {data:{user},error:authError}=await admin.auth.getUser(token);if(authError||!user)return reply({error:'Sign in to continue.'},401);
 if(Number(req.headers.get('content-length')||0)>32768)return reply({error:'Request too large.'},413);
 const raw=await req.text();if(raw.length>32768)return reply({error:'Request too large.'},413);
 const input=JSON.parse(raw);const action=input.action;
 if(action==='register-options'||action==='authenticate-options'){
 const {count,error:rateError}=await admin.from('app_unlock_challenges').select('id',{head:true,count:'exact'}).eq('user_id',user.id).gte('created_at',new Date(Date.now()-60000).toISOString());if(rateError)throw rateError;if((count||0)>=10)return reply({error:'Please wait a minute before trying again.'},429);
 await admin.from('app_unlock_challenges').delete().eq('user_id',user.id).lt('expires_at',new Date().toISOString());
 const {data:keys,error}=await admin.from('app_unlock_credentials').select('*').eq('user_id',user.id);if(error)throw error;
 const register=action==='register-options';if(register&&(keys||[]).length>=20)return reply({error:'Device limit reached.'},400);
 const key=(keys||[]).find(k=>k.id===input.credentialId);if(!register&&!key)return reply({error:'This device is not registered. Sign out and sign in to set it up again.'},400);
 const options=register?await generateRegistrationOptions({rpName:'ChillAllot',rpID,userName:user.email||user.id,userID:new TextEncoder().encode(user.id),attestationType:'none',excludeCredentials:(keys||[]).map(k=>({id:k.id,transports:k.transports})),authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'}}):await generateAuthenticationOptions({rpID,allowCredentials:[{id:key.id,transports:key.transports}],userVerification:'required'});
 const {data:challenge,error:saveError}=await admin.from('app_unlock_challenges').insert({user_id:user.id,kind:register?'register':'authenticate',challenge:options.challenge,credential_id:register?null:key.id}).select('id').single();if(saveError)throw saveError;
 return reply({options,challengeId:challenge.id});
 }
 if(action!=='register-verify'&&action!=='authenticate-verify')return reply({error:'Unknown operation.'},400);
 const register=action==='register-verify';const {data:rows,error:consumeError}=await admin.rpc('consume_app_unlock_challenge',{challenge_id:input.challengeId,actor_id:user.id,expected_kind:register?'register':'authenticate'});if(consumeError)throw consumeError;
 const challenge=rows?.[0];if(!challenge)return reply({error:'Unlock request expired. Please try again.'},400);
 if(register){
 const result=await verifyRegistrationResponse({response:input.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});
 if(!result.verified||!result.registrationInfo)throw Error('Verification failed');
 const credential=result.registrationInfo.credential;
 const {error}=await admin.from('app_unlock_credentials').insert({id:credential.id,user_id:user.id,public_key:Array.from(credential.publicKey),counter:credential.counter,transports:credential.transports||[]});if(error)throw error;
 return reply({verified:true,credentialId:credential.id});
 }
 if(input.response?.id!==challenge.credential_id)throw Error('Wrong credential');
 const {data:key,error}=await admin.from('app_unlock_credentials').select('*').eq('id',challenge.credential_id).eq('user_id',user.id).single();if(error)throw error;
 const result=await verifyAuthenticationResponse({response:input.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.id,publicKey:new Uint8Array(key.public_key),counter:Number(key.counter),transports:key.transports}});
 if(!result.verified)throw Error('Verification failed');
 const {data:updated,error:updateError}=await admin.from('app_unlock_credentials').update({counter:result.authenticationInfo.newCounter}).eq('id',key.id).eq('user_id',user.id).eq('counter',key.counter).select('id');if(updateError||!updated?.length)throw Error('Concurrent unlock');
 return reply({verified:true});
 }catch{return reply({error:'Could not verify unlock. Please try again.'},400)}
});
