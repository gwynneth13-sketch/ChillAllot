export function choreMembers(chore,members){
 if(Array.isArray(chore.rotationIds))return chore.rotationIds.filter(id=>members.some(m=>m.id===id));
 if(Array.isArray(chore.assignedIds))return chore.assignedIds.filter(id=>members.some(m=>m.id===id));
 const names=[chore.owner,chore.next].filter(Boolean);return [...new Set(names.map(name=>members.find(m=>m.name===name)?.id).filter(Boolean))];
}
export function advanceChore(chore,members){const ids=choreMembers(chore,members);if(!ids.length)return {...chore,rotationIds:[],owner:'',ownerId:null,next:''};const current=chore.ownerId||members.find(m=>m.name===chore.owner)?.id;const index=ids.indexOf(current);const ownerId=ids[(index+1)%ids.length],nextId=ids[(index+2)%ids.length];return {...chore,rotationIds:ids,ownerId,owner:members.find(m=>m.id===ownerId)?.name||'',next:members.find(m=>m.id===nextId)?.name||''};}

export function reconcileChore(chore,members){
 const original=chore.rotationIds||chore.assignedIds||[chore.owner,chore.next].map(name=>members.find(m=>m.name===name)?.id).filter(Boolean);
 const ids=[...new Set(original.filter(id=>members.some(m=>m.id===id)))];
 const current=chore.ownerId||members.find(m=>m.name===chore.owner)?.id;
 let ownerId=ids.includes(current)?current:null;
 if(!ownerId&&ids.length){const start=original.indexOf(current);for(let n=1;n<=original.length;n++){const candidate=original[(Math.max(start,0)+n)%original.length];if(ids.includes(candidate)){ownerId=candidate;break}}ownerId=ownerId||ids[0]}
 const nextId=ids.length?ids[(ids.indexOf(ownerId)+1)%ids.length]:null;
 return {...chore,rotationIds:ids,ownerId:ownerId||null,owner:members.find(m=>m.id===ownerId)?.name||'',next:members.find(m=>m.id===nextId)?.name||''};
}
