'use strict';

const STORAGE_KEY = 'yoxi-care-senior-pages-v1';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = () => globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const initialState = () => ({appointments:[],rides:[],preferences:{fontSize:'normal',homeAddress:'',driverFont:'small',familyFont:'small'},sharedLocation:null});
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
let currentRole='senior';
let hospitalTarget='appointment';
let hospitalCandidates=[];
let hospitalSearchRequest=0;
const ACTIVE_RIDES=['saved','requested','rematching','failed','assigned','arrived_pickup','onboard'];
const RIDE_LABEL={saved:'正在尋找車輛',requested:'正在尋找車輛',rematching:'重新媒合中',failed:'暫時找不到車輛',assigned:'司機已接單',arrived_pickup:'司機已到達',onboard:'行程中',completed:'行程完成',cancelled:'已取消'};
const isRideActive=r=>ACTIVE_RIDES.includes(r.status);
const APPOINTMENT_STEPS=['準備出門','已抵達醫院','已完成報到','正在候診','看診完成','已安全返家'];
const DEMO_VEHICLE={plate:'ABC-7283',color:'銀白色',model:'四門轎車',etaMinutes:8};
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
const visitDone=a=>Boolean(state.careplus&&state.careplus.queues&&state.careplus.queues[a.id]&&state.careplus.queues[a.id].phase==='done');
function upcoming(){return state.appointments.filter(a=>!['cancelled','paused','completed'].includes(a.status)&&!visitDone(a)&&timestamp(a.date,a.time)>=Date.now()-60_000).sort((a,b)=>timestamp(a.date,a.time)-timestamp(b.date,b.time));}
function orderedRides(){return [...state.rides].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
function toast(message,duration=2600){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;},duration);}
function showError(id,message){const node=$(id);node.textContent=message;node.hidden=false;}
function clearError(id){const node=$(id);node.hidden=true;node.textContent='';}
function openDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function closeDialog(element){const dialog=element?.closest?.('dialog')||element;if(dialog?.open)dialog.close();}
function setView(view){
  const views=['home','appointments','booking','rides','help','tracking','driver','family','visit'];
  if(!views.includes(view))return;
  currentView=view;
  for(const name of views)$(`page-${name}`).hidden=(name!==view);
  document.documentElement.dataset.view=view;
  document.querySelectorAll('[data-view]').forEach(button=>{
    const selected=button.dataset.view===view;
    button.classList.toggle('is-current',selected);
    if(button.closest('nav'))selected?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');
  });
  window.scrollTo({top:0,behavior:'instant'});
}
function renderHome(){
  const first=upcoming()[0];
  $('home-next').innerHTML=first&&first.recurringBookingId?
    `<div class="preview-date">${esc(readable(first.date,first.time))}</div><div class="preview-title">${esc(first.hospital)}</div><div class="preview-meta">長期預約・去程已安排，出門時間依看診進度建議</div><button class="text-action" type="button" data-cpa="open-visit">查看看診當天進度 ›</button>`:
    first?
    `<div class="preview-date">${esc(readable(first.date,first.time))}</div><div class="preview-title">${esc(first.hospital)}</div><div class="preview-meta">${esc(first.address||'醫院地址尚未填寫')}</div><button class="text-action" type="button" data-action="open-ride" data-direction="outbound" data-appointment-id="${esc(first.id)}">為這次回診安排用車 ›</button>`:
    `<p class="preview-empty">還沒有記錄下一次回診日期。</p><button type="button" class="text-action" data-action="open-appointment">＋ 新增回診</button>`;
  const active=orderedRides().find(r=>isRideActive(r));
  $('home-ride').innerHTML=active?
    `<div class="record-head"><div><div class="preview-date">${esc(readable(active.date,active.time))}</div><div class="preview-title">${active.direction==='outbound'?'去醫院':'回家'}</div></div><span class="status-pill">${esc(RIDE_LABEL[active.status]||'')}</span></div><div class="preview-meta">${esc(active.pickup)} → ${esc(active.destination)}</div><button type="button" class="text-action" data-action="open-tracking" data-id="${esc(active.id)}">${['assigned','arrived_pickup','onboard'].includes(active.status)?'查看車牌與抵達時間 ›':'查看叫車狀態 ›'}</button>`:
    `<p class="preview-empty">目前沒有進行中的叫車。</p><button class="text-action" type="button" data-action="open-ride" data-direction="outbound">＋ 叫車</button>`;
}
function renderAppointments(){
  const rows=state.appointments.filter(a=>!a.recurringBookingId).sort((a,b)=>{
    const isPast=a=>timestamp(a.date,a.time)<Date.now()-60_000?1:0;
    return isPast(a)-isPast(b)||timestamp(a.date,a.time)-timestamp(b.date,b.time);
  });
  $('appointment-list').innerHTML=rows.length?rows.map(a=>{
    const past=timestamp(a.date,a.time)<Date.now()-60_000;
    const locked=state.rides.some(r=>isRideActive(r)&&r.appointmentId===a.id);
    return `<article class="record"><div class="record-head"><div><h2 class="record-title">${esc(a.hospital)}</h2><div class="record-date">${esc(readable(a.date,a.time))}</div><div class="record-meta">${esc(a.address||'尚未填寫醫院地址')}</div></div><span class="status-pill ${past?'cancelled':''}">${past?'時間已過':'已記錄'}</span></div>${a.note?`<div class="record-note">備註：${esc(a.note)}</div>`:''}<div class="record-actions"><button type="button" class="btn secondary" data-action="edit-appointment" data-id="${esc(a.id)}">修改</button>${past?'':`<button type="button" class="btn primary" data-action="open-ride" data-direction="outbound" data-appointment-id="${esc(a.id)}">安排用車</button>`}<button type="button" class="btn ghost" data-action="delete-appointment" data-id="${esc(a.id)}" ${locked?'disabled title="請先取消與此回診相關的用車需求"':''}>刪除</button></div>${(Number(a.progress)||0)<4?`<div class="progress-prompt"><span>看診進度：${esc(APPOINTMENT_STEPS[Number(a.progress)||0])}</span><button type="button" class="btn secondary" data-action="update-progress" data-id="${esc(a.id)}" data-stage="${(Number(a.progress)||0)+1}">標記${esc(APPOINTMENT_STEPS[(Number(a.progress)||0)+1])}</button></div>`:''}${locked?'<p class="record-meta">如要刪除此回診，請先在「紀錄」取消相關用車規劃。</p>':''}</article>`;
  }).join(''):`<p class="preview-empty">沒有另外記下的單次回診。</p>`;
}
function renderRides(){
  const rows=orderedRides();
  $('ride-list').innerHTML=rows.length?rows.map(r=>{
    const active=isRideActive(r);
    const cancellable=['saved','requested','rematching','failed','assigned','arrived_pickup'].includes(r.status);
    return `<article class="record ${active||r.status==='completed'?'':'cancelled'}"><div class="record-head"><div><h2 class="record-title">${r.direction==='outbound'?'去醫院':'回家'}${r.kind==='return'?'（看診後叫車）':''}</h2><div class="record-date">${esc(readable(r.date,r.time))}</div>${r.vehicleRequirement==='wheelchair'?'<div class="record-meta">無障礙輪椅車輛</div>':''}</div><span class="status-pill ${active?'':'cancelled'}">${esc(RIDE_LABEL[r.status]||'')}</span></div><div class="trip-route"><div><label>上車地點</label><div class="trip-location">${esc(r.pickup)}</div></div><div class="trip-next" aria-hidden="true"><svg class="ic" aria-hidden="true" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-down"/></svg></div><div><label>目的地</label><div class="trip-location">${esc(r.destination)}</div></div></div>${active?`<div class="record-actions"><button class="btn primary" type="button" data-action="open-tracking" data-id="${esc(r.id)}">${['assigned','arrived_pickup','onboard'].includes(r.status)?'查看車輛資訊':'查看叫車狀態'}</button>${cancellable?`<button class="btn secondary" type="button" data-action="cancel-ride" data-id="${esc(r.id)}">取消叫車</button>`:''}</div>`:''}</article>`;
  }).join(''):`<div class="empty-state"><h3>還沒有用車紀錄</h3><p>點選首頁的「我要去醫院」或「我要回家」即可叫車。</p><button type="button" class="btn primary" data-view="home">回首頁</button></div>`;
}
function renderPrefs(){
  const fontNames={normal:'一般',large:'大',xlarge:'特大',xxlarge:'超大'};
  const font=Object.hasOwn(fontNames,state.preferences?.fontSize)?state.preferences.fontSize:'normal';
  document.documentElement.dataset.font=font;
  document.documentElement.dataset.role=currentRole;
  const roleFont=state.preferences?.[currentRole+'Font']||'small';
  document.documentElement.dataset.roleFont=roleFont;
  const roleNames={small:'小 20pt',medium:'中 26pt',large:'大 32pt'};
  const displayFont=currentRole==='senior'?fontNames[font]:(roleNames[roleFont]||roleNames.small);
  $('font-toggle').textContent=`字體：${displayFont}`;
  $('font-toggle').setAttribute('aria-label',`目前字體為${displayFont}，點選調整字體大小`);
  const fontOptions=$('font-options')||document.querySelector('.font-options');
  if(currentRole==='senior')fontOptions.innerHTML=Object.entries(fontNames).map(([key,value])=>`<button type="button" class="font-option ${font===key?'selected':''}" data-action="set-font" data-font-size="${key}" aria-pressed="${font===key}">${value}</button>`).join('');
  else fontOptions.innerHTML=Object.entries(roleNames).map(([key,value])=>`<button type="button" class="font-option ${roleFont===key?'selected':''}" data-action="set-font" data-font-size="${key}" aria-pressed="${roleFont===key}">${value}</button>`).join('');
  $('homeAddress').value=state.preferences?.homeAddress||'';

  $('font-toggle-secondary').textContent=`選擇字體大小（目前：${fontNames[font]}）`;

}
function render(){renderHome();renderAppointments();renderRides();renderPrefs();renderTracking();renderDriver();renderFamily();if(typeof renderCare==='function')renderCare();}
function openAppointment(id=''){
  $('appointment-form').reset();clearError('appointment-error');
  const a=state.appointments.find(a=>a.id===id);
  $('appointment-modal-title').textContent=a?(a.recurringBookingId?'修改這次回診':'修改回診'):'新增回診';
  $('appointment-sub').textContent=a&&a.recurringBookingId?'只修改這一次，其他日期維持長期預約的設定。':'請依照醫院通知的時間填寫。';
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
    if(!button)continue;
    button.classList.toggle('active',chosen);
    button.setAttribute('aria-pressed',String(chosen));
  }
  const home=state.preferences.homeAddress||'';
  const hospital=selectedAppointment?.address||selectedAppointment?.hospital||'';
  $('ride-pickup').value=direction==='outbound'?home:hospital;
  $('ride-destination').value=direction==='outbound'?hospital:home;
  $('ride-pickup').placeholder=direction==='outbound'?'例如：家裡的地址':'例如：醫院大門口';
  $('ride-destination').placeholder=direction==='outbound'?'例如：醫院地址':'例如：住家地址';
  $('ride-pickup-hospitals').hidden=direction!=='return';
  $('ride-destination-hospitals').hidden=direction!=='outbound';
}
function openRide(direction='outbound',appointmentId=''){
  if(direction==='return'&&typeof cpOpenGoHome==='function'){cpOpenGoHome();return;}
  direction='outbound';
  $('ride-form').reset();clearError('ride-error');
  $('ride-voice-result').hidden=true;$('ride-voice-fallback').hidden=true;
  selectedAppointment=state.appointments.find(a=>a.id===appointmentId)||upcoming()[0]||null;
  $('ride-appointment-id').value=selectedAppointment?.id||'';
  updateDirection(direction);
  $('ride-date').value=selectedAppointment?.date||nowTaipei().date;
  $('ride-time').value='';
  $('ride-date').min=nowTaipei().date;
  const booking=state.careplus&&state.careplus.bookings.find(b=>b.status==='active');
  $('ride-wheel').checked=Boolean(booking&&booking.wheelchairRequired);
  openDialog('ride-dialog');
}
function openConfirm(kind,id){
  confirming={kind,id};
  if(typeof cpConfirmFn!=='undefined')cpConfirmFn=null;
  const deleting=kind==='delete-appointment';
  $('confirm-title').textContent=deleting?'要刪除這筆回診嗎？':'要取消這筆叫車安排嗎？';
  $('confirm-message').textContent=deleting?'刪除後無法恢復。':'取消後，這趟行程會標示為已取消。';
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
      const names=currentRole==='senior'?{normal:'一般',large:'大',xlarge:'特大',xxlarge:'超大'}:{small:'小 20pt',medium:'中 26pt',large:'大 32pt'};
      if(!Object.hasOwn(names,value))return;
      update(next=>{next.preferences[currentRole==='senior'?'fontSize':currentRole+'Font']=value;});
      closeDialog($('font-dialog'));
      toast(`已切換為${names[value]}字體`,1200);
    }
    else if(action==='switch-role')switchRole(button.dataset.role);
    else if(action==='back-senior')setView('home');
    else if(action==='open-tracking'){selectedRideId=button.dataset.id;setView('tracking');}
    else if(action==='toggle-trip'){tripCollapsed=!tripCollapsed;renderTracking();}
    else if(action==='open-hospitals')openHospitalPicker(button.dataset.target);
    else if(action==='find-nearby')findNearbyHospitals();
    else if(action==='select-hospital')selectHospital(button.dataset.index);
    else if(action==='update-progress')updateProgress(button.dataset.id,Number(button.dataset.stage));
    else if(action==='driver-progress')cpEvents.driverProgress(button.dataset.id);
    else if(action==='refresh-family'){renderFamily();toast('已更新畫面資料',1200);}
    else if(action==='share-location')shareLocation();
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
        if(previous.recurringBookingId&&next.careplus){
          previous.appointmentTime=time;
          const q=next.careplus.queues[id];
          if(q&&q.phase==='before'){delete next.careplus.queues[id];delete next.careplus.outbound[id];if(typeof cpEnsureFocus==='function'){cpEnsureFocus(next);cpSync(next);}}
        }
      }else{
        if(next.appointments.length>=50)throw Error('回診紀錄已達上限');
        next.appointments.push({id:uid(),date,time,hospital,address,note,createdAt:new Date().toISOString()});
      }
    },'回診資料已儲存');
    const edited=id&&state.appointments.find(a=>a.id===id);
    closeDialog($('appointment-dialog'));setView(edited&&edited.recurringBookingId?'booking':'appointments');
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
    if(appointmentId&&!state.appointments.some(a=>a.id===appointmentId))throw Error('這筆回診已不存在');
    if(state.rides.filter(isRideActive).length>=30)throw Error('進行中的叫車已達上限');
    const duplicate=state.rides.find(r=>isRideActive(r)&&r.date===date&&r.time===time&&r.pickup===pickup&&r.destination===destination);
    if(duplicate)throw Error('這趟叫車已經送出，請在用車紀錄查看狀態');
    selectedRideId=cpEvents.requestSingleRide({direction:currentDirection,appointmentId,date,time,pickup,destination,wheelchair:$('ride-wheel').checked});
    closeDialog($('ride-dialog'));setView('tracking');
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
    if(kind==='delete-appointment')update(next=>{
      if(next.rides.some(r=>isRideActive(r)&&r.appointmentId===id))throw Error('請先取消此回診對應的用車規劃');
      const index=next.appointments.findIndex(a=>a.id===id);
      if(index<0)throw Error('找不到這筆回診');
      next.appointments.splice(index,1);
    },'已刪除回診');
    else cpEvents.cancelRide(id);
    closeDialog($('confirm-dialog'));confirming=null;
    if(currentView==='tracking')setView('home');
  }catch(error){toast(error.message);}
});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){state=loadState();render();}});
$('hospital-query').addEventListener('input',()=>renderHospitalOptions());



let selectedRideId='';
let tripCollapsed=false;
const demoHospitals=[
 {name:'臺大醫院',address:'台北市中正區常德街 1 號',lat:25.0405,lon:121.5190},
 {name:'台北馬偕紀念醫院',address:'台北市中山區中山北路二段 92 號',lat:25.0586,lon:121.5225},
 {name:'國泰綜合醫院',address:'台北市大安區仁愛路四段 280 號',lat:25.0368,lon:121.5536},
 {name:'衛生福利部苗栗醫院',address:'苗栗縣苗栗市為公路 747 號',lat:24.5734,lon:120.8371}
];
function switchRole(role){
  if(!['senior','driver','family'].includes(role))return;
  currentRole=role;
  document.documentElement.dataset.role=role;
  const app=document.querySelector('.app-shell');
  app.classList.toggle('other-role',role!=='senior');
  document.querySelectorAll('.role-tabs [data-role]').forEach(b=>{const on=b.dataset.role===role;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  setView(role==='senior'?'home':role);
  render();
}
function mapUrl(query){return 'https://maps.google.com/maps?output=embed&q='+encodeURIComponent(query);}
function mapOpenUrl(query){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(query);}
function setGoogleMap(id,linkId,query){
  const frame=$(id),target=mapUrl(query);
  if(frame.dataset.query!==query){frame.src=target;frame.dataset.query=query;}
  const link=$(linkId);if(link)link.href=mapOpenUrl(query);
}
function focusedRide(){return state.rides.find(r=>r.id===selectedRideId&&isRideActive(r))||orderedRides().find(isRideActive);}
function renderTracking(){
 const box=$('tracking-content');if(!box)return;
 const r=focusedRide();
 if(!r){box.innerHTML='<div class="empty-state"><h2>目前沒有進行中的叫車</h2><p>請返回首頁選擇去醫院或回家。</p><button class="btn primary" data-action="back-senior">返回首頁</button></div>';return;}
 const route=`<section class="card trip-details"><div class="section-heading"><h2>搭車詳細資訊</h2><button type="button" class="small-link" data-action="toggle-trip" aria-expanded="${!tripCollapsed}">${tripCollapsed?'展開詳細資訊':'縮小資訊'}</button></div>${tripCollapsed?'<p class="preview-meta">已收起詳細資訊。</p>':`<div class="trip-route"><div><label>上車地點</label><div class="trip-location">${esc(r.pickup)}</div></div><div class="trip-next" aria-hidden="true"><svg class="ic" aria-hidden="true" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-down"/></svg></div><div><label>目的地</label><div class="trip-location">${esc(r.destination)}</div></div></div><div class="record-date">${esc(readable(r.date,r.time))}</div>${r.vehicleRequirement==='wheelchair'?'<p class="record-meta">車輛需求：無障礙輪椅車輛</p>':''}`}</section>`;
 if(['saved','requested','rematching','failed'].includes(r.status)){
  const failed=r.status==='failed';
  box.innerHTML=`<section class="vehicle-hero cp-hero-wait"><span class="hero-chip">${failed?'暫時找不到車輛':'正在尋找車輛'}</span><p class="hero-label">${failed?'附近暫時沒有合適的車輛':r.status==='rematching'?'原司機無法接單，正在改派其他待命司機':'已通知附近的待命司機'}</p><h2 class="vehicle-plate cp-plate-wait">${failed?'請重新叫車':'等待司機接單'}</h2><p class="vehicle-stage">司機接單後，這裡會顯示車牌、車色與抵達時間。</p></section>${route}
  <div class="tracking-actions">${failed?`<button type="button" class="btn primary full" data-cpa="retry-ride" data-id="${esc(r.id)}">重新叫車</button>`:''}<button type="button" class="btn secondary full" data-action="back-senior">返回首頁</button><button type="button" class="btn danger full" data-action="cancel-ride" data-id="${esc(r.id)}">取消叫車</button></div>`;
  return;
 }
 const vehicle=r.demoVehicle||DEMO_VEHICLE;
 const driver=r.driverId&&typeof cpDriver==='function'?cpDriver(r.driverId):null;
 const minutes=Math.max(0,vehicle.etaMinutes-Math.floor((Date.now()-new Date(r.assignedAt||r.createdAt).getTime())/60000));
 const stage=r.status==='arrived_pickup'?'車輛已到達，請上車':r.status==='onboard'?'行程進行中':minutes>0?`預計 ${minutes} 分鐘後到達`:'車輛即將到達';
 box.innerHTML=`<section class="vehicle-hero"><span class="hero-chip">${esc(RIDE_LABEL[r.status])}</span><span class="hero-chip cp-chip-soft">範例車輛</span><p class="hero-label">${r.status==='onboard'?'正在前往目的地':'請留意車牌號碼'}</p><h2 class="vehicle-plate">${esc(vehicle.plate)}</h2><div class="vehicle-grid"><div><span>車輛</span><strong>${esc(vehicle.color)}${esc(vehicle.model||'')}</strong></div><div><span>預估抵達</span><strong>${r.status==='onboard'?'行程中':r.status==='arrived_pickup'?'已到達':minutes>0?minutes+' 分鐘':'即將到達'}</strong></div></div><p class="vehicle-stage">${driver?`司機 ${esc(driver.name)}・`:''}${esc(stage)}</p></section>${route}
 <div class="tracking-actions"><button type="button" class="btn secondary full" data-action="share-location">同意分享本次位置給家屬</button><button type="button" class="btn secondary full" data-action="back-senior">返回首頁</button>${['assigned','arrived_pickup'].includes(r.status)?`<button type="button" class="btn danger full" data-action="cancel-ride" data-id="${esc(r.id)}">取消叫車</button>`:''}</div>`;
}
function renderDriver(){if(typeof cpRenderDriver==='function'&&state.careplus)cpRenderDriver();}
function updateProgress(id,stage){
 if(!Number.isInteger(stage)||stage<1||stage>4)return;
 update(s=>{const a=s.appointments.find(x=>x.id===id);if(!a)throw Error('找不到回診資料');a.progress=stage;a.progressUpdatedAt=new Date().toISOString();},'已更新看診進度');
}
function renderFamily(){if(typeof cpRenderFamily==='function'&&state.careplus)cpRenderFamily();}
function shareLocation(){
 if(!navigator.geolocation){toast('瀏覽器不支援定位');return;}
 navigator.geolocation.getCurrentPosition(pos=>{
  update(s=>{s.sharedLocation={lat:pos.coords.latitude,lon:pos.coords.longitude,at:new Date().toISOString()};},'已分享本次位置');
 },()=>toast('無法取得位置，請檢查定位權限'),{enableHighAccuracy:false,timeout:9000,maximumAge:30000});
}
function openHospitalPicker(target){
 hospitalTarget=['appointment','ride-pickup','ride-destination','gh-pickup'].includes(target)?target:'appointment';
 hospitalCandidates=[...demoHospitals];
 $('hospital-query').value='';
 $('hospital-status').textContent='常用院所。按「使用目前位置」可搜尋附近院所。';
 renderHospitalOptions();openDialog('hospital-dialog');
}
function renderHospitalOptions(){
 const q=$('hospital-query').value.trim().toLowerCase();
 const choices=hospitalCandidates.filter(h=>(h.name+' '+h.address).toLowerCase().includes(q));
 $('hospital-options').innerHTML=choices.length?choices.map(h=>{const i=hospitalCandidates.indexOf(h);return `<button type="button" class="hospital-choice" data-action="select-hospital" data-index="${i}"><strong>${esc(h.name)}</strong><span>${esc(h.address||'地址未提供，請自行補上')}</span>${Number.isFinite(h.km)?`<small>約 ${h.km.toFixed(1)} 公里</small>`:''}</button>`;}).join(''):'<p class="preview-empty">找不到符合的院所，可以直接回到表單手動輸入地址。</p>';
}
function selectHospital(index){
 const h=hospitalCandidates[Number(index)];if(!h)return;
 if(hospitalTarget==='appointment'){$('appointment-hospital').value=h.name;$('appointment-address').value=h.address||'';}
 else $(hospitalTarget).value=h.address||h.name;
 closeDialog($('hospital-dialog'));toast(`已帶入${h.name}`,1200);
}
function findNearbyHospitals(){
 if(!navigator.geolocation){$('hospital-status').textContent='此瀏覽器無法使用定位，仍可從選單選擇或自行輸入。';return;}
 $('hospital-status').textContent='正在取得位置，請確認瀏覽器的定位權限…';
 const request=++hospitalSearchRequest;
 navigator.geolocation.getCurrentPosition(async ({coords})=>{
  if(request!==hospitalSearchRequest)return;
  $('hospital-status').textContent='正在從 OpenStreetMap 搜尋附近醫院與診所…';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
  try{
   const q=`[out:json][timeout:8];(nwr["amenity"~"^(hospital|clinic)$"](around:6500,${coords.latitude},${coords.longitude}););out center 35;`;
   const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},signal:controller.signal});
   if(!response.ok)throw Error('查詢暫時無法使用');
   const body=await response.json();
   const results=(body.elements||[]).map(e=>{
     const lat=e.lat??e.center?.lat,lon=e.lon??e.center?.lon,t=e.tags||{};
     const name=t['name:zh']||t.name;if(!name||!Number.isFinite(lat)||!Number.isFinite(lon))return null;
     const km=haversine(coords.latitude,coords.longitude,lat,lon);
     const address=[t['addr:city']||t['addr:district']||'',t['addr:street']||'',t['addr:housenumber']||''].join('').trim();
     return {name,address,km,lat,lon};
   }).filter(Boolean).sort((a,b)=>a.km-b.km).slice(0,15);
   if(!results.length)throw Error('附近沒有可顯示的醫院資料');
   hospitalCandidates=results;
   $('hospital-status').textContent=`已找到 ${results.length} 間附近院所（資料來源：OpenStreetMap）。地址不完整時可自行補充。`;
   renderHospitalOptions();
  }catch(e){$('hospital-status').textContent=`${e.name==='AbortError'?'搜尋逾時':e.message}，目前仍可使用下方範例或自行輸入。`;hospitalCandidates=[...demoHospitals];renderHospitalOptions();}
  finally{clearTimeout(timer);}
 },()=>{$('hospital-status').textContent='未取得定位權限，仍可從範例選擇或自行輸入地址。';},{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
}
function haversine(a,b,c,d){const r=Math.PI/180;const dl=(c-a)*r,do_=(d-b)*r;return 6371*2*Math.asin(Math.sqrt(Math.sin(dl/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(do_/2)**2));}

setView('home');
setInterval(()=>{if(currentView==='tracking')renderTracking();},30_000);
setInterval(()=>{if(currentRole==='family'){state=loadState();renderFamily();}},3*60_000);
