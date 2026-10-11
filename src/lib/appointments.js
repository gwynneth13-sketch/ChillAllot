import {useEffect,useRef,useState} from 'react';
import {appointmentRequest} from './appointmentRequest.js';
import {localAppointmentRequest} from './localAppointments.js';
export function useAppointments(home,cloud,account,members){
 const [appointments,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[readyFor,setReadyFor]=useState('');const generation=useRef(0),mutating=useRef(false);
 const request=(op='list',id='',values={})=>cloud?appointmentRequest(home,op,id,values):localAppointmentRequest(home,op,id,values,account,members);
 useEffect(()=>{setReadyFor('');let alive=true,pending=false;const refresh=async()=>{if(pending||mutating.current)return;pending=true;const token=generation.current;try{const rows=await request();if(alive&&token===generation.current){setRows(rows);setReadyFor(home+':'+account.id);setError('')}}catch(e){if(alive)setError(e.message)}finally{pending=false}};refresh();const timer=setInterval(refresh,3000);window.addEventListener('focus',refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh)}},[home,account.id,cloud]);
 const act=async(op,id,values={})=>{if(mutating.current)throw Error('Please wait for the current save.');mutating.current=true;setBusy(true);generation.current++;try{const rows=await request(op,id,values);setRows(rows);setReadyFor(home+':'+account.id);setError('');return rows}catch(e){setError(e.message);throw e}finally{mutating.current=false;setBusy(false)}};
 return {appointments,error,busy,ready:readyFor===home+':'+account.id,act};
}
