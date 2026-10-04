import React,{useState} from 'react';
export default function HouseholdVisibility({household,hiddenHouseholds=[],onChange}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!onChange)return null;
 const change=async(id,hidden)=>{setBusy(true);setError('');try{await onChange(id,hidden)}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <section className="household-visibility">{household&&<><button type="button" className="outline" disabled={busy} onClick={()=>change(household.id,true)}>Hide household</button><p className="modal-description">Hides this household from your view. You’re still a member, and your assigned chores, bills, and reminders remain active.</p></>}{hiddenHouseholds.length>0&&<><h2>Hidden households</h2>{hiddenHouseholds.map(h=><div className="hidden-household-row" key={h.id}><span>{h.name}</span><button type="button" className="outline" disabled={busy} onClick={()=>change(h.id,false)}>Restore</button></div>)}</>}{error&&<p className="form-message" role="alert">{error}</p>}</section>
}
