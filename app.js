/* RPG Hub — WebRTC/P2P, sem Firebase.
   Usa PeerJS apenas como sinalização para estabelecer a conexão WebRTC.
*/

export let state = loadState();
export let currentUser = null;
export let role = location.pathname.endsWith('/mestre.html') ? 'master' : 'player';
export let roomId = new URLSearchParams(location.search).get('room') || localStorage.getItem('rpgRoom') || '';
export let peer = null;
export let connections = [];
export let connectionStatus = 'offline';

const peers = new Map();

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
export function bar(v, m) {
  const pct = Math.max(0, Math.min(100, (Number(v) || 0) / (Number(m) || 1) * 100));
  return `<div class="bar"><div class="fill" style="width:${pct}%"></div></div>`;
}

function loadState(){
  try { return JSON.parse(localStorage.getItem('rpgState') || '') || defaultState(); }
  catch { return defaultState(); }
}
function defaultState(){
  return { campaign:{title:'Ecos do Véu',chapter:'Capítulo 1: O Despertar',story:'',objective:'Investigar a cidade e descobrir o que está acontecendo.'}, players:{}, rolls:{}, map:{title:'Mapa da campanha',image:'',markers:{}} };
}
function persist(){ localStorage.setItem('rpgState', JSON.stringify(state)); }
function rerender(){ window.renderPage?.(); }
function makeId(prefix='id'){ return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

export function sortedRolls(){ return Object.values(state.rolls||{}).sort((a,b)=>(b.time||0)-(a.time||0)).slice(0,50); }
export function markers(){ return Object.entries(state.map?.markers||{}).map(([id,v])=>({id,...v})); }

function broadcast(message){
  for(const conn of connections){ if(conn.open) conn.send(message); }
}
function sendToMaster(message){
  for(const conn of connections){ if(conn.open && conn.metadata?.role === 'master') conn.send(message); }
}

function applySnapshot(snapshot){
  state = snapshot || defaultState();
  persist();
  rerender();
}

function masterHandle(message, conn){
  if(!message || typeof message.type !== 'string') return;
  if(message.type === 'hello'){
    conn.metadata = { ...(conn.metadata||{}), role:'player', uid:message.uid };
    if(message.player) state.players[message.uid] = {...message.player, uid:message.uid};
    conn.send({type:'snapshot', state});
    broadcast({type:'snapshot', state});
    persist(); rerender();
    return;
  }
  if(message.type === 'player-update'){
    const uid = message.uid;
    if(!uid) return;
    state.players[uid] = {...(state.players[uid]||{}), ...message.data, uid};
    persist();
    broadcast({type:'snapshot', state});
    rerender();
    return;
  }
  if(message.type === 'roll'){
    const r = {...message.roll, time:Date.now()};
    state.rolls[r.id || makeId('roll')] = r;
    persist(); broadcast({type:'snapshot', state}); rerender();
    return;
  }
}

function attachConnection(conn, isIncoming=false){
  connections.push(conn);
  connectionStatus = 'connected';
  conn.on('open', ()=>{
    if(role==='player') conn.send({type:'hello',uid:currentUser,player:state.players[currentUser]||null});
    rerender();
  });
  conn.on('data', msg=>{
    if(role==='master') masterHandle(msg,conn);
    else if(msg?.type==='snapshot') applySnapshot(msg.state);
  });
  conn.on('close', ()=>{ connections=connections.filter(c=>c!==conn); connectionStatus=connections.length?'connected':'waiting'; rerender(); });
  conn.on('error', ()=>{ rerender(); });
  if(isIncoming && conn.open && role==='player') conn.send({type:'hello',uid:currentUser,player:state.players[currentUser]||null});
  rerender();
}

export function createRoom(){
  role='master';
  if(peer){ try{peer.destroy();}catch{} }
  peer = new Peer();
  connectionStatus='connecting';
  peer.on('open', id=>{
    roomId=id; localStorage.setItem('rpgRoom',id); persist();
    const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(id)}`;
    window.onRoomReady?.(id,url); rerender();
  });
  peer.on('connection', conn=>attachConnection(conn,true));
  peer.on('disconnected',()=>{connectionStatus='offline';rerender()});
  peer.on('error',e=>{connectionStatus='error';window.onPeerError?.(e);rerender()});
}

export function joinRoom(id){
  role='player'; roomId=id || roomId;
  if(!roomId) return;
  localStorage.setItem('rpgRoom',roomId);
  if(!currentUser) currentUser=localStorage.getItem('rpgUid') || makeId('player');
  localStorage.setItem('rpgUid',currentUser);
  if(peer){try{peer.destroy()}catch{}}
  peer=new Peer(); connectionStatus='connecting'; rerender();
  peer.on('open',()=>{
    const conn=peer.connect(roomId,{reliable:true,metadata:{role:'player'}});
    attachConnection(conn);
  });
  peer.on('error',e=>{connectionStatus='error';window.onPeerError?.(e);rerender()});
  peer.on('disconnected',()=>{connectionStatus='offline';rerender()});
}

export function startPlayer(){
  currentUser=localStorage.getItem('rpgUid') || makeId('player');
  localStorage.setItem('rpgUid',currentUser);
  const id=new URLSearchParams(location.search).get('room') || localStorage.getItem('rpgRoom');
  if(id) joinRoom(id); else { connectionStatus='waiting'; rerender(); }
}

export function startMaster(){
  role='master';
  // A master can reopen an existing room by entering its code, or create a new one.
  const saved=localStorage.getItem('rpgMasterRoom');
  if(saved){ roomId=saved; }
  connectionStatus='waiting'; rerender();
}

export function reconnectMaster(id){
  roomId=id || roomId;
  if(!roomId) return createRoom();
  role='master';
  if(peer){try{peer.destroy()}catch{}}
  peer=new Peer(roomId);
  connectionStatus='connecting';
  peer.on('open', id2=>{roomId=id2;localStorage.setItem('rpgMasterRoom',id2);window.onRoomReady?.(id2,`${location.origin}${location.pathname}?room=${encodeURIComponent(id2)}`);rerender()});
  peer.on('connection',conn=>attachConnection(conn,true));
  peer.on('error',e=>{connectionStatus='error';window.onPeerError?.(e);rerender()});
}

export async function createOrUpdatePlayer(data){
  if(!currentUser) return;
  state.players[currentUser]={...(state.players[currentUser]||{}),...data,uid:currentUser,updatedAt:Date.now()};
  persist(); rerender();
  sendToMaster({type:'player-update',uid:currentUser,data:state.players[currentUser]});
}
export async function updatePlayer(id,data){
  state.players[id]={...(state.players[id]||{}),...data,uid:id}; persist(); rerender();
  if(role==='master') broadcast({type:'snapshot',state});
}
export async function saveCampaign(data){ state.campaign={...(state.campaign||{}),...data};persist();rerender();if(role==='master')broadcast({type:'snapshot',state}); }
export async function saveMap(data){ state.map={...(state.map||{}),...data};persist();rerender();if(role==='master')broadcast({type:'snapshot',state}); }
export async function saveMarker(id,data){ state.map.markers={...(state.map.markers||{}),[id]:data};persist();rerender();if(role==='master')broadcast({type:'snapshot',state}); }
export async function deleteMarker(id){ delete state.map.markers[id];persist();rerender();if(role==='master')broadcast({type:'snapshot',state}); }

export function roll(sides){
  if(!currentUser) return;
  const p=state.players[currentUser]||{};
  const result=Math.floor(Math.random()*sides)+1;
  const r={id:makeId('roll'),uid:currentUser,player:p.name||'Investigador',formula:`d${sides}`,result,time:Date.now()};
  if(role==='master') { state.rolls[r.id]=r; persist(); broadcast({type:'snapshot',state}); rerender(); }
  else sendToMaster({type:'roll',roll:r});
  if($('#rollResult')) $('#rollResult').textContent=result;
}

export function copyRoomLink(){
  const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;
  navigator.clipboard?.writeText(url); return url;
}
