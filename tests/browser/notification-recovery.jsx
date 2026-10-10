import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import BillWorkspace from '../../src/components/BillWorkspace.jsx';
import {notificationRecovery,notificationTargetStore} from '../../src/lib/notificationRecovery.js';
import '../../src/styles.css';
const store=notificationTargetStore(window),due='2026-10-08';
const bill={id:'recovery',creatorId:'me',name:'Sign-in recovery example',payerIds:['me'],allocations:[],cadence:'One-time',amount:1,amountType:'fixed',kind:'Manual',cycles:[],defaults:{},due};
function Household(){
 const [focus,setFocus]=useState(null),[status,setStatus]=useState('Loading the notification…');
 useEffect(()=>{
  let attempts=0;
  const recovery=notificationRecovery({store,lookup:async id=>({id}),
   open:async(data,current)=>{
    if(++attempts===1){setStatus('Temporary bill load failure; destination retained.');return 'retry';}
    if(!current())return 'wait';
    setFocus({billId:'recovery',due,notificationId:data.id});setStatus('Recovered after sign-in.');return 'handled';
   },onError:()=>setStatus('Failed'),onUnavailable:()=>setStatus('Unavailable')});
  void recovery.run();return()=>recovery.stop();
 },[]);
 return <><p role="status">{status}</p><BillWorkspace focusRequest={focus} data={{bills:[bill],ready:true}} account={{id:'me',name:'Me'}} members={[]} say={()=>{}} onCloseAdd={()=>{}} ui={{formatDateDisplay:d=>d,formatReminderTime:t=>t}}/></>;
}
function Fixture(){
 const [signedIn,setSignedIn]=useState(false),[started,setStarted]=useState(Boolean(store.get()));
 return <main className="app" data-theme="Dark Cozy"><section className="content" data-section="Bills">
 <h1>Notification sign-in recovery fixture</h1><p>Local disposable data. No account or backend connection.</p>
 {!started?<button onClick={()=>{store.remember('local-notice');setStarted(true);}}>Start signed-out bill link</button>:!signedIn?<><p>Signed out; bill destination preserved.</p><button onClick={()=>setSignedIn(true)}>Simulate sign in</button></>:<Household/>}
 </section></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
