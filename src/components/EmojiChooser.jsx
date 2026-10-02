import React, { useEffect, useRef, useState } from 'react';

const groups={
 'Faces':['😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂','🙃','😉','😍','🥰','😘','😎','🤓','🥳','🤩','😇','🤗','🤔','😴','🤠','😺','😸','😻','🤖','👻','👽','💩','🎃'],
 'People':['👋','👍','👏','🙌','🤝','✌️','🤟','🫶','💪','👑','👶','🧒','👩','👨','🧑','👵','👴','👩‍🍳','👨‍🍳','👩‍🌾','👨‍🌾','👩‍🎨','👨‍🎨','🧑‍💻','🧑‍🚀','🧑‍🎤','🧚','🧙','🦸','🧜'],
 'Animals & nature':['🐶','🐕','🐱','🐈','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐰','🐹','🦄','🐴','🦋','🐝','🐞','🐢','🐬','🐳','🐙','🦉','🐧','🦆','🐣','🦚','🌿','🌵','🌻','🌺','🌸','🌷','🌹','🌼','🍀','🌲','🌈','☀️','🌙','⭐','🌟','🔥','❄️','🌊'],
 'Food':['🍎','🍏','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥝','🥑','🥕','🌽','🥦','🍄','🥨','🍞','🥐','🥞','🧀','🍕','🍔','🌮','🍣','🍜','🍦','🍩','🍪','🎂','🧁','🍫','☕','🫖','🧋'],
 'Activities':['⚽','🏀','🏈','⚾','🎾','🏐','🎱','🏓','🏸','🥊','⛳','🏄','🚴','🏊','🏃','🧘','💃','🕺','🎨','🎭','🎸','🎹','🎺','🎻','🎤','🎧','🎮','🎲','♟️','🧩','🏆','🎯','🎳','🎪'],
 'Objects & places':['🏠','🏡','🏕️','🏖️','🏔️','🏙️','🌎','🚗','🚲','✈️','🚀','⛵','🎈','🎉','🎁','🧸','📚','💡','🔑','💎','🔔','📷','📱','💻','🛒','🧹','🪴','🕯️','🪁','🧵','🧶','🪡'],
 'Hearts & symbols':['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','🩷','🩵','🩶','💖','💕','💞','💝','💘','💫','✨','☮️','☯️','♾️','✅','❣️','💯','🎵','🎶','♻️','🔆','🌐']
};
export default function EmojiChooser({value,onChange}){
 const [open,setOpen]=useState(false),[group,setGroup]=useState('Faces');const root=useRef(null),input=useRef(null),skipFocus=useRef(false);
 useEffect(()=>{if(!open)return;const outside=e=>{if(!root.current?.contains(e.target))setOpen(false)};document.addEventListener('click',outside);return()=>document.removeEventListener('click',outside)},[open]);
 const choose=emoji=>{onChange(emoji);setOpen(false);skipFocus.current=true;input.current.focus();skipFocus.current=false};
 return <div className="emoji-chooser" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);e.stopPropagation()}}}><label className="custom-emoji-label">Your own emoji<input ref={input} autoComplete="off" aria-label="Your own emoji" aria-expanded={open} aria-controls="badge-emoji-picker" placeholder="Tap to choose an emoji" value={value} onFocus={()=>{if(!skipFocus.current)setOpen(true)}} onClick={()=>setOpen(true)} onChange={e=>onChange(e.target.value.trim())}/></label>{open&&<section id="badge-emoji-picker" className="emoji-picker" aria-label="Emoji keyboard"><div className="emoji-picker-heading"><strong>Choose an emoji</strong><button type="button" className="plain small" onClick={()=>setOpen(false)}>Close</button></div><div className="emoji-categories" role="group" aria-label="Emoji categories">{Object.keys(groups).map(name=><button key={name} type="button" aria-pressed={group===name} onClick={()=>setGroup(name)}>{name}</button>)}</div><div className="emoji-keys">{groups[group].map(emoji=><button key={emoji} type="button" aria-label={`Choose ${emoji}`} aria-pressed={value===emoji} onClick={()=>choose(emoji)}>{emoji}</button>)}</div><small>You can also paste an emoji or use your device’s emoji keyboard.</small></section>}</div>
}
