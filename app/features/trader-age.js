/* ============================================================================
   Trader Age — how seasoned your trading process looks, in years, next to how long
   you've actually traded (the "Trader Age and XP Multiplier Spec" doc, step 3).
   A feature in its own file: it plugs into Keel through pzFeature (app/pulse.js)
   and loads on Keel's page only (data-only="keel" in ledger.html).

   Each trading day gets a 0–100 rating:
     65% Discipline (the day's score, read from fills)
     15% Steadiness (100 minus twice the spread of your last 20 daily Discipline scores)
     10% Loss limit kept (100 kept, 0 traded past it, 70 when no limit was set)
     10% Prep and journal (half for doing the morning prep, half for the share of trades journaled)
   The rating R is a weighted average of the last 6 months of trading days, a day's weight
   halving every 30 trading days back. Trader Age = 2^((R − 50) / 10) years, capped at 20:
   every 10 points doubles it. Only trading days count, so a break freezes it.
   Pace is this week (the last 7 days, 3+ trading days) against that norm, from 0× to 3×.
   ============================================================================ */
const TA={halfLife:30, minDays:15, windowDays:183, cap:20, steadyN:20, weekMin:3, paceMax:3};
const taYears=r=>Math.min(TA.cap, Math.pow(2,(r-50)/10));
// a rating back from years (for "get back to 2 years" style messages)
const taRatingFor=y=>50+10*Math.log2(Math.max(1e-9,y));
function taFmtYears(y){
  if(!(y>0))return '—';
  if(y<1){ const m=Math.max(1,Math.round(y*12)); return m+' month'+(m===1?'':'s'); }
  return (y<10?y.toFixed(1):String(Math.round(y)))+' years';
}
// days: the game's trading days, oldest first ({key, score, parts, behavior}); J: the journal (for the
// morning prep on 'day:<key>'); firstAt: the first fill on record (ms); now: ms
function traderAge(days, J, opts){
  opts=opts||{}; const now=opts.now||Date.now(), dayOf=opts.dayOf||(ms=>new Date(ms).toISOString().slice(0,10));
  const from=dayOf(now-TA.windowDays*864e5), weekFrom=dayOf(now-6*864e5);
  // only the last 6 months count, for every part (steadiness looks back over these days only too)
  const all=(days||[]).filter(d=>d&&d.key&&d.key>=from&&isFinite(d.score)).slice().sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const rated=all.map((d,i)=>{
    const win=all.slice(Math.max(0,i-TA.steadyN+1),i+1).map(x=>x.score), mean=win.reduce((a,v)=>a+v,0)/win.length;
    const sd=Math.sqrt(win.reduce((a,v)=>a+(v-mean)*(v-mean),0)/win.length);
    const P=d.parts||{}, e=J&&J['day:'+d.key];
    const parts={discipline:d.score, steadiness:Math.max(0,100-2*sd), limit:P.limit===1?100:P.limit===0?0:70,
      log:50*(e&&(e.sleep||e.stress||e.focus)?1:0)+50*Math.max(0,Math.min(1,+P.journal||0))};
    return {key:d.key, d, parts, r:0.65*parts.discipline+0.15*parts.steadiness+0.10*parts.limit+0.10*parts.log};
  });
  const inWin=rated, n=inWin.length;
  const firstAt=opts.firstAt>0?opts.firstAt:null, tradingYears=firstAt?Math.max(0,(now-firstAt)/(365.25*864e5)):null;
  const out={n, need:Math.max(0,TA.minDays-n), tradingYears, building:n<TA.minDays};
  if(!n)return out;
  let W=0, R=0; const parts={discipline:0,steadiness:0,limit:0,log:0};
  inWin.forEach((x,i)=>{ const w=Math.pow(0.5,(n-1-i)/TA.halfLife); W+=w; R+=w*x.r; for(const k in parts)parts[k]+=w*x.parts[k]; });
  out.rating=R/W; for(const k in parts)parts[k]=parts[k]/W; out.parts=parts;
  out.age=taYears(out.rating);
  // what's holding it back most: the part furthest below 100, by its weight
  const WT={discipline:.65,steadiness:.15,limit:.10,log:.10};
  out.drag=Object.keys(WT).map(k=>[k,(100-parts[k])*WT[k]]).sort((a,b)=>b[1]-a[1])[0][0];
  // this week against the norm
  const wk=rated.filter(x=>x.key>=weekFrom);
  out.week={n:wk.length};
  if(wk.length>=TA.weekMin){ const wr=wk.reduce((a,x)=>a+x.r,0)/wk.length; out.week.rating=wr; out.week.age=taYears(wr);
    out.pace=Math.max(0,Math.min(TA.paceMax,out.week.age/out.age));
    const slips={}; for(const x of wk){ const f=(x.d.behavior&&x.d.behavior.flags)||{}; for(const k in f)if(f[k]>0)slips[k]=(slips[k]||0)+f[k]; }
    const top=Object.entries(slips).sort((a,b)=>b[1]-a[1])[0]; out.week.slip=top?top[0]:null; }
  // the last 12 weeks with trading, each as its own Trader Age (oldest first)
  const byWeek=new Map(); for(const x of inWin){ const w=isoWeekOfKey(x.key); if(!byWeek.has(w))byWeek.set(w,[]); byWeek.get(w).push(x.r); }
  out.weeks=[...byWeek.entries()].slice(-12).map(([w,rs])=>{ const r=rs.reduce((a,v)=>a+v,0)/rs.length; return {week:w, rating:r, age:taYears(r), n:rs.length}; });
  return out;
}
const TA_PART={discipline:['Discipline','Your daily Discipline score, read from your fills',65],steadiness:['Steadiness','How even your daily scores are',15],
  limit:['Loss limit kept','Days inside your loss limit (no limit set counts as 70)',10],log:['Prep and journal','Morning prep done, trades journaled',10]};
function taOf(D){
  const g=D.g; let firstAt=0; for(const t of (typeof allTrades!=='undefined'?allTrades:[])){ const a=+t.openTime||+t.closeTime||0; if(a>0&&(!firstAt||a<firstAt))firstAt=a; }
  return traderAge(g.days, typeof journal!=='undefined'?journal:{}, {firstAt, dayOf:typeof dayKey==='function'?dayKey:undefined});
}
function taPaceWord(p){ return p>=1.1?'maturing':p<=0.9?'slipping':'steady'; }
function taPaceCol(p){ return p>=1.1?PZ_COL.good:p<=0.9?PZ_COL.low:PZ_COL.mid; }
// not checked by the server yet (that's the spec's step 4): say so, and nudge people without a profile
function taEstimateNote(){
  const member=typeof SOC!=='undefined'&&SOC.key, owner=typeof SRV!=='undefined'&&SRV.token&&!SRV.badAuth;
  return member||owner?'Estimated on this device from your fills and journal.'
    :'Estimated on this device. <a href="#social">Create a profile</a> to have it verified and to earn the XP multiplier.';
}
function taCardHtml(D){
  const A=taOf(D);
  if(!A.n)return '';
  const head=`<div class="pz-kvrow"><span class="pz-lbl" style="color:${PZ_COL.xp}">Trader Age</span><a class="pz-link" href="#age" style="min-height:0">What builds it ${pzI('chev',14)}</a></div>`;
  if(A.building)return `<section class="pz-card pz-kv">${head}
    <b style="font-size:17px">Building your Trader Age</b>${pzBar((TA.minDays-A.need)/TA.minDays,PZ_COL.xp)}
    <p class="pz-sub" style="font-size:13px">${A.need} more trading day${A.need===1?'':'s'} and it appears: how seasoned your process looks, in years.</p></section>`;
  const pace=A.pace!=null?`<span style="color:${taPaceCol(A.pace)};font-weight:600">Pace ${A.pace.toFixed(1)}× · ${taPaceWord(A.pace)}</span>`:'<span class="pz-sub">Pace needs 3 trading days this week</span>';
  return `<section class="pz-card pz-kv">${head}
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-family:var(--pz-num);font-size:40px;font-weight:600;line-height:1">${esc(taFmtYears(A.age))}</span>
      ${A.tradingYears!=null?`<span class="pz-sub" style="font-size:13px">trading for ${esc(taFmtYears(A.tradingYears))}</span>`:''}</div>
    <p style="font-size:13px;margin:0">${pace}</p></section>`;
}
function taScreenHtml(D){
  const A=taOf(D), back=`<a class="pz-back" href="#today">${pzI('back',20)}Today</a>`;
  const how=`<section class="pz-card pz-kv"><b class="pz-kvh">How it works</b>
    <p class="pz-sub" style="font-size:13px">Every trading day is rated from 0 to 100. Your last 6 months of trading days are averaged, with recent days counting more (a day's weight halves every 30 trading days). Every 10 points doubles your Trader Age: a rating of 50 is 1 year, 60 is 2, 70 is 4, 80 is 8.</p>
    <p class="pz-sub" style="font-size:13px">Only days you trade count, so a break freezes it. It never comes from profit.</p>
    <p class="pz-fine">${taEstimateNote()}</p></section>`;
  if(!A.n)return `${back}${pzHead('Your process, in years','Trader Age')}<section class="pz-card"><p class="pz-sub">It starts with your first trading day.</p></section>${how}`;
  if(A.building)return `${back}${pzHead('Your process, in years','Trader Age')}<section class="pz-card pz-kv"><b style="font-size:17px">Building: ${A.need} more trading day${A.need===1?'':'s'}</b>${pzBar((TA.minDays-A.need)/TA.minDays,PZ_COL.xp)}<p class="pz-sub" style="font-size:13px">${A.n} of ${TA.minDays} trading days so far.</p></section>${how}`;
  const ahead=A.tradingYears==null?'Your process, in years':A.age>=A.tradingYears?'Ahead of your experience':'Still catching up with your experience';
  const hero=`<section class="pz-card pz-hero pz-span">
    <div class="pz-hero-ring">${pzRing(taFmtYears(A.age).split(' ')[0],Math.min(1,A.rating/100),PZ_COL.xp,{size:132,cap:taFmtYears(A.age).split(' ')[1]||''})}</div>
    <div class="pz-hero-main"><span class="pz-lbl" style="color:${PZ_COL.xp}">Trader Age</span><h2 class="pz-hero-t">${esc(ahead)}</h2>
      <p class="pz-sub" style="font-size:13px">${A.tradingYears!=null?`Your process looks ${esc(taFmtYears(A.age))} seasoned, and you’ve been trading for ${esc(taFmtYears(A.tradingYears))}. `:''}Rating ${Math.round(A.rating)} from ${A.n} trading days.</p></div></section>`;
  const wk=A.week, slip=wk.slip&&typeof PZ_BEH!=='undefined'?PZ_BEH[wk.slip]:null;
  const pace=`<section class="pz-card pz-kv"><b class="pz-kvh">This week</b>${A.pace!=null?`
    <div style="display:flex;align-items:baseline;gap:10px"><span style="font-family:var(--pz-num);font-size:32px;font-weight:600;color:${taPaceCol(A.pace)}">${A.pace.toFixed(1)}×</span><span class="pz-sub">${taPaceWord(A.pace)}</span></div>
    <p class="pz-sub" style="font-size:13px">Over ${wk.n} trading days you traded like someone with ${esc(taFmtYears(wk.age))} behind them, against your 6-month ${esc(taFmtYears(A.age))}.${A.pace<0.9&&slip?' What cost you most: '+esc(slip.toLowerCase())+'.':''}</p>`
    :`<p class="pz-sub" style="font-size:13px">Pace needs at least 3 trading days in the last 7. ${wk.n?'You have '+wk.n+'.':'No trades yet this week.'}</p>`}</section>`;
  const rows=Object.keys(TA_PART).map(k=>{ const [l,h,w]=TA_PART[k], v=A.parts[k];
    return `<div class="pz-row"><div class="pz-row-t"><span>${esc(l)}<span class="pz-sub" style="display:block;font-size:12px">${esc(h)} · ${w}%</span></span><b>${Math.round(v)}</b></div>${pzBar(v/100,k===A.drag?PZ_COL.low:PZ_COL.xp)}</div>`; }).join('');
  const parts=`<section class="pz-card pz-kv"><b class="pz-kvh">What builds it</b>${rows}<p class="pz-fine">Holding it back most: <b>${esc(TA_PART[A.drag][0].toLowerCase())}</b>.</p></section>`;
  const W=A.weeks||[], max=Math.max(1,...W.map(w=>w.age));
  const hist=W.length>1?`<section class="pz-card pz-kv"><b class="pz-kvh">Week by week</b><div class="pz-chart" style="--h:110px;--gap:${W.length>8?'4px':'8px'}">${W.map(w=>
    `<i style="height:${Math.max(4,Math.round(w.age/max*110))}px;background:${PZ_COL.xp}" data-pz-tip="${esc(w.week+': '+taFmtYears(w.age)+' · rating '+Math.round(w.rating)+' · '+w.n+' trading day'+(w.n===1?'':'s'))}"></i>`).join('')}</div>
    <p class="pz-fine">Each bar is that week on its own, as a Trader Age.</p></section>`:'';
  return `${back}${pzHead('Your process, in years','Trader Age')}<div class="pz-wide">${hero}<div class="pz-col">${pace}${hist}</div><div class="pz-col">${parts}${how}</div></div>`;
}
pzFeature({id:'age', today:{label:'Trader Age',hint:'How seasoned your process looks, in years, against how long you’ve traded',col:0,after:'tilt',html:taCardHtml},
  tab:{name:'age',nav:'progress',html:taScreenHtml}});
