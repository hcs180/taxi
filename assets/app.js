'use strict';

// GitHub Pages 展示版：不連線、不實際派車，只把回診及用車規劃保留在使用者自己的瀏覽器。
const STORAGE_KEY = 'yoxi-care-senior-pages-v1'; // 延用舊展示版鍵值，保留既有使用者資料。
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
const ACTIVE_RIDES=['saved','assigned','arrived_pickup','onboard'];
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
function upcoming(){return state.appointments.filter(a=>timestamp(a.date,a.time)>=Date.now()-60_000).sort((a,b)=>timestamp(a.date,a.time)-timestamp(b.date,b.time));}
function orderedRides(){return [...state.rides].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
function toast(message,duration=2600){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;},duration);}
function showError(id,message){const node=$(id);node.textContent=message;node.hidden=false;}
function clearError(id){const node=$(id);node.hidden=true;node.textContent='';}
function openDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function closeDialog(element){const dialog=element?.closest?.('dialog')||element;if(dialog?.open)dialog.close();}
function setView(view){
  if(!['home','appointments','rides','help','tracking','driver','family'].includes(view))return;
  currentView=view;
  for(const name of ['home','appointments','rides','help','tracking','driver','family'])$(`page-${name}`).hidden=(name!==view);
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
  $('home-next').innerHTML=first?
    `<div class="preview-date">${esc(readable(first.date,first.time))}</div><div class="preview-title">${esc(first.hospital)}</div><div class="preview-meta">${esc(first.address||'醫院地址尚未填寫')}</div><button class="text-action" type="button" data-action="open-ride" data-direction="outbound" data-appointment-id="${esc(first.id)}">為這次回診安排用車 ›</button>`:
    `<p class="preview-empty">還沒有記錄下一次回診日期。</p><button type="button" class="text-action" data-action="open-appointment">＋ 新增回診</button>`;
  const active=orderedRides().find(r=>isRideActive(r));
  $('home-ride').innerHTML=active?
    `<div class="preview-date">${esc(readable(active.date,active.time))}</div><div class="preview-title">${active.direction==='outbound'?'去醫院':'回家'} · 示範接送資訊</div><div class="preview-meta">${esc(active.pickup)} → ${esc(active.destination)}</div><div class="preview-meta">展示車輛資料，不代表實際派車。</div><button type="button" class="text-action" data-action="open-tracking" data-id="${esc(active.id)}">查看車牌與抵達時間 ›</button>`:
    `<p class="preview-empty">目前沒有用車規劃。</p><button class="text-action" type="button" data-action="open-ride" data-direction="outbound">＋ 安排用車</button>`;
}
function renderAppointments(){
  const rows=[...state.appointments].sort((a,b)=>{
    const isPast=a=>timestamp(a.date,a.time)<Date.now()-60_000?1:0;
    return isPast(a)-isPast(b)||timestamp(a.date,a.time)-timestamp(b.date,b.time);
  });
  $('appointment-list').innerHTML=rows.length?rows.map(a=>{
    const past=timestamp(a.date,a.time)<Date.now()-60_000;
    const locked=state.rides.some(r=>isRideActive(r)&&r.appointmentId===a.id);
    return `<article class="record"><div class="record-head"><div><h2 class="record-title">${esc(a.hospital)}</h2><div class="record-date">${esc(readable(a.date,a.time))}</div><div class="record-meta">${esc(a.address||'尚未填寫醫院地址')}</div></div><span class="status-pill ${past?'cancelled':''}">${past?'時間已過':'已記錄'}</span></div>${a.note?`<div class="record-note">備註：${esc(a.note)}</div>`:''}<div class="record-actions"><button type="button" class="btn secondary" data-action="edit-appointment" data-id="${esc(a.id)}">修改</button>${past?'':`<button type="button" class="btn primary" data-action="open-ride" data-direction="outbound" data-appointment-id="${esc(a.id)}">安排用車</button>`}<button type="button" class="btn ghost" data-action="delete-appointment" data-id="${esc(a.id)}" ${locked?'disabled title="請先取消與此回診相關的用車需求"':''}>刪除</button></div>${(Number(a.progress)||0)<4?`<div class="progress-prompt"><span>看診進度：${esc(APPOINTMENT_STEPS[Number(a.progress)||0])}</span><button type="button" class="btn secondary" data-action="update-progress" data-id="${esc(a.id)}" data-stage="${(Number(a.progress)||0)+1}">標記${esc(APPOINTMENT_STEPS[(Number(a.progress)||0)+1])}</button></div>`:''}${locked?'<p class="record-meta">如要刪除此回診，請先在「紀錄」取消相關用車規劃。</p>':''}</article>`;
  }).join(''):`<div class="empty-state"><h3>還沒有回診資料</h3><p>記下醫院通知的時間，下次出門更方便。</p><button type="button" class="btn primary" data-action="open-appointment">＋ 新增回診</button></div>`;
}
function renderRides(){
  const rows=orderedRides();
  $('ride-list').innerHTML=rows.length?rows.map(r=>{
    const active=isRideActive(r);
    return `<article class="record ${active?'':'cancelled'}"><div class="record-head"><div><h2 class="record-title">${r.direction==='outbound'?'去醫院':'回家'}</h2><div class="record-date">${esc(readable(r.date,r.time))}</div></div><span class="status-pill ${active?'':'cancelled'}">${active?(r.status==='saved'?'已儲存（未派車）':'已安排示範車輛'):r.status==='completed'?'行程完成':'已取消'}</span></div><div class="trip-route"><div><label>上車地點</label><div class="trip-location">${esc(r.pickup)}</div></div><div class="trip-next" aria-hidden="true">↓</div><div><label>目的地</label><div class="trip-location">${esc(r.destination)}</div></div></div>${active?`<div class="record-actions"><button class="btn primary" type="button" data-action="open-tracking" data-id="${esc(r.id)}">查看車輛資訊</button><button class="btn secondary" type="button" data-action="cancel-ride" data-id="${esc(r.id)}">取消叫車</button></div>`:''}</article>`;
  }).join(''):`<div class="empty-state"><h3>還沒有用車紀錄</h3><p>點選首頁的「我要去醫院」或「我要回家」即可安排。</p><button type="button" class="btn primary" data-view="home">回首頁</button></div>`;
}
function renderPrefs(){
  // 兼容舊版 localStorage 的 normal / large 偏好設定。
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
function render(){renderHome();renderAppointments();renderRides();renderPrefs();renderTracking();renderDriver();renderFamily();}
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
  $('ride-pickup-hospitals').hidden=direction!=='return';
  $('ride-destination-hospitals').hidden=direction!=='outbound';
}
function openRide(direction='outbound',appointmentId=''){
  $('ride-form').reset();clearError('ride-error');
  selectedAppointment=state.appointments.find(a=>a.id===appointmentId)||upcoming()[0]||null;
  $('ride-appointment-id').value=selectedAppointment?.id||'';
  updateDirection(direction);
  $('ride-date').value=selectedAppointment?.date||nowTaipei().date;
  $('ride-time').value=''; // 不擅自推算出發時間
  $('ride-date').min=nowTaipei().date;
  openDialog('ride-dialog');
}
function openConfirm(kind,id){
  confirming={kind,id};
  const deleting=kind==='delete-appointment';
  $('confirm-title').textContent=deleting?'要刪除這筆回診嗎？':'要取消這筆叫車安排嗎？';
  $('confirm-message').textContent=deleting?'刪除後無法恢復。':'示範車輛資訊將關閉，紀錄會標示為已取消。不會聯絡真實車隊。';
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
    else if(action==='driver-progress')driverProgress(button.dataset.id,button.dataset.status);
    else if(action==='heat-zone'){selectedHeatZone=Number(button.dataset.index);renderDriver();}
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
      const newRide={id:uid(),direction:currentDirection,date,time,pickup,destination,appointmentId,status:'assigned',demoVehicle:{...DEMO_VEHICLE},createdAt:new Date().toISOString(),assignedAt:new Date().toISOString()};
      next.rides.push(newRide);selectedRideId=newRide.id;
    },'已建立展示叫車資訊，並未實際派車');
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
    update(next=>{
      if(kind==='delete-appointment'){
        if(next.rides.some(r=>isRideActive(r)&&r.appointmentId===id))throw Error('請先取消此回診對應的用車規劃');
        const index=next.appointments.findIndex(a=>a.id===id);
        if(index<0)throw Error('找不到這筆回診');
        next.appointments.splice(index,1);
      }else{
        const ride=next.rides.find(r=>r.id===id);
        if(!ride||!isRideActive(ride))throw Error('這筆安排已取消或不存在');
        ride.status='cancelled';ride.cancelledAt=new Date().toISOString();
      }
    },kind==='delete-appointment'?'已刪除回診':'已取消用車規劃');
    closeDialog($('confirm-dialog'));confirming=null;
    if(currentView==='tracking')setView('home');
  }catch(error){toast(error.message);}
});
// 當同一台電腦開啟多個分頁時，資料更新後同步顯示；不跨裝置同步。
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){state=loadState();render();}});
$('hospital-query').addEventListener('input',()=>renderHospitalOptions());



// 角色模式：保留既有長者介面，司機與家屬只在同瀏覽器看見展示資料。
let selectedRideId='';
let tripCollapsed=false;
let selectedHeatZone=0;
const demoHospitals=[
 {name:'衛生福利部苗栗醫院',address:'苗栗縣苗栗市為公路747號',lat:24.5734,lon:120.8371},
 {name:'大千綜合醫院',address:'苗栗縣苗栗市恭敬路36號',lat:24.5452,lon:120.8157},
 {name:'為恭紀念醫院',address:'苗栗縣頭份市信義路128號',lat:24.6902,lon:120.9023}
];
const heatZones=[
 {name:'苗栗醫院周邊',query:'衛生福利部苗栗醫院 苗栗',base:79},
 {name:'苗栗車站周邊',query:'苗栗火車站',base:61},
 {name:'大千醫院周邊',query:'苗栗市大千綜合醫院',base:72},
 {name:'頭份醫療生活圈',query:'頭份市為恭紀念醫院',base:52}
];
function switchRole(role){
  if(!['senior','driver','family'].includes(role))return;
  currentRole=role;
  document.documentElement.dataset.role=role;
  const app=document.querySelector('.app-shell');
  app.classList.toggle('other-role',role!=='senior');
  if(role==='senior')setView('help');
  else setView(role);
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
 if(!r){box.innerHTML='<div class="empty-state"><h2>目前沒有進行中的叫車安排</h2><p>請返回首頁選擇去醫院或回家。</p><button class="btn primary" data-action="back-senior">返回首頁</button></div>';return;}
 const vehicle=r.demoVehicle||DEMO_VEHICLE;
 const minutes=Math.max(0,vehicle.etaMinutes-Math.floor((Date.now()-new Date(r.assignedAt||r.createdAt).getTime())/60000));
 const stage=r.status==='arrived_pickup'?'示範車輛已到達':r.status==='onboard'?'示範行程進行中':minutes>0?`預計 ${minutes} 分鐘後到達`:'預估抵達時間已到';
 box.innerHTML=`<section class="vehicle-hero"><span class="hero-chip">展示車輛 · 非實際派車</span><p class="hero-label">${r.status==='onboard'?'正在前往目的地':'請留意車牌號碼'}</p><h2 class="vehicle-plate">${esc(vehicle.plate)}</h2><div class="vehicle-grid"><div><span>車輛顏色</span><strong>${esc(vehicle.color)}</strong></div><div><span>預估抵達</span><strong>${r.status==='onboard'?'行程中':r.status==='arrived_pickup'?'已到達':minutes>0?minutes+' 分鐘':'請確認'}</strong></div></div><p class="vehicle-stage">${esc(stage)}</p></section>
 <section class="card trip-details"><div class="section-heading"><h2>搭車詳細資訊</h2><button type="button" class="small-link" data-action="toggle-trip" aria-expanded="${!tripCollapsed}">${tripCollapsed?'展開詳細資訊':'縮小資訊'}</button></div>${tripCollapsed?'<p class="preview-meta">已收起詳細資訊，車牌與抵達時間仍會顯示。</p>':`<div class="trip-route"><div><label>上車地點</label><div class="trip-location">${esc(r.pickup)}</div></div><div class="trip-next">↓</div><div><label>目的地</label><div class="trip-location">${esc(r.destination)}</div></div></div><div class="record-date">${esc(readable(r.date,r.time))}</div>`}</section>
 <div class="tracking-actions"><button type="button" class="btn secondary full" data-action="share-location">分享本次位置給家屬畫面</button><button type="button" class="btn secondary full" data-action="back-senior">返回首頁</button><button type="button" class="btn danger full" data-action="cancel-ride" data-id="${esc(r.id)}">取消叫車</button></div>
 <p class="data-update">這是可互動的展示資料，車牌、車色與抵達分鐘數均非真實車隊回傳。</p>`;
}
function heatValue(zoneIndex){const bucket=Math.floor(Date.now()/900_000);return Math.max(18,Math.min(95,heatZones[zoneIndex].base+((bucket*17+zoneIndex*29)%25)-12));}
function renderDriver(){
 const active=orderedRides().find(isRideActive);
 const page=$('page-driver');if(!page)return;
 const hasOrder=Boolean(active);
 page.classList.toggle('driver-has-order',hasOrder);
 $('driver-page-title').textContent=hasOrder?'目前接送任務':'附近叫車需求';
 $('driver-map-caption').textContent=hasOrder?'已接單 · 縮小地圖':'苗栗地區示範地圖';
 const q=hasOrder?'苗栗縣苗栗市':heatZones[selectedHeatZone].query;
 if(currentRole==='driver')setGoogleMap('driver-map','driver-map-link',q);
 const box=$('driver-active');
 if(hasOrder){
 const a=state.appointments.find(x=>x.id===active.appointmentId);
 const next=active.status==='assigned'?{status:'arrived_pickup',label:'已到達上車地點'}:active.status==='arrived_pickup'?{status:'onboard',label:'乘客已上車'}:active.status==='onboard'?{status:'completed',label:'抵達目的地'}:null;
 box.innerHTML=`<div class="section-heading"><h2>目前接送任務</h2><span class="status-pill">展示接單</span></div><div class="driver-passenger"><span class="person-icon" aria-hidden="true">乘</span><div><h3>目前乘客</h3><p>長者乘客（展示資料）</p></div></div><div class="driver-route"><strong>上車位置</strong><p>${esc(active.pickup)}</p><strong>目的地</strong><p>${esc(active.destination)}</p></div><div class="driver-note"><strong>乘客提醒與備註</strong><p>${esc(a?.note||'出發前請提醒長者攜帶健保卡、回診單與個人物品。')}</p></div><p class="record-meta">車牌 ${esc(active.demoVehicle?.plate||DEMO_VEHICLE.plate)} · ${esc(active.demoVehicle?.color||DEMO_VEHICLE.color)}</p>${next?`<button class="btn primary full" type="button" data-action="driver-progress" data-id="${esc(active.id)}" data-status="${next.status}">${next.label}</button>`:''}`;
 }else box.innerHTML=`<div class="section-heading"><h2>目前任務</h2><span class="status-pill">待命中</span></div><p class="preview-empty">目前沒有接送中的任務。長者端建立展示叫車後，就會出現在這裡。</p>`;
 const bucket=new Date(Math.floor(Date.now()/900000)*900000);
 const at=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(bucket);
 $('heat-list').innerHTML=heatZones.map((z,i)=>{const level=heatValue(i);const tier=level>=75?'high':level>=50?'mid':'low';return `<button type="button" class="heat-item ${selectedHeatZone===i?'active':''}" data-action="heat-zone" data-index="${i}"><span class="heat-dot heat-${tier}"></span><span class="heat-name">${esc(z.name)}</span><strong>${level}%</strong></button>`;}).join('');
 $('heat-updated').textContent=`展示熱度更新批次：${at}（每 15 分鐘重新產生）`;
}
function driverProgress(id,status){
 const allowed={assigned:'arrived_pickup',arrived_pickup:'onboard',onboard:'completed'};
 update(s=>{
  const r=s.rides.find(x=>x.id===id);if(!r||allowed[r.status]!==status)throw Error('目前無法更新此任務階段');
  r.status=status;r.statusUpdatedAt=new Date().toISOString();
  if(status==='completed'&&r.direction==='outbound'&&r.appointmentId){const a=s.appointments.find(x=>x.id===r.appointmentId);if(a){a.progress=Math.max(a.progress||0,1);a.progressUpdatedAt=new Date().toISOString();}}
  if(status==='completed'&&r.direction==='return'){const a=[...s.appointments].sort((x,y)=>timestamp(y.date,y.time)-timestamp(x.date,x.time))[0];if(a){a.progress=5;a.progressUpdatedAt=new Date().toISOString();}}
 },'已更新展示任務進度');
}
function updateProgress(id,stage){
 if(!Number.isInteger(stage)||stage<1||stage>4)return;
 update(s=>{const a=s.appointments.find(x=>x.id===id);if(!a)throw Error('找不到回診資料');a.progress=stage;a.progressUpdatedAt=new Date().toISOString();},'已更新看診進度');
}
function renderFamily(){
 const box=$('family-status');if(!box)return;
 const a=[...state.appointments].sort((x,y)=>timestamp(y.date,y.time)-timestamp(x.date,x.time))[0]||null;
 const r=orderedRides().find(r=>r.status!=='cancelled');
 const stage=a?Math.min(5,Math.max(0,Number(a.progress)||0)):0;
 box.innerHTML=`<div class="section-heading"><h2>目前狀態</h2><span class="status-pill">展示進度</span></div><p class="family-main-stage">${a?esc(APPOINTMENT_STEPS[stage]):'尚無回診安排'}</p><p class="record-meta">${a?esc(a.hospital)+' · '+esc(readable(a.date,a.time)):'請先從長者介面新增回診。'}</p>`;
 $('family-timeline').innerHTML=APPOINTMENT_STEPS.map((label,i)=>`<div class="timeline-item ${a&&i<=stage?'done':''} ${a&&i===stage?'current':''}"><span class="timeline-point" aria-hidden="true">${a&&i<stage?'✓':i+1}</span><div><strong>${esc(label)}</strong>${a&&i===stage?'<span class="current-label">目前階段</span>':''}</div></div>`).join('');
 const now=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
 $('family-last-updated').textContent=`畫面更新 ${now}`;
 const loc=state.sharedLocation;
 const usable=loc&&Number.isFinite(Number(loc.lat))&&Number.isFinite(Number(loc.lon));
 const query=usable?`${Number(loc.lat).toFixed(5)},${Number(loc.lon).toFixed(5)}`:(a?.address||'衛生福利部苗栗醫院 苗栗');
 if(currentRole==='family')setGoogleMap('family-map','family-map-link',query);
 $('family-location-caption').textContent=usable?`長者在此瀏覽器授權分享的位置；最後紀錄 ${new Date(loc.at).toLocaleString('zh-TW')}。非持續追蹤。`:'僅顯示院所示範位置，不代表長者實際所在位置。長者可在乘車資訊頁主動授權分享定位。';
 let notice=!a?'目前沒有回診資料，請先協助長者確認下一次回診時間。':stage===0?'出門前可提醒長者帶健保卡、回診單、常用藥物及個人物品。':stage===1?'長者已標記到達醫院，可提醒先確認報到櫃檯。':stage===2?'已完成報到，可以關心等候區是否有座位與飲水。':stage===3?'目前標記為候診中，若等候過久可透過原有通訊方式關心。':stage===4?'看診已結束，可關心回程交通是否已安排。':'已標記返家，可適時確認長者已平安休息。';
 $('family-notice').innerHTML=`<p class="notice-text">${esc(notice)}</p><p class="record-meta">依本網站行程階段提供一般生活提醒，並非醫療判斷或推播。</p>`;
 $('family-refresh-info').textContent='每 3 分鐘更新一次此瀏覽器的行程與畫面資訊；不跨裝置讀取，也不會持續取得 GPS。';
}
function shareLocation(){
 if(!navigator.geolocation){toast('瀏覽器不支援定位');return;}
 navigator.geolocation.getCurrentPosition(pos=>{
  update(s=>{s.sharedLocation={lat:pos.coords.latitude,lon:pos.coords.longitude,at:new Date().toISOString()};},'已授權分享本次位置（僅此瀏覽器）');
 },()=>toast('無法取得位置，請檢查定位權限'),{enableHighAccuracy:false,timeout:9000,maximumAge:30000});
}
function openHospitalPicker(target){
 hospitalTarget=['appointment','ride-pickup','ride-destination'].includes(target)?target:'appointment';
 hospitalCandidates=[...demoHospitals];
 $('hospital-query').value='';
 $('hospital-status').textContent='以下為苗栗地區常用院所範例。按「使用目前位置」可搜尋真正附近的院所。';
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

// 所有展示資料常數與元件函式就緒後才執行初始渲染。
render();setView('home');
setInterval(()=>{if(currentView==='tracking')renderTracking();},30_000);
setInterval(()=>{if(currentRole==='driver')renderDriver();},30_000); // 15 分鐘更新資料時間桶
setInterval(()=>{if(currentRole==='family'){state=loadState();renderFamily();}},3*60_000);
