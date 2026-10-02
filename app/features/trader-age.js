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
// the settings and the years formula are functions so the server can borrow them, with traderAge,
// to work out members' verified Trader Age from their wallets (server.js ENGINE_FNS)
function taConf(){ return {halfLife:30, minDays:15, windowDays:183, cap:20, steadyN:20, weekMin:3, paceMax:3, standN:20, priorDays:15, fullDays:60}; }
const TA=taConf();
function taYears(r){ return Math.min(TA.cap, Math.pow(2,(r-50)/10)); }
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
  if(opts.raw)return {daily:rated.map(x=>({key:x.key,r:x.r}))};
  const firstAt=opts.firstAt>0?opts.firstAt:null, tradingYears=firstAt?Math.max(0,(now-firstAt)/(365.25*864e5)):null;
  const out={n, need:Math.max(0,TA.minDays-n), tradingYears, building:n<TA.minDays};
  if(!n)return out;
  let W=0, W2=0, R=0; const parts={discipline:0,steadiness:0,limit:0,log:0}, ws=inWin.map((x,i)=>Math.pow(0.5,(n-1-i)/TA.halfLife));
  inWin.forEach((x,i)=>{ const w=ws[i]; W+=w; W2+=w*w; R+=w*x.r; for(const k in parts)parts[k]+=w*x.parts[k]; });
  out.raw=R/W; for(const k in parts)parts[k]=parts[k]/W; out.parts=parts;
  // confidence: with few trading days the rating is pulled toward 50 (1 year), fully trusted from 60 days on,
  // so 15 perfect days don't read as 20 years; the range is about 80% likely (the spread of daily ratings)
  const prior=TA.priorDays*Math.max(0,1-n/TA.fullDays), shrink=n/(n+prior);
  out.rating=50+(out.raw-50)*shrink; out.age=taYears(out.rating); out.sure=shrink;
  const sd=Math.sqrt(inWin.reduce((a,x,i)=>a+ws[i]*(x.r-out.raw)*(x.r-out.raw),0)/W), se=sd/Math.sqrt(W*W/W2)*shrink;
  out.range=[taYears(out.rating-1.28*se), taYears(out.rating+1.28*se)];
  // the last 20 trading days, plain average: what standing reads
  const rec=inWin.slice(-TA.standN); out.recent=rec.reduce((a,x)=>a+x.r,0)/rec.length; out.recentN=rec.length;
  // what's holding it back most: the part furthest below 100, by its weight
  const WT={discipline:.65,steadiness:.15,limit:.10,log:.10};
  out.drag=Object.keys(WT).map(k=>[k,(100-parts[k])*WT[k]]).sort((a,b)=>b[1]-a[1])[0][0];
  // this week against the norm
  const wk=rated.filter(x=>x.key>=weekFrom);
  out.week={n:wk.length};
  if(wk.length>=TA.weekMin){ const wr=wk.reduce((a,x)=>a+x.r,0)/wk.length; out.week.rating=wr; out.week.age=taYears(wr);
    out.pace=Math.max(0,Math.min(TA.paceMax,Math.pow(2,(wr-out.raw)/10))); // against the 6-month rating itself (no cap, no pull)
    const slips={}; for(const x of wk){ const f=(x.d.behavior&&x.d.behavior.flags)||{}; for(const k in f)if(f[k]>0)slips[k]=(slips[k]||0)+f[k]; }
    const top=Object.entries(slips).sort((a,b)=>b[1]-a[1])[0]; out.week.slip=top?top[0]:null; }
  // the last 12 weeks with trading, each as its own Trader Age (oldest first)
  const byWeek=new Map(); for(const x of inWin){ const w=isoWeekOfKey(x.key); if(!byWeek.has(w))byWeek.set(w,[]); byWeek.get(w).push(x.r); }
  out.weeks=[...byWeek.entries()].slice(-12).map(([w,rs])=>{ const r=rs.reduce((a,v)=>a+v,0)/rs.length; return {week:w, rating:r, age:taYears(r), n:rs.length}; });
  return out;
}
// Trader Age at the end of each trading day, oldest first: the history line and the milestone badges.
// Each day reads only the trading days before it (at most the 200 before: the window is 6 months).
function taHistory(days, J, opts){
  opts=opts||{}; const all=(days||[]).filter(d=>d&&d.key&&isFinite(d.score)).slice().sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  return all.map((d,i)=>{ const A=traderAge(all.slice(Math.max(0,i-199),i+1), J, {now:Date.parse(d.key+'T23:59:59Z'), dayOf:opts.dayOf, firstAt:opts.firstAt});
    return {key:d.key, n:A.n, rating:A.rating, age:A.building?null:A.age, tradingYears:A.tradingYears}; });
}
// what each kind of slip costs: Trader Age worked out again as if the trades with only that slip had
// been clean (their day's Discipline goes up, the flag goes), best gain first
const TA_SLIPS=['revenge','afterTwo','sizeUp','addLoser','overtrade','heldLoser'];
function taWhatIf(days, J, opts){
  opts=opts||{}; const base=traderAge(days,J,opts); if(!base.n||base.building)return [];
  const now=opts.now||Date.now(), from=(opts.dayOf||(ms=>new Date(ms).toISOString().slice(0,10)))(now-TA.windowDays*864e5);
  return TA_SLIPS.map(k=>{ let hit=0;
    const alt=(days||[]).map(d=>{ const b=d&&d.behavior; if(!b||!b.flags||!b.flags[k])return d; const n=b.n||d.n||0; if(!n)return d;
      if(d.key>=from)hit+=b.flags[k];
      const freed=(b.slips||[]).filter(x=>x.f&&x.f.length===1&&x.f[0]===k).length, fl=Object.assign({},b.flags); delete fl[k];
      return Object.assign({},d,{score:Math.round(100*Math.min(n,(b.clean||0)+freed)/n), behavior:Object.assign({},b,{flags:fl})}); });
    if(!hit)return null; const A=traderAge(alt,J,opts); return {k, n:hit, age:A.age, gain:A.age-base.age}; })
    .filter(x=>x&&x.gain>=0.05).sort((a,b)=>b.gain-a.gain);
}
// '2026-W39' as 'Week of Sep 21' (its Monday)
function taWeekLabel(w){ try{ const k=isoWeekMondayKey(w); return 'Week of '+MONTHS[+k.slice(5,7)-1]+' '+(+k.slice(8)); }catch(e){ return w; } }
/* ---- the XP multiplier (spec step 5): earned by holding Trader Age, worked out by the server ----
   A trading week counts toward it when that week's own rating and the 6-month rating at its end are
   both at the bar (70 = Trader Age 4 years). A trading week under the bar drops one tier, never back to
   the start; weeks without trading neither count nor break it. */
function taMultDefaults(){ return {on:true, bar:70, tiers:[[2,1.05],[4,1.1],[8,1.2],[13,1.3],[26,1.5]]}; }
// every trading week in the days given (oldest first): the average rating of its own days, and the
// 6-month rating at its end (null until there are 15 trading days to go on)
function taWeeks(days, J, opts){
  opts=opts||{}; const dayOf=opts.dayOf;
  const all=(days||[]).filter(d=>d&&d.key&&isFinite(d.score)).slice().sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const weeks=[...new Set(all.map(d=>isoWeekOfKey(d.key)))].filter(w=>!opts.after||w>opts.after);
  return weeks.map(w=>{ const keys=all.filter(d=>isoWeekOfKey(d.key)===w).map(d=>d.key), end=keys[keys.length-1];
    const upTo=all.filter(d=>d.key<=end), now=Date.parse(end+'T23:59:59Z');
    const A=traderAge(upTo, J, {now, dayOf}), rs=traderAge(upTo, J, {now, dayOf, raw:true}).daily.filter(x=>keys.includes(x.key)).map(x=>x.r);
    return {week:w, end, n:keys.length, weekRating:rs.length?rs.reduce((a,v)=>a+v,0)/rs.length:null, norm:A.n>=TA.minDays?A.rating:null}; });
}
// the tier a count of good weeks reaches (-1: none yet), under the owner's current tiers
function taMultTier(count, cfg){ let t=-1; (cfg||taMultDefaults()).tiers.forEach((x,i)=>{ if(count>=x[0])t=i; }); return t; }
// one finished trading week moves the multiplier. The state is the good weeks held and the last week
// counted, so the tier always reads from the owner's current tiers (changing them never strands anyone).
function taMultStep(state, wk, cfg){
  cfg=cfg||taMultDefaults(); const T=cfg.tiers, st=Object.assign({count:0,last:null},state||{});
  if(!wk||(st.last&&wk.week<=st.last))return st;
  if(wk.weekRating!=null&&wk.weekRating<cfg.bar){ const t=taMultTier(st.count,cfg); st.count=t>=1?T[t-1][0]:0; } // down one tier
  else if(wk.weekRating!=null&&wk.norm!=null&&wk.norm>=cfg.bar)st.count++;
  st.last=wk.week; return st;
}
function taMultOf(state, cfg){ cfg=cfg||taMultDefaults(); const t=state?taMultTier(state.count,cfg):-1; return t>=0&&cfg.on!==false?cfg.tiers[t][1]:1; }
// the multiplier, as the server reports it: this week's, the good weeks held, and what the next tier needs
function taMultCardHtml(A){
  const cfg=(typeof SOC!=='undefined'&&SOC.cfg&&SOC.cfg.mult)||taMultDefaults(), M=typeof SOC!=='undefined'&&SOC.me&&SOC.me.mult;
  if(cfg.on===false)return '';
  const top=cfg.tiers[cfg.tiers.length-1], bar=cfg.bar, barYears=taFmtYears(taYears(bar));
  const rule=`<p class="pz-fine">A good week: that week and your 6-month Trader Age both at ${esc(barYears)} or more (rating ${bar}). A week below drops one tier, never back to the start. Weeks you don’t trade don’t count either way. Leagues and duels use your XP before the multiplier.</p>`;
  if(!A.verified||!M)return `<section class="pz-card pz-kv"><b class="pz-kvh">XP multiplier</b>
    <p class="pz-sub" style="font-size:13px">Hold a verified Trader Age of ${esc(barYears)} or more and your daily XP grows, up to ×${top[1]} after ${top[0]} good trading weeks.</p>${rule}</section>`;
  const nx=M.next, pct=nx?Math.min(1,M.held/nx.weeks):1;
  return `<section class="pz-card pz-kv"><div class="pz-kvrow"><b class="pz-kvh">XP multiplier</b><span style="font-family:var(--pz-num);font-size:28px;font-weight:600;color:${M.now>1?PZ_COL.good:'var(--pz-muted)'}">×${(+M.now).toFixed(2).replace(/0$/,'')}</span></div>
    ${pzBar(pct,PZ_COL.xp)}<p class="pz-sub" style="font-size:13px">${M.held} good week${M.held===1?'':'s'} held. ${nx?`${nx.toGo} more for ×${nx.mult}.`:'That’s the top tier.'} This week’s daily XP is multiplied by ×${(+M.now).toFixed(2).replace(/0$/,'')}.</p>${rule}</section>`;
}
/* ---- standing (spec step 6): perks are kept by holding Trader Age ----
   Your last 20 trading days against the bar (60 = Trader Age 2 years). Under it, or without a verified
   Trader Age, there are 14 days of grace to get back; a lapse also needs a trading day after the slip
   began, so a break freezes it. Fewer than 15 trading days counts as good.
   x: {verified, building, recent (the 20-day rating), lastDay (the last trading day's key)} */
function taStandingDefaults(){ return {on:true, bar:60, grace:14}; }
function taStanding(prev, x, cfg, now, dayOf){
  cfg=cfg||taStandingDefaults(); x=x||{}; dayOf=dayOf||(ms=>new Date(ms).toISOString().slice(0,10));
  if(cfg.on===false)return {state:'off', since:null};
  // owed: the clock was started by a rating under the bar. Building again (a fresh wallet, or every day
  // out of the 6 months) doesn't clear it: only a rating back at the bar does.
  const owed=!!(prev&&prev.since>0&&prev.slip);
  let state=!x.verified?'unverified':x.building||x.recent==null?'building':x.recent>=cfg.bar?'good':'slipping';
  if(state==='building'&&owed)state='slipping';
  if(state==='good'||state==='building')return {state, since:null};
  // the grace runs from when it first went under (or unverified), and switching between the two doesn't restart it
  const since=prev&&prev.since>0?prev.since:now, deadline=since+cfg.grace*864e5, slip=owed||state==='slipping';
  if(now>=deadline&&(state==='unverified'||(x.lastDay&&x.lastDay>dayOf(since))))return {state:'lapsed', why:state==='unverified'?'unverified':'rating', since, deadline, slip};
  return {state, since, deadline, slip};
}
// standing, as the server reports it on /me (null: no profile, or the owner switched it off)
function taStandingMe(){ const st=typeof SOC!=='undefined'&&SOC.me&&SOC.me.standing; return st&&st.on?st:null; }
const TA_PERKS='duels, competitions, the leaderboards and the coach’s full allowance';
function taDaysLeft(at){ const n=Math.max(0,Math.ceil((at-Date.now())/864e5)); return n===0?'today':n===1?'1 day':n+' days'; }
function taWhen(at){ try{ return new Date(at).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); }catch(e){ return ''; } }
// on Today, only when something needs doing: slipping, unverified, or lapsed
function taStandingBannerHtml(){
  const st=taStandingMe(); if(!st||st.exempt||!['slipping','unverified','lapsed'].includes(st.state))return '';
  const yrs=taFmtYears(st.years), now20=st.recent!=null?taFmtYears(taYears(st.recent)):null, lapsed=st.state==='lapsed', col=lapsed?PZ_COL.low:PZ_COL.mid;
  const unver=st.state==='unverified'||(lapsed&&st.why==='unverified');
  const head=lapsed?'Standing lapsed':unver?'Verify to keep your perks':'Standing slipping';
  const text=unver?(lapsed?'Your wallet isn’t verified, so '+TA_PERKS+' are locked. Verify it and they open again.':'Verify your wallet within '+taDaysLeft(st.deadline)+' to keep '+TA_PERKS+'.')
    :lapsed?(now20?'Your last 20 trading days are at Trader Age '+now20+', under the '+yrs+' that keeps ':'Your Trader Age isn’t back at '+yrs+' yet, so you’ve lost ')+TA_PERKS+'. Get back to '+yrs+' and they open again.'
    :(now20?'Your last 20 trading days are at Trader Age '+now20+'.':'Your Trader Age isn’t back at '+yrs+' yet.')+' Get back to '+yrs+' by '+taWhen(st.deadline)+' to keep '+TA_PERKS+'.'+(st.deadline<Date.now()?' The clock waits while you’re not trading.':'');
  return `<section class="pz-card pz-kv pz-span" role="status" style="border:1px solid color-mix(in srgb, ${col} 50%, var(--pz-line));background:color-mix(in srgb, ${col} 9%, var(--pz-card))">
    <div class="pz-kvrow"><span class="pz-lbl" style="color:${col}">${pzI('shield',14)} ${esc(head)}</span><a class="pz-link" href="${unver?'#sharing':'#age'}" style="min-height:0">${unver?'Verify':'What to do'} ${pzI('chev',14)}</a></div>
    <p style="margin:0;font-size:14px;line-height:1.45">${esc(text)}</p></section>`;
}
// on the Trader Age screen: where your standing is, and the rule
function taStandingCardHtml(){
  const st=taStandingMe(), cfg=(typeof SOC!=='undefined'&&SOC.cfg&&SOC.cfg.standing)||null;
  if(!st&&!(cfg&&cfg.on))return '';
  const yrs=taFmtYears(st?st.years:cfg.years), grace=st?st.grace:cfg.grace;
  const rule=`<p class="pz-fine">Your last 20 trading days at Trader Age ${esc(yrs)} or more (rating ${st?st.bar:cfg.bar}) keep ${TA_PERKS}. Under it, or without a verified wallet, you have ${grace} days to get back before they lock. The clock waits while you’re not trading, and it never touches your level, XP or badges.</p>`;
  if(!st)return `<section class="pz-card pz-kv"><b class="pz-kvh">Standing</b><p class="pz-sub" style="font-size:13px">Members with a profile keep their perks by holding their Trader Age.</p>${rule}</section>`;
  if(st.exempt)return `<section class="pz-card pz-kv"><b class="pz-kvh">Standing</b><p class="pz-sub" style="font-size:13px">Your perks stay open whatever your Trader Age: the owner unlocked everything for you.</p>${rule}</section>`;
  const W={good:['Good',PZ_COL.good],building:['Building',PZ_COL.xp],slipping:['Slipping',PZ_COL.mid],unverified:['Not verified',PZ_COL.mid],lapsed:['Lapsed',PZ_COL.low]}[st.state]||['—','var(--pz-muted)'];
  const now20=st.recent!=null&&st.recentN?`Last ${st.recentN} trading day${st.recentN===1?'':'s'}: Trader Age ${esc(taFmtYears(taYears(st.recent)))}. `:'';
  const what=st.state==='good'?'Your perks are open.':st.state==='building'?'Your perks are open while your Trader Age builds.'
    :st.state==='slipping'?`Get back to ${esc(yrs)} by ${esc(taWhen(st.deadline))} to keep your perks.`
    :st.state==='unverified'?`Verify your wallet within ${esc(taDaysLeft(st.deadline))} to keep your perks. <a href="#sharing">Verify my discipline</a>`
    :st.why==='unverified'?'Your perks are locked until your wallet is verified. <a href="#sharing">Verify my discipline</a>':`Your perks are locked until you’re back at ${esc(yrs)}.`;
  return `<section class="pz-card pz-kv"><div class="pz-kvrow"><b class="pz-kvh">Standing</b><span style="font-weight:700;color:${W[1]}">${W[0]}</span></div>
    <p class="pz-sub" style="font-size:13px">${now20}${what}</p>${rule}</section>`;
}
const TA_PART={discipline:['Discipline','Your daily Discipline score, read from your fills',65],steadiness:['Steadiness','How even your daily scores are',15],
  limit:['Loss limit kept','Days inside your loss limit (no limit set counts as 70)',10],log:['Prep and journal','Morning prep done, trades journaled',10]};
// the server's verified Trader Age when it has one (a member whose wallet it reads), else this device's estimate
function taOf(D){
  const v=typeof SOC!=='undefined'&&SOC.me&&SOC.me.ta;
  // (while the server is still building one, e.g. a wallet just added, this device's estimate shows instead)
  if(v&&v.n&&!v.building)return Object.assign({},v,{verified:true,week:v.week||{n:0},weeks:v.weeks||[],pace:v.pace==null?undefined:v.pace});
  return taLocal(D);
}
// this device's inputs: the game's trading days, the journal (for prep), the first fill on record
function taInputs(days){
  let firstAt=0; for(const t of (typeof allTrades!=='undefined'?allTrades:[])){ const a=+t.openTime||+t.closeTime||0; if(a>0&&(!firstAt||a<firstAt))firstAt=a; }
  return {days:days||[], J:typeof journal!=='undefined'?journal:{}, opts:{firstAt, dayOf:typeof dayKey==='function'?dayKey:undefined}};
}
function taLocal(D){ const I=taInputs(D.g.days); return traderAge(I.days, I.J, I.opts); }
// the history is worked out once per set of days (the game's days array is rebuilt when anything changes)
const _taHist=new WeakMap();
function taHistoryOf(days){ if(!days||!days.length)return []; let h=_taHist.get(days); if(!h){ const I=taInputs(days); h=taHistory(I.days,I.J,I.opts); _taHist.set(days,h); } return h; }
function taPaceWord(p){ return p>=1.1?'maturing':p<=0.9?'slipping':'steady'; }
function taPaceCol(p){ return p>=1.1?PZ_COL.good:p<=0.9?PZ_COL.low:PZ_COL.mid; }
// verified by the server from the wallet's fills, or an estimate made here (with what it takes to verify it)
function taEstimateNote(A){
  if(A&&A.verified)return 'Verified: the server worked it out from your wallet’s fills, with the prep, journal and loss-limit days your app reported.';
  const member=typeof SOC!=='undefined'&&SOC.key, owner=typeof SRV!=='undefined'&&SRV.token&&!SRV.badAuth;
  if(owner&&!member)return 'Estimated on this device from your fills and journal.';
  if(member)return 'Estimated on this device. It’s verified once the server reads your wallet: turn on <a href="#sharing">Verify my discipline</a> with a wallet added'+(SOC.me&&SOC.me.needsClaim?' and <a href="#account">claimed</a>':'')+'.';
  return 'Estimated on this device. <a href="#social">Create a profile</a> to have it verified and to earn the XP multiplier.';
}
// a Trader Age milestone badge earned in the last 7 days, said once on the card
function taMilestoneNote(D){
  const c=D.g&&D.g.catalog, since=typeof dayKey==='function'?dayKey(Date.now()-7*864e5):'';
  const b=c&&c.earned.filter(x=>x.fam==='traderage'&&x.k>=since).pop();
  return b?`<a class="pz-fine" href="#badges" style="color:${PZ_COL.good};text-decoration:none">New milestone: ${esc(b.desc)} ›</a>`:'';
}
function taCardHtml(D){
  const A=taOf(D); // no trading days yet: it shows as building, so it can be found
  const head=`<div class="pz-kvrow"><span class="pz-lbl" style="color:${PZ_COL.xp}">Trader Age${A.verified?' · ✓ verified':''}</span><a class="pz-link" href="#age" style="min-height:0">What builds it ${pzI('chev',14)}</a></div>`;
  if(A.building)return `<section class="pz-card pz-kv">${head}
    <b style="font-size:17px">Building your Trader Age</b>${pzBar((TA.minDays-A.need)/TA.minDays,PZ_COL.xp)}
    <p class="pz-sub" style="font-size:13px">${A.need} more trading day${A.need===1?'':'s'} and it appears: how seasoned your process looks, in years.</p></section>`;
  const pace=A.pace!=null?`<span style="color:${taPaceCol(A.pace)};font-weight:600">Pace ${A.pace.toFixed(1)}× · ${taPaceWord(A.pace)}</span>`:'<span class="pz-sub">Pace needs 3 trading days this week</span>';
  return `<section class="pz-card pz-kv">${head}
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-family:var(--pz-num);font-size:40px;font-weight:600;line-height:1">${esc(taFmtYears(A.age))}</span>
      ${A.tradingYears!=null?`<span class="pz-sub" style="font-size:13px">trading for ${esc(taFmtYears(A.tradingYears))}</span>`:''}</div>
    <p style="font-size:13px;margin:0">${pace}</p>${taMilestoneNote(D)}</section>`;
}
const TA_SLIP={revenge:'Revenge entries',afterTwo:'Trading on after two losses',sizeUp:'Sizing up after a loss',addLoser:'Adding to losers',overtrade:'Overtrading',heldLoser:'Holding losers too long'};
// what each slip costs, in years (worked out on this device's trades)
function taWhatIfHtml(D){
  const I=taInputs(D.g.days); let W=[]; try{ W=taWhatIf(I.days,I.J,I.opts); }catch(e){ console.warn('what-if',e); }
  if(!W.length)return `<section class="pz-card pz-kv"><b class="pz-kvh">What your slips cost</b><p class="pz-sub" style="font-size:13px">No slips in the last 6 months are holding your Trader Age back.</p></section>`;
  const top=W[0].gain;
  return `<section class="pz-card pz-kv"><b class="pz-kvh">What your slips cost</b>
    <p class="pz-sub" style="font-size:13px">Your Trader Age without each kind of slip, everything else the same.</p>
    ${W.slice(0,4).map(x=>`<div class="pz-row" data-pz-tip="${esc(TA_SLIP[x.k]+': '+x.n+' trade'+(x.n===1?'':'s')+' in 6 months. Without them: '+taFmtYears(x.age)+'.')}"><div class="pz-row-t"><span>${esc(TA_SLIP[x.k])}<span class="pz-sub" style="display:block;font-size:12px">${x.n} trade${x.n===1?'':'s'} · without them ${esc(taFmtYears(x.age))}</span></span><b style="color:${PZ_COL.good}">+${esc(taFmtYears(x.gain))}</b></div>${pzBar(x.gain/top,PZ_COL.low)}</div>`).join('')}
    <p class="pz-fine">Worked out from this device’s trades. <a href="#progress">Plug a leak</a> to work on one.</p></section>`;
}
// Trader Age over time (the end of each week with trading, last 26) against how long you've traded,
// on one scale in years where every gridline doubles (the same scale the rating uses)
function taHistoryChartHtml(D){
  let H=[]; try{ H=taHistoryOf(D.g.days); }catch(e){ console.warn('history',e); }
  const firstAt=taInputs([]).opts.firstAt, byW=new Map(); for(const h of H)if(h.age!=null)byW.set(isoWeekOfKey(h.key),h);
  const P=[...byW.entries()].slice(-26).map(([w,h])=>({w,key:h.key,age:h.age,ty:firstAt?Math.max(1/12,(Date.parse(h.key+'T23:59:59Z')-firstAt)/(365.25*864e5)):null}));
  if(P.length<2)return '';
  const r=y=>50+10*Math.log2(Math.max(1/12,Math.min(TA.cap,y))), vals=P.flatMap(p=>[r(p.age)].concat(p.ty?[r(p.ty)]:[]));
  const lo=Math.min(...vals)-4, hi=Math.max(...vals)+4, Wd=320, Ht=150, L=36, R=10, T=10, B=24;
  const x=i=>L+(Wd-L-R)*i/(P.length-1), y=v=>T+(Ht-T-B)*(1-(v-lo)/(hi-lo));
  const grid=[[1/12,'1 mo'],[1/4,'3 mo'],[1/2,'6 mo'],[1,'1 yr'],[2,'2 yrs'],[4,'4 yrs'],[8,'8 yrs'],[16,'16 yrs']].filter(([g])=>r(g)>=lo&&r(g)<=hi);
  const line=f=>P.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(f(p)).toFixed(1)).join(' ');
  const last=P[P.length-1], tip=p=>esc(taWeekLabel(p.w)+'\nTrader Age '+taFmtYears(p.age)+(p.ty?'\nTrading for '+taFmtYears(p.ty):''));
  return `<section class="pz-card pz-kv"><b class="pz-kvh">Over time</b>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px" class="pz-sub"><span><svg width="18" height="8" aria-hidden="true"><path d="M1 4H17" stroke="${PZ_COL.xp}" stroke-width="2" stroke-linecap="round"/></svg> Trader Age</span>${last.ty?`<span><svg width="18" height="8" aria-hidden="true"><path d="M1 4H17" stroke="var(--pz-muted)" stroke-width="2" stroke-dasharray="3 3"/></svg> Time trading</span>`:''}</div>
    <svg viewBox="0 0 ${Wd} ${Ht}" width="100%" role="img" aria-label="${esc('Trader Age by week, from '+taFmtYears(P[0].age)+' to '+taFmtYears(last.age)+(last.ty?', trading for '+taFmtYears(last.ty):''))}" style="display:block;overflow:visible">
      ${grid.map(([g,l])=>`<line x1="${L}" x2="${Wd-R}" y1="${y(r(g)).toFixed(1)}" y2="${y(r(g)).toFixed(1)}" stroke="var(--pz-line)" stroke-width="1"/><text x="${L-6}" y="${(y(r(g))+4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--pz-muted)">${l}</text>`).join('')}
      ${last.ty?`<path d="${line(p=>r(p.ty))}" fill="none" stroke="var(--pz-muted)" stroke-width="2" stroke-dasharray="4 4" stroke-linejoin="round"/>`:''}
      <path d="${line(p=>r(p.age))}" fill="none" stroke="${PZ_COL.xp}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(P.length-1).toFixed(1)}" cy="${y(r(last.age)).toFixed(1)}" r="4" fill="${PZ_COL.xp}" stroke="var(--pz-card)" stroke-width="2"/>
      <text x="${L}" y="${Ht-6}" font-size="10" fill="var(--pz-muted)">${esc(taWeekLabel(P[0].w).replace('Week of ',''))}</text><text x="${Wd-R}" y="${Ht-6}" font-size="10" fill="var(--pz-muted)" text-anchor="end">${esc(taWeekLabel(last.w).replace('Week of ',''))}</text>
      ${P.map((p,i)=>`<rect x="${(x(i)-(Wd-L-R)/(P.length-1)/2).toFixed(1)}" y="${T}" width="${((Wd-L-R)/(P.length-1)).toFixed(1)}" height="${Ht-T-B}" fill="transparent" data-pz-tip="${tip(p)}"/>`).join('')}
    </svg>
    <p class="pz-fine">Your Trader Age at the end of each week you traded${last.ty?', next to how long you’ve been trading':''}. Every gridline doubles. From this device’s trades.</p></section>`;
}
function taScreenHtml(D){
  const A=taOf(D), back=`<a class="pz-back" href="#today">${pzI('back',20)}Today</a>`;
  const how=`<section class="pz-card pz-kv"><b class="pz-kvh">How it works</b>
    <p class="pz-sub" style="font-size:13px">Every trading day is rated from 0 to 100. Your last 6 months of trading days are averaged, with recent days counting more (a day's weight halves every 30 trading days). Every 10 points doubles your Trader Age: a rating of 50 is 1 year, 60 is 2, 70 is 4, 80 is 8.</p>
    <p class="pz-sub" style="font-size:13px">Only days you trade count, so a break freezes it. It never comes from profit.</p>
    <p class="pz-fine">${taEstimateNote(A)}</p></section>`;
  if(!A.n)return `${back}${pzHead('Your process, in years','Trader Age')}<section class="pz-card"><p class="pz-sub">It starts with your first trading day.</p></section>${taStandingCardHtml()}${how}`;
  if(A.building)return `${back}${pzHead('Your process, in years','Trader Age')}<section class="pz-card pz-kv"><b style="font-size:17px">Building: ${A.need} more trading day${A.need===1?'':'s'}</b>${pzBar((TA.minDays-A.need)/TA.minDays,PZ_COL.xp)}<p class="pz-sub" style="font-size:13px">${A.n} of ${TA.minDays} trading days so far.</p></section>${taStandingCardHtml()}${how}`;
  const ahead=A.tradingYears==null?'Your process, in years':A.age>=A.tradingYears?'Ahead of your experience':'Still catching up with your experience';
  const hero=`<section class="pz-card pz-hero pz-span">
    <div class="pz-hero-ring">${pzRing(taFmtYears(A.age).split(' ')[0],Math.min(1,A.rating/100),PZ_COL.xp,{size:132,cap:taFmtYears(A.age).split(' ')[1]||''})}</div>
    <div class="pz-hero-main"><span class="pz-lbl" style="color:${PZ_COL.xp}">Trader Age</span><h2 class="pz-hero-t">${esc(ahead)}</h2>
      <p class="pz-sub" style="font-size:13px">${A.tradingYears!=null?`Your process looks ${esc(taFmtYears(A.age))} seasoned, and you’ve been trading for ${esc(taFmtYears(A.tradingYears))}. `:''}Rating ${Math.round(A.rating)} from ${A.n} trading days.</p>
      ${A.range?`<p class="pz-fine">Likely between ${esc(taFmtYears(A.range[0]))} and ${esc(taFmtYears(A.range[1]))}.${A.sure<1?` With fewer than ${TA.fullDays} trading days it’s held closer to 1 year, and firms up as you trade.`:''}</p>`:''}</div></section>`;
  const wk=A.week, slip=wk.slip&&typeof PZ_BEH!=='undefined'?PZ_BEH[wk.slip]:null;
  const pace=`<section class="pz-card pz-kv"><b class="pz-kvh">This week</b>${A.pace!=null?`
    <div style="display:flex;align-items:baseline;gap:10px"><span style="font-family:var(--pz-num);font-size:32px;font-weight:600;color:${taPaceCol(A.pace)}">${A.pace.toFixed(1)}×</span><span class="pz-sub">${taPaceWord(A.pace)}</span></div>
    <p class="pz-sub" style="font-size:13px">Over ${wk.n} trading days you traded like someone with ${esc(taFmtYears(wk.age))} behind them, against your 6-month rating.${A.pace<0.9&&slip?' What cost you most: '+esc(slip.toLowerCase())+'.':''}</p>`
    :`<p class="pz-sub" style="font-size:13px">Pace needs at least 3 trading days in the last 7. ${wk.n?'You have '+wk.n+'.':'No trades yet this week.'}</p>`}</section>`;
  const mult=taMultCardHtml(A)+taStandingCardHtml();
  const rows=Object.keys(TA_PART).map(k=>{ const [l,h,w]=TA_PART[k], v=A.parts[k];
    return `<div class="pz-row"><div class="pz-row-t"><span>${esc(l)}<span class="pz-sub" style="display:block;font-size:12px">${esc(h)} · ${w}%</span></span><b>${Math.round(v)}</b></div>${pzBar(v/100,k===A.drag?PZ_COL.low:PZ_COL.xp)}</div>`; }).join('');
  const parts=`<section class="pz-card pz-kv"><b class="pz-kvh">What builds it</b>${rows}<p class="pz-fine">Holding it back most: <b>${esc(TA_PART[A.drag][0].toLowerCase())}</b>.</p></section>`;
  const hist=taHistoryChartHtml(D), costs=taWhatIfHtml(D);
  return `${back}${pzHead('Your process, in years','Trader Age')}<div class="pz-wide">${hero}<div class="pz-col">${hist}${pace}${mult}</div><div class="pz-col">${costs}${parts}${how}</div></div>`;
}
pzFeature({id:'age', today:{label:'Trader Age',hint:'How seasoned your process looks, in years, against how long you’ve traded',col:0,after:'tilt',html:taCardHtml},
  tab:{name:'age',nav:'progress',html:taScreenHtml}});
