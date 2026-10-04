import React,{useState} from 'react';
import {choreMembers} from '../lib/choreRotation.js';
export default function ChoreAssignment({members,chore}){
 const [ids,setIds]=useState(()=>choreMembers(chore||{},members)),[first,setFirst]=useState(()=>chore?.ownerId||members.find(m=>m.name===chore?.owner)?.id||'');
 const selected=members.filter(m=>ids.includes(m.id)),current=ids.includes(first)?first:ids[0]||'';
 const toggle=id=>{setIds(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);};
 return <div className="chore-assignment"><span className="chore-assignment-label">Assigned to</span><div className="chore-member-choices">{members.map(m=><label key={m.id}><input type="checkbox" checked={ids.includes(m.id)} onChange={()=>toggle(m.id)}/>{m.name}</label>)}</div><input type="hidden" name="rotationIds" value={JSON.stringify(ids)}/><input type="hidden" name="ownerId" value={current}/><input type="hidden" name="owner" value={members.find(m=>m.id===current)?.name||''}/>{selected.length>1&&<label>First turn<select value={current} onChange={e=>setFirst(e.target.value)}>{ids.map(id=>members.find(m=>m.id===id)).filter(Boolean).map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label>}<small>{selected.length>1?'Selected members take turns in the order you choose them.':selected.length===1?'This member takes every turn.':'No members assigned.'}</small></div>
}
