// Isolated local app preview. Never reads or writes signed-in household data.
import {nextBillDate} from './billing.js';
const allowed=(b,id)=>b.creatorId===id||b.creatorId&&(b.visibility==='household'||b.visibility==='selected'&&b.viewerIds.includes(id));
function validate(v,creator,members){const b=structuredClone(v);if(!b.name||!b.due||(b.amount==null?b.amountType!=='variable':!Number.isFinite(b.amount)||b.amount<0))throw Error('Enter a name, amount, and date.');
  if(!['private','selected','household'].includes(b.visibility)||b.payerIds.some(id=>!members.some(m=>m.id===id))||!b.payerIds.length)throw Error('Choose household members.');
  if(b.visibility==='private'&&(b.payerIds.length!==1||b.payerIds[0]!==creator))throw Error('A private bill has only its creator as payer.');
  if(b.visibility==='selected'&&b.payerIds.some(id=>id!==creator&&!b.viewerIds.includes(id)))throw Error('Share the bill with each payer.');
  if(b.allocations.length&&Math.abs(b.allocations.reduce((n,s)=>n+s.percent,0)-100)>0.001)throw Error('Shares must total 100%.');
  delete b.creatorId;delete b.expectedRevision;return b;
}
const settings=v=>Object.fromEntries(['note','reminder','reminderTime','bankLink','paymentLink'].map(k=>[k,v[k]||'']));
export async function localBillRequest(home,op='list',id='',v={},account={id:'preview',name:'Preview user'},householdMembers=[]) {
  const actor=account.id,key='chillallot.local-preview.bills.'+home;
  const members=householdMembers.length?householdMembers:[{id:actor,name:account.name,role:'Owner'}];
  let rows=JSON.parse(localStorage.getItem(key)||'null');
  if(rows===null)rows=[];
  const b=rows.find(b=>b.id===id);
  if(op==='create'){if(b)throw Error('Bill already exists.');rows.push({...validate(v,actor,members),id,creatorId:actor,revision:1,cycles:[],preferences:{}});}
  else if(op!=='list'){
    if(!b)throw Error('Bill not found.');
    if(op==='assign'){
      if(!members.some(m=>m.id===actor&&m.role==='Owner')||b.creatorId)throw Error('Only a household owner can assign an unassigned bill.');
      const old=structuredClone(b);Object.assign(b,validate(v,v.creatorId,members),{creatorId:v.creatorId,revision:1});
      b.cycles=[...(old.paymentHistory||[]),{due:old.due,payers:old.paid||[],amount:old.amount}].filter(c=>c.payers?.length).map(c=>({due:c.due,paidIds:c.payers.map(n=>members.find(m=>m.name===n)?.id).filter(Boolean),payerIds:b.payerIds,snapshot:{...validate(v,v.creatorId,members),due:c.due,amount:c.amount}}));
    }else{
      if(!allowed(b,actor))throw Error('Bill access is required.');
      if(op==='edit'){
        if(b.creatorId!==actor)throw Error('Only the creator can edit the shared bill.');
        if(v.expectedRevision!==b.revision)throw Error('This bill changed in another window. Reopen it before saving.');
        const next=validate(v,actor,members);if(b.cycles.some(c=>c.due===b.due&&c.paidIds.length)&&['due','amount','payerIds','allocations'].some(k=>JSON.stringify(next[k])!==JSON.stringify(b[k])))throw Error('Undo recorded payments before changing the due date, amount, or payers.');
        Object.assign(b,next);
      }else if(op==='settings')b.preferences[actor]=settings(v);
      else if(op==='resetSettings')delete b.preferences[actor];
      else if(op==='pay'){
        if(!b.payerIds.includes(actor))throw Error('Only a payer can mark their own payment.');
        if(b.amount==null)throw Error('Enter the amount before marking paid.');
        if(v.due!==b.due)throw Error('This bill changed. Refresh before marking paid.');
        let c=b.cycles.find(c=>c.due===v.due);
        if(!c){const snapshot=Object.fromEntries(Object.entries(b).filter(([k])=>!['cycles','preferences'].includes(k)));c={due:v.due,paidIds:[],payerIds:b.payerIds,snapshot};b.cycles.push(c);}
        if(!c.paidIds.includes(actor))c.paidIds.push(actor);
        if(c.payerIds.every(id=>c.paidIds.includes(id))){const next=nextBillDate(b.due,b.cadence);if(next!==b.due&&b.amountType==='variable')b.amount=null;b.due=next;}
      }else if(op==='undo'){
        const c=b.cycles.find(c=>c.due===v.due);
        if(!c?.paidIds.includes(actor))throw Error('You can undo only your own payment.');
        if(b.cycles.some(other=>other.due>c.due&&other.paidIds.length))throw Error('Undo later payments first.');
        // Restore the unpaid occurrence without discarding later edits to bill details.
        if(c.due!==b.due){b.due=c.due;if(b.amountType==='variable')b.amount=c.snapshot.amount;}
        c.paidIds=c.paidIds.filter(id=>id!==actor);
      }else throw Error('Unknown bill action.');
    }
  }
  if(b&&['edit','pay','undo'].includes(op))b.revision=(b.revision||1)+1;
  localStorage.setItem(key,JSON.stringify(rows));
  return rows.filter(b=>!b.creatorId?members.some(m=>m.id===actor&&m.role==='Owner'):allowed(b,actor)).map(b=>{
    if(!b.creatorId)return {...b,preferences:undefined};
    const {preferences,cycles,...shared}=b,own=preferences[actor]||{};
    return {...shared,...own,defaults:settings(shared),currentPaidIds:cycles.find(c=>c.due===b.due)?.paidIds||[],cycles:cycles.filter(c=>c.paidIds.includes(actor)).map(c=>({...c,snapshot:{...c.snapshot,...own}}))};
  });
}
