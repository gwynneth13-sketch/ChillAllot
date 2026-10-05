// This worker handles notifications only; it does not cache household pages or data.
self.addEventListener('push',event=>{
 let message={};try{message=event.data?.json()||{}}catch{}
 const id=typeof message.id==='string'?message.id:'';
 event.waitUntil(self.registration.showNotification(message.title||'ChillAllot',{
  body:message.detail||'You have a household update.',
  icon:'/icons/chillallot-192.png',badge:'/icons/chillallot-192.png',
  tag:id||'chillallot-update',silent:message.silent===true,
  data:{id},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL('/',self.location.origin);
 if(event.notification.data?.id)url.searchParams.set('notification',event.notification.data.id);
 event.waitUntil((async()=>{
  const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const tab=tabs.find(client=>new URL(client.url).origin===self.location.origin);
  if(tab){tab.postMessage({type:'OPEN_NOTIFICATION',id:event.notification.data?.id});await tab.focus();}
  else await self.clients.openWindow(url.href);
 })());
});
