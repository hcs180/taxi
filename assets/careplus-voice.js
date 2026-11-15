'use strict';

// 語音輸入：優先使用瀏覽器的 Web Speech API。一般模式下辨識失敗一律改用文字輸入，不會套用預設語句；
// 只有 Demo 模式開啟「模擬語音」時才使用預設語句，結果會標示為模擬辨識。

const cpVoice = (() => {
  let recog = null, timer = null, session = 0;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const simEnabled = () => {
    if(!CP_DEMO) return false;
    try{ const v = sessionStorage.getItem('cp-simvoice'); if(v !== null) return v === '1'; }catch{}
    return CP_PARAMS.has('simvoice');
  };
  function overlay(text, sub){
    const box = $('cp-listen');
    box.innerHTML = `<div class="cp-listen-card"><div class="cp-mic-ring" aria-hidden="true">${cpIcon('mic')}</div><p>${esc(text)}</p><small>${esc(sub)}</small><button type="button" class="btn secondary" data-cpa="voice-stop">取消</button></div>`;
    if(!box.open){ try{ box.showModal(); }catch{ box.setAttribute('open', ''); } }
  }
  function stop(){ clearTimeout(timer); try{ recog && recog.abort(); }catch{} recog = null; }
  function close(){ stop(); const box = $('cp-listen'); if(box.open) box.close(); }
  // 使用者按 Esc 或「取消」關閉聆聽視窗時，作廢這一次辨識，不回傳任何結果。
  $('cp-listen').addEventListener('close', () => { session++; stop(); });
  function listen({lang = 'zh', prompt, simulatedText, onResult, onFail}){
    const langLabel = lang === 'id' ? 'Bahasa Indonesia' : '中文', my = ++session;
    if(simEnabled()){
      overlay(prompt, `${langLabel}・模擬語音辨識`);
      timer = setTimeout(() => { if(my !== session) return; close(); onResult(simulatedText, true); }, 1500);
      return;
    }
    if(!SR){ onFail('unsupported'); return; }
    overlay(prompt, langLabel);
    let done = false;
    const finish = fn => { if(done || my !== session) return; done = true; close(); fn(); };
    try{
      recog = new SR(); recog.lang = lang === 'id' ? 'id-ID' : 'zh-TW'; recog.interimResults = false; recog.maxAlternatives = 1;
      recog.onresult = e => { const t = e.results[0] && e.results[0][0] ? e.results[0][0].transcript.trim() : ''; finish(() => t ? onResult(t, false) : onFail('nomatch')); };
      recog.onerror = e => finish(() => onFail(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nomatch' : 'error'));
      recog.onend = () => finish(() => onFail('nomatch'));
      recog.start();
      timer = setTimeout(() => finish(() => onFail('nomatch')), 9000);
    }catch{ finish(() => onFail('error')); }
  }
  const failText = r => ({unsupported:'這個瀏覽器不支援語音輸入', denied:'沒有取得麥克風權限', nomatch:'沒有聽清楚', error:'語音輸入暫時無法使用'}[r] || '語音輸入暫時無法使用');
  return {listen, close, simEnabled, failText, supported:Boolean(SR)};
})();

// 從一句話解析長期預約欄位。只填入有聽到的項目，其餘欄位保持原值。
function cpParseBookingText(text){
  const out = {};
  const dayMap = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0};
  const m = text.match(/(?:每週|每周|每星期|星期|禮拜|週|周)([一二三四五六日天、,，和及與\s]+)/);
  if(m){ const days = [...new Set([...m[1]].filter(c => c in dayMap).map(c => dayMap[c]))]; if(days.length) out.weekdays = days; }
  const h = CP_HOSPITALS.find(x => text.includes(x.name)) || (text.includes('台大') || text.includes('臺大') ? cpHospital('ntuh') : /馬偕/.test(text) ? cpHospital('mackay') : /中榮|台中榮|臺中榮/.test(text) ? cpHospital('tcvgh') : /苗栗/.test(text) ? cpHospital('mlh') : null);
  if(h) out.hospitalId = h.id;
  const dept = text.match(/([一-龥]{1,4}(?:內科|外科|科))/); if(dept) out.department = dept[1].replace(/^(醫院|台大|臺大)/,'');
  const num = {'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12};
  const room = text.match(/(\d{1,2}|[一二三四五六七八九十]{1,2})\s*診/); if(room) out.clinicRoom = `${num[room[1]] ?? Number(room[1])} 診`;
  const t = text.match(/(早上|上午|中午|下午|晚上)?\s*(十一|十二|十|[一二兩三四五六七八九]|\d{1,2})\s*(?:點|:|：)\s*(半|\d{1,2})?/);
  if(t){ let hh = num[t[2]] ?? Number(t[2]); if((t[1] === '下午' || t[1] === '晚上') && hh < 12) hh += 12; const mm = t[3] === '半' ? 30 : t[3] ? Number(t[3]) : 0; if(hh >= 0 && hh < 24 && mm < 60) out.appointmentTime = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; }
  if(/一個月|1\s*個月/.test(text)) out.duration = 30; else if(/兩週|兩個禮拜|二週|2\s*週|半個月/.test(text)) out.duration = 14; else if(/三個月|3\s*個月/.test(text)) out.duration = 90;
  if(/輪椅|無障礙/.test(text)) out.wheelchairRequired = true;
  if(/透析|洗腎|療程/.test(text)) out.queueMode = 'treatment';
  return out;
}
const cpIsReturnPhrase = text => /我好了|好了|我要回家|回家|幫我叫車|叫車|selesai|pulang|panggil/i.test(text);
