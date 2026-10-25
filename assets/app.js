'use strict';

// GitHub Pages 展示版：不連線、不實際派車，只把回診及用車規劃保留在使用者自己的瀏覽器。
const STORAGE_KEY = 'yoxi-care-senior-pages-v1';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = () => globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const initialState = () => ({appointments:[],rides:[],preferences:{fontSize:'normal',homeAddress:''}});
const validState = value => value && Array.isArray(value.appointments) && Array.isArray(value.rides) && value.preferences && typeof value.preferences === 'object';

function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    const value=raw?JSON.parse(raw):null;
    return validState(value)?value:initialState();
  }catch{return initialState();}
}
let state=loadState();
let currentView='home';
let currentDirection='outbound';
let selectedAppointment=null;
let confirming=null;
let toastTimer;

function update(action,message){
  const next=structuredClone(state);
  action(next);
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));}
  catch{throw Error('瀏覽器無法儲存資料，請確認未使用無痕模式或已開啟儲存權限。');}
  state=next;
  render();
  if(message)toast(message);
}
function nowTaipei(minutes=0){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+minutes*60000));
  const v=Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return {date:`${v.year}-${v.month}-${v.day}`,time:`${v.hour}:${v.minute}`};
}
function timestamp(date,time){return new Date(`${date}T${time}:00+08:00`).getTime();}
function readable(date,time){
  const parsed=timestamp(date,time);
  if(!Number.isFinite(parsed))return `${date} ${time}`;
  return `${new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date(parsed))} ${time}`;
}
function ensureFuture(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('請輸入正確的日期與時間');
  const millis=timestamp(date,time);
  if(!Number.isFinite(millis)||new Date(millis).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'})!==date)throw Error('請輸入正確的日期與時間');
  if(millis<Date.now()-60_000)throw Error('時間已經過去，請選擇未來的日期或時間');
  if(millis>Date.now()+730*86400_000)throw Error('目前最多可規劃未來兩年內的行程');
}
function readText(id,label,max,required=false){
  const text=$(id).value.trim();
  if(required&&!text)throw Error(`請填寫${label}`);
  if([...text].length>max)throw Error(`${label}最多只能輸入 ${max} 個字`);
  return text;
}
function upcoming(){return state.appointments.filter(a=>timestamp(a.date,a.time)>=Date.now()-60_000).sort((a,b)=>timestamp(a.date,a.time)-timestamp(b.date,b.time));}
function orderedRides(){return [...state.rides].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
function toast(message,duration=2600){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;},duration);}
function showError(id,message){const node=$(id);node.textContent=message;node.hidden=false;}
function clearError(id){const node=$(id);node.hidden=true;node.textContent='';}
function openDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function closeDialog(element){const dialog=element?.closest?.('dialog')||element;if(dialog?.open)dialog.close();}
function setView(view){
  if(!['home','appointments','rides','help'].includes(view))return;
  currentView=view;
  for(const name of ['home','appointments','rides','help'])$(`page-${name}`).hidden=(name!==view);
  document.querySelectorAll('[data-view]').forEach(button=>{
    const selected=button.dataset.view===view;
    button.classList.toggle('is-current',selected);
    if(button.closest('nav'))selected?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');
  });
  window.scrollTo({top:0,behavior:'instant'});
}
function renderHome(){
  const first=upcoming()[0];
  $('home-next').innerHTML=first?
    `<div class="preview-date">${esc(readable(first.date,first.time))}</div><div class="preview-title">${esc(first.hospital)}</div><div class="preview-meta">${esc(first.address||'醫院地址尚未填寫')}</div><button class="text-action" type="button" data-action="open-ride" data-direction="outbound" data-appointment-id="${esc(first.id)}">為這次回診安排用車 ›</button>`:
    `<p class="preview-empty">還沒有記錄下一次回診日期。</p><button type="button" class="text-action" data-action="open-appointment">＋ 新增回診</button>`;
  const active=orderedRides().find(r=>r.status==='saved');
  $('home-ride').innerHTML=active?
    `<div class="preview-date">${esc(readable(active.date,active.time))}</div><div class="preview-title">${active.direction==='outbound'?'去醫院':'回家'} · 已儲存規劃</div><div class="preview-meta">${esc(active.pickup)} → ${esc(active.destination)}</div><div class="preview-meta">尚未派車，此處僅供展示。</div><button type="button" class="text-action" data-view="rides">查看用車紀錄 ›</button>`:
    `<p class="preview-empty">目前沒有用車規劃。</p><button class="text-action" type="button" data-action="open-ride" data-direction="outbound">＋ 安排用車</button>`;
}
function renderAppointments(){
  const rows=[...state.appointments].sort((a,b)=>{
    const isPast=a=>timestamp(a.date,a.time)<Date.now()-60_000?1:0;
    return isPast(a)-isPast(b)||timestamp(a.date,a.time)-timestamp(b.date,b.time);
  });
  $('appointment-list').innerHTML=rows.length?rows.map(a=>{
    const past=timestamp(a.date,a.time)<Date.now()-60_000;
    const locked=state.rides.some(r=>r.status==='saved'&&r.appointmentId===a.id);
    return `<article class="record"><div class="record-head"><div><h2 class="record-title">${esc(a.hospital)}</h2><div class="record-date">${esc(readable(a.date,a.time))}</div><div class="record-meta">${esc(a.address||'尚未填寫醫院地址')}</div></div><span class="status-pill ${past?'cancelled':''}">${past?'時間已過':'已記錄'}</span></div>${a.note?`<div class="record-note">備註：${esc(a.note)}</div>`:''}<div class="record-actions"><button type="button" class="btn secondary" data-action="edit-appointment" data-id="${esc(a.id)}">修改</button>${past?'':`<button type="button" class="btn primary" data-action="open-ride" data-direction="outbound" data-appointment-id="${esc(a.id)}">安排用車</button>`}<button type="button" class="btn ghost" data-action="delete-appointment" data-id="${esc(a.id)}" ${locked?'disabled title="請先取消與此回診相關的用車需求"':''}>刪除</button></div>${locked?'<p class="record-meta">如要刪除此回診，請先在「紀錄」取消相關用車規劃。</p>':''}</article>`;
  }).join(''):`<div class="empty-state"><h3>還沒有回診資料</h3><p>記下醫院通知的時間，下次出門更方便。</p><button type="button" class="btn primary" data-action="open-appointment">＋ 新增回診</button></div>`;
}
function renderRides(){
  const rows=orderedRides();
  $('ride-list').innerHTML=rows.length?rows.map(r=>{
    const active=r.status==='saved';
    return `<article class="record ${active?'':'cancelled'}"><div class="record-head"><div><h2 class="record-title">${r.direction==='outbound'?'去醫院':'回家'}</h2><div class="record-date">${esc(readable(r.date,r.time))}</div></div><span class="status-pill ${active?'':'cancelled'}">${active?'已儲存（未派車）':'已取消'}</span></div><div class="trip-route"><div><label>上車地點</label><div class="trip-location">${esc(r.pickup)}</div></div><div class="trip-next" aria-hidden="true">↓</div><div><label>目的地</label><div class="trip-location">${esc(r.destination)}</div></div></div>${active?`<div class="record-actions"><button class="btn secondary" type="button" data-action="cancel-ride" data-id="${esc(r.id)}">取消這筆規劃</button></div>`:''}</article>`;
  }).join(''):`<div class="empty-state"><h3>還沒有用車紀錄</h3><p>點選首頁的「我要去醫院」或「我要回家」即可安排。</p><button type="button" class="btn primary" data-view="home">回首頁</button></div>`;
}
function renderPrefs(){
  // 兼容舊版 localStorage 的 normal / large 偏好設定。
  const fontNames={normal:'一般',large:'大',xlarge:'特大',xxlarge:'超大'};
  const font=Object.hasOwn(fontNames,state.preferences?.fontSize)?state.preferences.fontSize:'normal';
  document.documentElement.dataset.font=font;
  $('homeAddress').value=state.preferences?.homeAddress||'';
  $('font-toggle').textContent=`字體：${fontNames[font]}`;
  $('font-toggle').setAttribute('aria-label',`目前字體為${fontNames[font]}，點選調整字體大小`);
  $('font-toggle-secondary').textContent=`選擇字體大小（目前：${fontNames[font]}）`;
  document.querySelectorAll('[data-font-size]').forEach(button=>{
    const selected=button.dataset.fontSize===font;
    button.setAttribute('aria-pressed',String(selected));
    button.classList.toggle('selected',selected);
  });
}
function render(){renderHome();renderAppointments();renderRides();renderPrefs();}
function openAppointment(id=''){
  $('appointment-form').reset();clearError('appointment-error');
  const a=state.appointments.find(a=>a.id===id);
  $('appointment-modal-title').textContent=a?'修改回診':'新增回診';
  $('appointment-id').value=a?.id||'';
  $('appointment-date').value=a?.date||'';
  $('appointment-time').value=a?.time||'';
  $('appointment-hospital').value=a?.hospital||'';
  $('appointment-address').value=a?.address||'';
  $('appointment-note').value=a?.note||'';
  $('appointment-date').min=nowTaipei().date;
  openDialog('appointment-dialog');
}
function updateDirection(direction){
  currentDirection=direction;
  for(const kind of ['outbound','return']){
    const button=$(`${kind}-button`),chosen=kind===direction;
    button.classList.toggle('active',chosen);
    button.setAttribute('aria-pressed',String(chosen));
  }
  const home=state.preferences.homeAddress||'';
  const hospital=selectedAppointment?.address||selectedAppointment?.hospital||'';
  $('ride-pickup').value=direction==='outbound'?home:hospital;
  $('ride-destination').value=direction==='outbound'?hospital:home;
  $('ride-pickup').placeholder=direction==='outbound'?'例如：家裡的地址':'例如：醫院大門口';
  $('ride-destination').placeholder=direction==='outbound'?'例如：醫院地址':'例如：住家地址';
}
function openRide(direction='outbound',appointmentId=''){
  $('ride-form').reset();clearError('ride-error');
  selectedAppointment=state.appointments.find(a=>a.id===appointmentId)||upcoming()[0]||null;
  $('ride-appointment-id').value=appointmentId||'';
  updateDirection(direction);
  $('ride-date').value=selectedAppointment?.date||nowTaipei().date;
  $('ride-time').value=''; // 不擅自推算出發時間
  $('ride-date').min=nowTaipei().date;
  openDialog('ride-dialog');
}
function openConfirm(kind,id){
  confirming={kind,id};
  const deleting=kind==='delete-appointment';
  $('confirm-title').textContent=deleting?'要刪除這筆回診嗎？':'要取消這筆用車規劃嗎？';
  $('confirm-message').textContent=deleting?'刪除後無法恢復。':'取消後仍會保留在用車紀錄中，標示為已取消。';
  $('confirm-yes').textContent=deleting?'確認刪除':'確認取消';
  openDialog('confirm-dialog');
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-view],button[data-action]');if(!button)return;
  if(button.dataset.view){setView(button.dataset.view);return;}
  const action=button.dataset.action;
  try{
    if(action==='open-font-dialog')openDialog('font-dialog');
    else if(action==='set-font'){
      const value=button.dataset.fontSize;
      const names={normal:'一般',large:'大',xlarge:'特大',xxlarge:'超大'};
      if(!Object.hasOwn(names,value))return;
      update(next=>{next.preferences.fontSize=value;});
      closeDialog($('font-dialog'));
      toast(`已切換為${names[value]}字體`,1200);
    }
    else if(action==='open-appointment')openAppointment();
    else if(action==='edit-appointment')openAppointment(button.dataset.id);
    else if(action==='open-ride')openRide(button.dataset.direction||'outbound',button.dataset.appointmentId||'');
    else if(action==='change-direction')updateDirection(button.dataset.direction);
    else if(action==='close-dialog')closeDialog(button);
    else if(action==='delete-appointment')openConfirm('delete-appointment',button.dataset.id);
    else if(action==='cancel-ride')openConfirm('cancel-ride',button.dataset.id);
  }catch(error){toast(error.message);}
});
$('appointment-form').addEventListener('submit',event=>{
  event.preventDefault();clearError('appointment-error');
  if(!event.currentTarget.reportValidity())return;
  try{
    const id=$('appointment-id').value;
    const date=$('appointment-date').value,time=$('appointment-time').value;
    ensureFuture(date,time);
    const hospital=readText('appointment-hospital','醫院名稱',70,true);
    const address=readText('appointment-address','醫院地址',120);
    const note=readText('appointment-note','備註',150);
    update(next=>{
      if(id){
        const previous=next.appointments.find(a=>a.id===id);
        if(!previous)throw Error('找不到這筆回診，請重新整理');
        Object.assign(previous,{date,time,hospital,address,note,updatedAt:new Date().toISOString()});
      }else{
        if(next.appointments.length>=50)throw Error('回診紀錄已達上限');
        next.appointments.push({id:uid(),date,time,hospital,address,note,createdAt:new Date().toISOString()});
      }
    },'回診資料已儲存');
    closeDialog($('appointment-dialog'));setView('appointments');
  }catch(error){showError('appointment-error',error.message);}
});
$('ride-form').addEventListener('submit',event=>{
  event.preventDefault();clearError('ride-error');
  if(!event.currentTarget.reportValidity())return;
  try{
    const date=$('ride-date').value,time=$('ride-time').value;
    ensureFuture(date,time);
    const pickup=readText('ride-pickup','上車地點',120,true);
    const destination=readText('ride-destination','目的地',120,true);
    if(pickup===destination)throw Error('上車地點與目的地不能相同');
    const appointmentId=$('ride-appointment-id').value||null;
    update(next=>{
      if(appointmentId&&!next.appointments.some(a=>a.id===appointmentId))throw Error('這筆回診已不存在');
      if(next.rides.filter(r=>r.status==='saved').length>=30)throw Error('用車規劃已達上限');
      next.rides.push({id:uid(),direction:currentDirection,date,time,pickup,destination,appointmentId,status:'saved',createdAt:new Date().toISOString()});
    },'用車規劃已儲存（沒有實際派車）');
    closeDialog($('ride-dialog'));setView('rides');
  }catch(error){showError('ride-error',error.message);}
});
$('prefs-form').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    const address=readText('homeAddress','住家地址',120);
    update(next=>{next.preferences.homeAddress=address;},'常用地址已儲存');
  }catch(error){toast(error.message);}
});
$('confirm-yes').addEventListener('click',()=>{
  if(!confirming)return;
  try{
    const {kind,id}=confirming;
    update(next=>{
      if(kind==='delete-appointment'){
        if(next.rides.some(r=>r.status==='saved'&&r.appointmentId===id))throw Error('請先取消此回診對應的用車規劃');
        const index=next.appointments.findIndex(a=>a.id===id);
        if(index<0)throw Error('找不到這筆回診');
        next.appointments.splice(index,1);
      }else{
        const ride=next.rides.find(r=>r.id===id);
        if(!ride||ride.status!=='saved')throw Error('這筆規劃已取消或不存在');
        ride.status='cancelled';ride.cancelledAt=new Date().toISOString();
      }
    },kind==='delete-appointment'?'已刪除回診':'已取消用車規劃');
    closeDialog($('confirm-dialog'));confirming=null;
  }catch(error){toast(error.message);}
});
// 當同一台電腦開啟多個分頁時，資料更新後同步顯示；不跨裝置同步。
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){state=loadState();render();}});
render();setView('home');
