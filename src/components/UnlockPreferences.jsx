import React,{useState} from 'react';
export default function UnlockPreferences(){
 const [enabled,setEnabled]=useState(false),[delay,setDelay]=useState('30');
 return <section className="unlock-preferences"><h2>App unlock</h2><p className="modal-description">Preview controls — app locking is not active yet.</p><label className="check-option"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Require unlock</label>{enabled&&<><label>Lock after leaving<select value={delay} onChange={e=>setDelay(e.target.value)}><option value="0">Immediately</option><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option></select></label><p className="modal-description">Stays unlocked while you’re using the app. Unlocking returns you to where you left off.</p></>}</section>;
}
