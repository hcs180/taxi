// 依 DEMO_SCRIPT 主影片分鏡連跑兩次，比對每一步畫面文字是否完全相同
const {chromium}=require('playwright');
async function run(b){
 const p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.route(/google\.com|gstatic|googleapis/,r=>r.fulfill({status:200,contentType:'text/html',body:''}));
 await p.goto('http://localhost:8765/?demo&simvoice');await p.waitForTimeout(300);
 const d=async a=>{if(!(await p.locator(`[data-cpd="${a}"]`).count()))await p.click('[data-cpd="expand"]');await p.click(`[data-cpd="${a}"]`);await p.waitForTimeout(200);};
 const snap=async n=>({step:n,text:(await p.evaluate(()=>document.querySelector('main').innerText+'|PUSH|'+(document.querySelector('#cp-push').hidden?'':document.querySelector('#cp-push').innerText))).replace(/\s+/g,' ')});
 const out=[];
 await d('reset');out.push(await snap('1 首頁'));
 await p.click('#page-home [data-cpa="open-booking"]');await p.click('[data-cpa="voice-booking"]');await p.waitForTimeout(1900);
 out.push({step:'2 語音填表',text:(await p.evaluate(()=>document.querySelector('#cp-longterm-form').innerText+[...document.querySelectorAll('.cp-day.on')].map(b=>b.dataset.day))).replace(/\s+/g,' ')});
 await p.click('#cp-lt-submit');await p.waitForTimeout(300);out.push(await snap('3 長期預約頁'));
 await d('enter');out.push(await snap('4 看診當天'));
 await d('arrive');out.push(await snap('5 延誤'));
 await d('near');out.push(await snap('6 提醒'));
 await p.click('[data-cpa="push-register"]');await p.waitForTimeout(200);out.push(await snap('7 已登記'));
 await d('done');await p.click('.bottom-nav [data-view="home"]');out.push(await snap('8 一鍵叫車'));
 await p.click('#cp-home-status [data-cpa="one-tap"]');await p.waitForTimeout(200);out.push(await snap('9 尋找車輛'));
 await d('role-driver');out.push(await snap('10 司機任務池'));
 await p.click('[data-cpa="drv-accept"]');await p.waitForTimeout(200);
 await d('role-senior');out.push(await snap('11 長者看到車牌'));
 await d('role-family');out.push(await snap('12 家屬'));
 await p.close();return {out,errs};
}
(async()=>{const b=await chromium.launch();const A=await run(b),B=await run(b);await b.close();
 const rows=A.out.map((s,i)=>({step:s.step,same:s.text===B.out[i].text,len:s.text.length}));
 console.log(JSON.stringify({rows,errs:[...A.errs,...B.errs]},null,1));
 console.log(A.out.map(s=>s.step+' :: '+s.text.slice(0,260)).join('\n'));
})();
