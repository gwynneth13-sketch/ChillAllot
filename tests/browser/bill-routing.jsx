// Isolated acceptance fixture; not a production entry point or household dataset.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import BillWorkspace from '../../src/components/BillWorkspace.jsx';
import '../../src/styles.css';
const today=new Date(),past=new Date(today);past.setDate(past.getDate()-2);
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const due=iso(past),base={creatorId:'me',payerIds:['me'],allocations:[],cadence:'One-time',amount:25,amountType:'fixed',kind:'Manual',cycles:[],defaults:{}};
const bills=[{...base,id:'overdue',name:'Overdue example',due},{...base,id:'today',name:'Today example',due:iso(today)}];
function Fixture(){
 const [focus,setFocus]=useState(null);
 return <main className="app" data-theme="Dark Cozy"><section className="content" data-section="Bills"><h1>Bill routing acceptance fixture</h1><p>Local test data only.</p><button onClick={()=>setFocus({billId:'overdue',due})}>Open overdue notification</button><button onClick={()=>setFocus({billId:'missing',due})}>Open inaccessible notification</button><BillWorkspace focusRequest={focus} data={{bills,ready:true}} account={{id:'me',name:'Me'}} members={[]} say={()=>{}} onCloseAdd={()=>{}} ui={{formatDateDisplay:d=>d,formatReminderTime:t=>t}}/></section></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
