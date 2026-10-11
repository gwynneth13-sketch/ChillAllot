const key='chillallot.pending-notification';

// Keep the URL as well as session storage until navigation succeeds. This also
// preserves the destination if storage is unavailable or sign-in reloads.
export function notificationTargetStore(win){
 return {
  get(){
   const id=new URL(win.location.href).searchParams.get('notification');
   if(id)return id;
   try{return win.sessionStorage.getItem(key);}catch{return null;}
  },
  remember(id){
   if(typeof id!=='string'||!id)return;
   try{win.sessionStorage.setItem(key,id);}catch{}
   const url=new URL(win.location.href);url.searchParams.set('notification',id);
   win.history.replaceState(null,'',url);
  },
  clear(id){
   if(this.get()!==id)return;
   try{win.sessionStorage.removeItem(key);}catch{}
   const url=new URL(win.location.href);
   if(url.searchParams.get('notification')===id){
    url.searchParams.delete('notification');win.history.replaceState(null,'',url);
   }
  }
 };
}

// Each mounted household owns a cancellable runner. Failed loads retain the
// target; an old request can neither navigate nor acknowledge a newer click.
export function notificationRecovery({store,lookup,open,onUnavailable,onError,
 schedule=fn=>setTimeout(fn,1500),cancel=clearTimeout,maxAttempts=3}){
 let active=true,busy=false,timer=null,lastId=null,attempts=0;
 const run=async()=>{
  if(!active||busy)return;
  if(timer!==null){cancel(timer);timer=null;}
  const id=store.get();if(!id)return;
  if(lastId!==id){lastId=id;attempts=0;}
  const current=()=>active&&store.get()===id;
  busy=true;
  try{
   const data=await lookup(id);
   if(!current())return;
   if(!data){onUnavailable();store.clear(id);return;}
   const result=await open(data,current);
   if(!current())return;
   if(result==='handled')store.clear(id);
   else if(result==='retry')throw new Error('Notification destination is still loading');
  }catch{
   if(current()){
    attempts+=1;
    if(attempts<maxAttempts)timer=schedule(()=>{timer=null;void run();});
    else onError();
   }
  }finally{
   busy=false;
   if(active&&store.get()&&store.get()!==id)void run();
  }
 };
 return {run,stop(){active=false;if(timer!==null)cancel(timer);}};
}
