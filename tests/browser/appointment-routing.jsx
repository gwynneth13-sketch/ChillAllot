// Disposable mounted acceptance fixture using the real appointment cards.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import AppointmentCards from '../../src/components/AppointmentCards.jsx';
import '../../src/styles.css';
const items=[{id:'first',name:'Other appointment',date:'2026-10-19',time:'08:00',creatorId:'other'},
 {id:'target',name:'Shared appointment target',date:'2026-10-20',time:'14:00',creatorId:'other',reminder:''}];
function Fixture(){
 const [focus,setFocus]=useState(null),[personal,setPersonal]=useState(null);
 return <main className="app" data-theme="Dark Cozy"><section className="content" data-section="Appointments"><h1>Appointment routing check</h1>
  <p>Local test data only.</p><button onClick={()=>setFocus({appointmentId:'target'})}>Open appointment notification</button>
  <button onClick={()=>setFocus({appointmentId:'missing'})}>Open removed appointment notification</button>
  <AppointmentCards appointments={items} account={{id:'me'}} members={[]} today="2026-10-10" focusRequest={focus} onReminder={setPersonal} onEdit={()=>{}} onRemove={()=>{}} onAssign={()=>{}} ui={{formatReminderTime:t=>t,formatDateDisplay:d=>d,reminderLabel:r=>r}}/>
  {personal&&<div role="dialog" aria-label="Personal reminder">Set a reminder for {personal.name}</div>}
 </section></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
