// Ledger app · part 6 of 15: price excursions (MAE/MFE), trade replay, the benchmark, auto-refresh.
// ledger.html loads the parts in order as classic scripts sharing one global scope. Code that
// runs while a part loads (not inside a function called later) may only use names declared in
// this part or an earlier one; the boot part runs last. See "Development and testing" in README.md.

/* ============================ MAE/MFE price excursions ============================ */
// How far each trade ran against you (MAE) and in your favor (MFE) between entry and exit,
// measured from exchange candles (candleSnapshot). On-demand because it's fetch-heavy; candles
// are cached in IndexedDB per coin+interval with covered-range tracking, so re-runs and
// overlapping selections only fetch the gaps. Interval is chosen per trade duration so any
// trade costs ≤ ~400 candles. Computation is a linear min/max pass — the fetch dominates, so
// unlike reconstruction/mining this deliberately stays on the main thread.
const EXC_ITVS=[['1m',60e3],['5m',300e3],['15m',900e3],['1h',3600e3],['4h',14400e3],['1d',86400e3]];
// Hyperliquid retains roughly only the most recent ~5000 candles per interval (1m ≈ 3.5 days,
// 5m ≈ 17 days, 15m ≈ 52 days…). Selecting by duration alone made every short trade older than
// a few days request candles that no longer exist — hence skipped. Selection is therefore
// age-aware, and runExcursions retries unmeasured trades at coarser intervals, so the exact
// retention number being wrong self-corrects at the cost of one extra pass.
const EXC_RETAIN=4500; // conservative margin under the ~5000 cap
function excIntervalAt(i){ const c=EXC_ITVS[Math.max(0,Math.min(EXC_ITVS.length-1,i))]; return {name:c[0],ms:c[1]}; }
function excIntervalIdx(durMs,ageMs){ ageMs=ageMs||0;
  for(let i=0;i<EXC_ITVS.length;i++){ const ms=EXC_ITVS[i][1];
    if(durMs/ms<=400 && ageMs<=EXC_RETAIN*ms)return i; }
  return EXC_ITVS.length-1;
}
function excInterval(durMs,ageMs){ return excIntervalAt(excIntervalIdx(durMs,ageMs)); }
// per-trade interval for a given retry pass: pass 0 = age-aware choice, each further pass one coarser
function chooseItv(t,now,pass){ return excIntervalAt(excIntervalIdx(t.closeTime-t.openTime,Math.max(0,now-t.openTime))+(pass||0)); }
// a single candleSnapshot request only returns ~5000 candles; split any merged range that exceeds that
function chunkRanges(ranges,maxSpan){ const out=[];
  for(const r of ranges){ let a=r[0];
    while(r[1]-a>maxSpan){ out.push([a,a+maxSpan]); a+=maxSpan; }
    out.push([a,r[1]]); }
  return out; }
// candles are per venue: a Lighter or Bybit trade is measured on its own exchange's prices
const venueCoin=(venue,coin)=>(venue?VENUE_NAMES[venue]+' ':'')+coin;
const excKey=(coin,itvName,venue)=>(venue?venue+':':'')+coin+'|'+itvName;
function mergeRanges(wins,gap){ const s=[...wins].sort((a,b)=>a[0]-b[0]); const out=[];
  for(const w of s){ const L=out[out.length-1];
    if(L&&w[0]<=L[1]+(gap||0)){ if(w[1]>L[1])L[1]=w[1]; } else out.push([w[0],w[1]]); }
  return out; }
function uncoveredRanges(want,covered){ let segs=[[want[0],want[1]]];
  for(const c of (covered||[])){ const next=[];
    for(const s of segs){
      if(c[1]<=s[0]||c[0]>=s[1]){ next.push(s); continue; }
      if(c[0]>s[0])next.push([s[0],c[0]]);
      if(c[1]<s[1])next.push([c[1],s[1]]); }
    segs=next; if(!segs.length)break; }
  return segs; }
function planExcursions(trades,now,pass){
  now=now||Date.now();
  const plan=new Map();
  for(const t of trades){
    if(t.isOpen||!(t.avgEntry>0)||!(t.closeTime>t.openTime))continue;
    const itv=chooseItv(t,now,pass), venue=candleVenue(t), k=excKey(t.coin,itv.name,venue);
    let e=plan.get(k); if(!e){ e={coin:t.coin,venue,itv,windows:[]}; plan.set(k,e); }
    e.windows.push([t.openTime-itv.ms,t.closeTime+itv.ms]);
  }
  // merge windows closer than 30 candles apart — one request instead of many tiny ones —
  // then re-split anything longer than one request's worth of candles
  for(const e of plan.values())e.ranges=chunkRanges(mergeRanges(e.windows,e.itv.ms*30),e.itv.ms*4000);
  return plan;
}
function mergeCandles(oldC,newC){ const m=new Map();
  for(const c of (oldC||[]))m.set(c[0],c); for(const c of (newC||[]))m.set(c[0],c);
  return [...m.values()].sort((a,b)=>a[0]-b[0]); }
async function fetchCandles(coin,itvName,a,b){
  // Returns {rows, coveredTo}. coveredTo < b when the page cap cut the fetch short — callers
  // must record coverage only up to coveredTo, otherwise the gap would be marked covered,
  // never refetched, and excursions computed over it would be silently wrong forever.
  let start=a; const rows=[]; let pages=0, coveredTo=b;
  while(start<b){ // HL caps ~5000 candles per response; paginate if the range is bigger
    if(pages>=12){ coveredTo=start; break; } // hard page cap — everything past `start` was NOT fetched
    const batch=await hlPost({type:'candleSnapshot',req:{coin,interval:itvName,startTime:Math.floor(start),endTime:Math.floor(b)}});
    if(!Array.isArray(batch)||!batch.length)break; // exchange has nothing (further) in range — that IS coverage
    for(const r of batch)rows.push([+r.t,parseFloat(r.h),parseFloat(r.l),parseFloat(r.c),parseFloat(r.o)]); // open appended last so older [t,h,l,c] cache rows stay index-compatible
    const lastT=+batch[batch.length-1].t;
    if(batch.length<5000||lastT<=start)break;
    start=lastT+1; pages++; await sleep(120);
  }
  return {rows, coveredTo};
}
// candles: sorted [openTime, high, low, close, open?]; the open (index 4) exists only on rows fetched
// after the replay-candlestick build — everything here uses indexes 1-3 so old cache rows are fine.
// A candle counts if it overlaps (openTime, closeTime).
// Also records WHEN the extremes happened: maeAt/mfeAt are fractions of the trade's duration
// (0 = at entry, 1 = at exit, candle-midpoint resolution) — "winners dip early, peak late"
// is a different exit prescription than "winners peak early, then bleed".
function computeExcursion(t,candles,ms){
  const a=t.openTime,b=t.closeTime;
  let lo=0,hi=candles.length; while(lo<hi){ const m=(lo+hi)>>1; if(candles[m][0]+ms<=a)lo=m+1; else hi=m; }
  let h=-Infinity,l=Infinity,n=0,hT=null,lT=null;
  for(let i=lo;i<candles.length&&candles[i][0]<b;i++){ const c=candles[i];
    if(c[1]>h){ h=c[1]; hT=c[0]; } if(c[2]<l){ l=c[2]; lT=c[0]; } n++; }
  if(!n)return null;
  const e=t.avgEntry; if(!(e>0))return null;
  h=Math.max(h,e); l=Math.min(l,e); // your own entry is by definition part of the path
  const short=t.dir==='Short';
  const dur=Math.max(1,b-a);
  const frac=x=>x==null?null:Math.max(0,Math.min(1,(x+ms/2-a)/dur));
  const advT=short?hT:lT, favT=short?lT:hT;
  const maePct=(short?(h-e):(e-l))/e*100, mfePct=(short?(e-l):(h-e))/e*100;
  return {maePct,mfePct,nC:n,
    maeAt:maePct>0?frac(advT):null, mfeAt:mfePct>0?frac(favT):null};
}
function excSummary(rows){
  if(!rows||!rows.length)return null;
  // stats come from precisely measured trades only; coarse rows (retention-forced wide candles,
  // excursion = upper bound) would inflate every MAE/MFE number
  const precise=rows.filter(r=>!r.coarse);
  const use=precise.length?precise:rows, approx=!precise.length;
  const med=a=>{ if(!a.length)return null; const s=[...a].sort((x,y)=>x-y), m=s.length>>1;
    return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  const q=(a,p)=>{ if(!a.length)return null; const s=[...a].sort((x,y)=>x-y);
    return s[Math.min(s.length-1,Math.floor(p*s.length))]; };
  // isWin/isLoss, not net>0: scratch trades inside the break-even band are neither — counting
  // them as winners skewed the stop/capture statistics that everything else calls B/E.
  const W=use.filter(r=>isWin(r.net)),L=use.filter(r=>isLoss(r.net));
  const mfe$=r=>r.mfePct/100*r.notional;
  const capDen=W.reduce((s,r)=>s+mfe$(r),0);
  const capture=capDen>0?W.reduce((s,r)=>s+r.net,0)/capDen:null;
  const left=W.reduce((s,r)=>s+Math.max(0,mfe$(r)-r.net),0);
  const medMfeW=med(W.map(r=>r.mfePct));
  const wR=W.map(r=>r.maeR).filter(x=>x!=null);
  const wMaeAt=W.map(r=>r.maeAt).filter(x=>x!=null), wMfeAt=W.map(r=>r.mfeAt).filter(x=>x!=null);
  return {n:use.length,w:W.length,l:L.length,coarseN:rows.length-precise.length,approx,
    // timing: when winners hit worst dip / peak, as fraction of the hold (0=entry, 1=exit)
    medMaeAtW:med(wMaeAt), medMfeAtW:med(wMfeAt), timedN:Math.min(wMaeAt.length,wMfeAt.length),
    medMaeW:med(W.map(r=>r.maePct)), medMfeW,
    medMaeL:med(L.map(r=>r.maePct)), medMfeL:med(L.map(r=>r.mfePct)),
    winnersMaeP90:q(W.map(r=>r.maePct),0.9), capture, left,
    // R-multiple view of the same stop question, when planned risk / 1R is known
    medMaeWR:med(wR), winnersMaeP90R:q(wR,0.9),
    // losers that reached a typical winner's peak open profit and still closed red
    paperWinners:medMfeW!=null?L.filter(r=>r.mfePct>=medMfeW).length:null};
}
// one measured row per trade; risk (planned $ or 1R fallback) converts excursions into R-multiples.
// coarse = measured with candles wider than half the trade's duration (retention forced a coarse
// interval) — excursion is then an upper bound from candle extremes, so it's flagged and kept out
// of the summary statistics.
function excRow(t,ex,risk){
  const notional=(t.maxSize||0)*(t.avgEntry||0);
  const r=(risk>0)?risk:null;
  return {id:t.id,coin:t.coin,symbol:t.symbol,dir:t.dir,net:t.net,ret:retPct(t),notional,
    maePct:ex.maePct,mfePct:ex.mfePct,nC:ex.nC,risk:r,
    maeAt:ex.maeAt!=null?ex.maeAt:null, mfeAt:ex.mfeAt!=null?ex.mfeAt:null,
    itvMs:ex.itvMs||null, coarse:!!(ex.itvMs&&(t.closeTime-t.openTime)<2*ex.itvMs),
    maeR:r?ex.maePct/100*notional/r:null, mfeR:r?ex.mfePct/100*notional/r:null};
}
// A spot "open trade" left over from a mostly-sold bag (tiny remainder keeps the trade
// open in reconstruction) is dust, not a position — don't monitor it. Dust = remaining
// size worth under $10 at entry, or under 1% of the position's peak size.
function isDustOpen(t){
  if(t.market!=='spot')return false;
  const rem=Math.max(0,(t.openSz||0)-(t.closeSz||0));
  return rem*(t.avgEntry||0)<10 || (t.maxSize>0&&rem/t.maxSize<0.01);
}
let _excM={}; // trade id → measured excursion row; feeds the journal rows and the miner's excursion families
let _excCache={key:null,rows:null,openRows:null,skippedCoins:null,skippedN:0};
async function runExcursions(closed,openTrades){
  const now=Date.now();
  const base=closed.filter(t=>!t.isOpen&&t.avgEntry>0&&(t.maxSize||0)*(t.avgEntry||0)>0);
  // open positions are measured over [openTime, now] via a pseudo-close so the same
  // planner/cache/compute path serves the live monitor (#4)
  const pseudo=(openTrades||[]).filter(t=>t.isOpen&&t.avgEntry>0&&!isDustOpen(t))
    .map(t=>({...t,isOpen:false,closeTime:now,_open:true}));
  // precision ratchet: once a closed trade is measured, the measurement is persisted and
  // reused forever. A trade measured while fine candles still existed stays precise even
  // after retention rolls past it — so the "approximate" bucket is a one-time backfill
  // artifact that only shrinks if excursions are run regularly. Open positions always
  // re-measure (their window grows). Retrying persisted-coarse trades is pointless: age
  // only increases, so the available interval can only get coarser.
  let persisted={v:1,rows:{}};
  try{ const p=await idbGet('excRows'); if(p&&p.v===1&&p.rows&&typeof p.rows==='object')persisted=p; }catch(err){}
  const store=new Map(); const skippedCoins=new Set(); const measured=new Map();
  let pending=[];
  for(const t of base){ const p=persisted.rows[t.id];
    if(p&&p.maePct!=null)measured.set(t.id,{t,ex:{maePct:p.maePct,mfePct:p.mfePct,nC:p.nC,itvMs:p.itvMs,maeAt:p.maeAt!=null?p.maeAt:null,mfeAt:p.mfeAt!=null?p.mfeAt:null}});
    else pending.push(t);
  }
  const reused=measured.size;
  pending=pending.concat(pseudo);
  let grandReq=0;
  const MAXPASS=3; // pass 0 = age-aware interval; each retry pass one interval coarser
  for(let pass=0;pass<MAXPASS&&pending.length;pass++){
    const plan=planExcursions(pending,now,pass);
    const jobs=[]; let reqTotal=0;
    for(const [k,e] of plan){
      if(skippedCoins.has(venueCoin(e.venue,e.coin)))continue;
      let cache=null; try{ cache=await idbGet('cnd:'+k); }catch(err){}
      if(!cache||cache.v!==1||!Array.isArray(cache.candles)||!Array.isArray(cache.ranges))cache={v:1,candles:[],ranges:[]};
      const missing=[]; for(const r of e.ranges)for(const u of uncoveredRanges(r,cache.ranges))if(u[1]-u[0]>e.itv.ms)missing.push(u);
      jobs.push({k,e,cache,missing}); reqTotal+=missing.length;
    }
    if(grandReq+reqTotal>150)throw new Error('this selection needs '+(grandReq+reqTotal)+'+ candle requests — narrow the period or date range and re-run (already-fetched candles stay cached)');
    let req=0;
    for(const j of jobs){
      for(const u of j.missing){
        req++; grandReq++;
        setStatus(`Fetching candles… ${req}/${reqTotal}${pass?` (retry pass ${pass})`:''} (${j.e.coin} ${j.e.itv.name})`,true);
        try{ const c=await venueFetchCandles(j.e.venue,j.e.coin,j.e.itv.name,u[0],u[1]);
          j.cache.candles=mergeCandles(j.cache.candles,c.rows);
          if(c.coveredTo>u[0]) j.cache.ranges=mergeRanges([...j.cache.ranges,[u[0],c.coveredTo]],1);
          await sleep(90);
        }catch(err){ skippedCoins.add(venueCoin(j.e.venue,j.e.coin)); } // no candles for this coin (some HIP-3/spot names) — skip, don't sink the run
      }
      try{ await idbSet('cnd:'+j.k,j.cache); }catch(err){}
      store.set(j.k,{candles:j.cache.candles,ms:j.e.itv.ms});
    }
    const still=[];
    for(const t of pending){
      if(skippedCoins.has(venueCoin(candleVenue(t),t.coin)))continue; // coin-level failure: retrying coarser won't help
      const itv=chooseItv(t,now,pass), s=store.get(excKey(t.coin,itv.name,candleVenue(t)));
      const ex=s?computeExcursion(t,s.candles,s.ms):null;
      if(ex){ ex.itvMs=itv.ms; measured.set(t.id,{t,ex}); }
      else still.push(t); // likely beyond this interval's retention — coarser candles next pass
    }
    pending=still;
  }
  // persist any newly measured closed trades (never open ones — their window still grows)
  let dirty=false;
  for(const {t,ex} of measured.values()){ if(t._open||persisted.rows[t.id])continue;
    persisted.rows[t.id]={maePct:ex.maePct,mfePct:ex.mfePct,nC:ex.nC,itvMs:ex.itvMs,
      maeAt:ex.maeAt!=null?ex.maeAt:null, mfeAt:ex.mfeAt!=null?ex.mfeAt:null,
      coarse:!!(ex.itvMs&&(t.closeTime-t.openTime)<2*ex.itvMs)}; dirty=true;
  }
  if(dirty){ try{ await idbSet('excRows',persisted); }catch(err){} schedulePersist(); }
  const rows=[],openRows=[]; let skippedN=base.filter(t=>!measured.has(t.id)).length;
  for(const {t,ex} of measured.values()){
    if(t._open){ const r=excRow(t,ex,riskFor(t)); openRows.push({...r,ageMs:now-t.openTime}); }
    else if(retPct(t)!==null)rows.push(excRow(t,ex,riskFor(t)));
    else skippedN++;
  }
  return {rows,openRows,skippedCoins:[...skippedCoins],skippedN,reused};
}
// plain-English takeaways from the summary — pure so the harness can pin the wording logic
function excVerdict(s){
  const out=[]; if(!s)return out;
  const R=x=>x!=null?' ('+x.toFixed(2)+'R)':'';
  if(s.winnersMaeP90!=null)
    out.push(`9 in 10 of your winning trades never moved more than <b>${s.winnersMaeP90.toFixed(2)}%</b>${R(s.winnersMaeP90R)} against you before working out. A stop just beyond that line protects almost every winner${s.medMaeL!=null?` — and your typical loser fell <b>${s.medMaeL.toFixed(2)}%</b>, so it cuts those sooner`:''}.`);
  if(s.capture!=null)
    out.push(`For every $1 of peak open profit on winning trades, you banked <b>${Math.round(s.capture*100)}¢</b> and gave back <b>${Math.round(100-s.capture*100)}¢</b> before exiting.`);
  if(s.medMaeAtW!=null&&s.medMfeAtW!=null&&(s.timedN||0)>=10){
    const early=s.medMaeAtW<=0.35, late=s.medMfeAtW>=0.6;
    out.push(`Timing: your typical winner hits its worst dip <b>${Math.round(s.medMaeAtW*100)}%</b> of the way through the hold and peaks at <b>${Math.round(s.medMfeAtW*100)}%</b>${early&&late?' — dip-early-run-late: the danger zone is right after entry, and patience pays at the end':early?' — the danger zone is right after entry':''}.`);
  }
  if(s.paperWinners!=null&&s.paperWinners>0&&s.l)
    out.push(`<b>${s.paperWinners}</b> of your ${s.l} losers were up as much as a typical winner before closing red — those losses came from <b>exits</b>, not entries.`);
  if(s.approx)
    out.push(`Every measurement in this selection is a coarse-candle approximation — treat the numbers above as upper bounds.`);
  return out;
}
function renderExcResults(c){
  const box=$('excBox'); if(!box)return;
  const s=excSummary(c.rows);
  if(!s){ box.innerHTML='<p class="lead">No candle data available for these trades'
    +(c.skippedCoins&&c.skippedCoins.length?' (no candles for: '+c.skippedCoins.map(esc).join(', ')+')':'')+'.</p>'; return; }
  const f2=x=>x==null?'—':x.toFixed(2)+'%';
  const fR=x=>x==null?'':' <span style="color:var(--faint)">('+x.toFixed(2)+'R)</span>';
  const row=(k,v,tip)=>`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:6px 0"><span class="lead" style="margin:0"${tip?` data-tip="${tip}"`:''}>${k}</span><span class="num" style="font-size:14px;color:var(--text);text-align:right">${v}</span></div>`;
  // coverage line — how much of the selection these stats actually describe
  const coverage=`<p class="lead" style="margin:2px 0 10px"><b>${s.n}</b> trades measured precisely (${s.w} wins / ${s.l} losses)`
    +(s.coarseN?` · <span data-tip="The exchange only serves fine candles for recent history (1m ≈ 3.5 days, 15m ≈ 52 days back). These older short trades could only be measured with candles wider than the trade itself, so their excursions are upper bounds: shown with ≈ in journal rows, excluded from the numbers below. Measurements are saved permanently — run excursions regularly and new trades lock in precise forever, so this bucket only shrinks.">${s.coarseN} approximate (≈)</span>`:'')
    +(c.skippedN?` · ${c.skippedN} skipped — no candles${c.skippedCoins&&c.skippedCoins.length?' for '+c.skippedCoins.slice(0,4).map(esc).join(', '):''}`:'')
    +(c.reused?` · ${c.reused} loaded from saved measurements`:'')+`</p>`;
  const stopsCard=`<div class="diag-card"><h3 data-tip="Max adverse excursion (MAE): the worst the price went against you during each trade. If winners rarely exceed some dip before working out, a stop just past that dip costs you almost no winners while ending losers earlier.">Your stops — what winners endure</h3>
    ${row('Typical winner pullback',`<b>${f2(s.medMaeW)}</b>${fR(s.medMaeWR)}`,'Median MAE across winning trades — the dip a normal winner survives on the way to profit.')}
    ${row('90% of winners stayed within',`<b>${f2(s.winnersMaeP90)}</b>${fR(s.winnersMaeP90R)}`,'Only 1 in 10 winners ever went further against you than this. Stop distance beyond this line protected almost nothing.')}
    ${row('Typical loser drawdown',`<b>${f2(s.medMaeL)}</b>`,'Median MAE across losing trades — how much further losers fall than winners dip. The gap between this and the winner numbers is your stop\u2019s working room.')}
  </div>`;
  const exitsCard=`<div class="diag-card"><h3 data-tip="Max favorable excursion (MFE): the best open profit each trade reached. Comparing it with what you actually realized shows how much of the move you keep versus give back.">Your exits — profit kept vs given back</h3>
    ${row('Typical winner peak',`<b>${f2(s.medMfeW)}</b>`,'Median MFE across winning trades — the open profit a normal winner reached at its best moment.')}
    ${s.capture!=null?row('Kept of every $1 peak profit',`<b>${Math.round(s.capture*100)}¢</b>`,'Realized net of winners divided by their combined peak open profit. The rest evaporated between the peak and your exit.'):''}
    ${s.capture!=null?row('Given back after the peak',`<b>${fmtUsd(s.left)}</b>`,'Total dollars of winners\u2019 peak open profit that was not realized. Some giveback is unavoidable — you can\u2019t sell the top — but this is the size of the pool better exits draw from.'):''}
    ${s.paperWinners!=null?row('Losers that peaked like winners',`<b>${s.paperWinners}</b> of ${s.l}`,'Losing trades whose open profit reached the median winner\u2019s peak before closing red. Each one is a win that was given back — an exit problem, not an entry problem.'):''}
  </div>`;
  const verdict=excVerdict(s).map(v=>`<p class="lead" style="margin:6px 0">${v}</p>`).join('');
  // open-position monitor: current excursion vs what your winners historically endured
  let openHtml='';
  if(c.openRows&&c.openRows.length){
    const rowsH=c.openRows.map(r=>{
      const over=s.winnersMaeP90!=null&&r.maePct>s.winnersMaeP90;
      const ap=r.coarse?'≈':'';
      const nm=(r.symbol&&!/^@\d+$/.test(r.symbol))?r.symbol:(spotMaps.nameByCoin[r.coin]||r.symbol||r.coin);
      return `<li>${esc(nm)} ${r.dir==='Short'?'short':'long'} · open ${fmtDur(r.ageMs)} · worst dip so far <b class="${over?'loss':''}">${ap}${f2(r.maePct)}</b>${fR(r.maeR)} · best so far ${ap}${f2(r.mfePct)}`
        +(over?` · <span class="badge no" data-tip="This position has already moved further against you than 90% of your historical winners ever did before recovering. Statistically it is behaving like your losers.">beyond winner territory</span>`:` · <span class="badge ok">within winner range</span>`)+`</li>`;
    }).join('');
    openHtml=`<div style="margin-top:14px"><h3 data-tip="Live positions measured with the same candle machinery, from entry to now, compared against the drawdown 90% of your historical winners stayed inside.">Open positions vs your history</h3><ul class="diag-list">${rowsH}</ul></div>`;
  }
  box.innerHTML=`${coverage}
    <div class="diag-grid">${stopsCard}${exitsCard}</div>
    <div style="margin-top:12px">${verdict}</div>${openHtml}
    <div class="chart-box" style="height:300px;margin-top:12px"><canvas id="excScatter"></canvas></div>
    <p class="lead" style="font-size:12px;color:var(--faint);margin-top:8px">Each dot is one trade: how far it dipped (→) vs how it ended (↑). Green above the line at its dip = survived and won; the dashed line marks the 90% winner boundary — dots right of it are in loser-behavior territory. Measured from your size-weighted entry over candle highs/lows; intra-candle sequencing is invisible, so values within one candle\u2019s range are approximate. R uses planned risk (journal) or 1R fallback. Skipped trades have no candles at any interval. Candles and measurements are cached locally — re-runs only fetch what\u2019s new.</p>
    ${c.closedRef?'<div style="margin-top:8px"><button class="btn ghost" id="excRerun" data-tip="Re-measure now: closed trades load instantly from saved measurements; open positions are re-measured from entry to the current moment, so the monitor above keeps tracking a position while it is still open instead of going stale until something closes.">Update open positions</button></div>':''}`;
  const rr=$('excRerun'); if(rr)rr.onclick=rerunExcursions;
  const plotRows=c.rows.filter(r=>!r.coarse).length?c.rows.filter(r=>!r.coarse):c.rows;
  const W=plotRows.filter(r=>r.net>0),L=plotRows.filter(r=>r.net<=0);
  if(_diagCharts.exc)_diagCharts.exc.destroy();
  const rets=plotRows.map(r=>r.ret), yMin=Math.min(0,...rets), yMax=Math.max(0,...rets);
  const p90=s.winnersMaeP90;
  const dsets=[
    {label:'wins',data:W.map(r=>({x:r.maePct,y:r.ret})),backgroundColor:'rgba(47,208,140,.55)',pointRadius:3},
    {label:'losses',data:L.map(r=>({x:r.maePct,y:r.ret})),backgroundColor:'rgba(240,97,109,.55)',pointRadius:3}];
  if(p90!=null)dsets.push({label:'p90',type:'line',data:[{x:p90,y:yMin},{x:p90,y:yMax}],
    borderColor:'rgba(230,180,80,.7)',borderWidth:1.4,borderDash:[5,4],pointRadius:0,fill:false});
  _diagCharts.exc=new Chart($('excScatter'),{type:'scatter',data:{datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},
      tooltip:{filter:i=>i.dataset.label!=='p90',
        callbacks:{label:ctx=>' dipped '+ctx.parsed.x.toFixed(2)+'% → ended '+(ctx.parsed.y>=0?'+':'')+ctx.parsed.y.toFixed(2)+'%'}}},
      scales:scales({title:{display:true,text:'worst dip during the trade (% of entry)',color:'#8b93a7',font:{size:11}}}),
      interaction:{intersect:false,mode:'nearest'}}});
}
// Re-run on demand: closed trades reload from saved measurements (fast); open positions
// get a fresh entry-to-now measurement — the monitor no longer goes stale while a
// position's window keeps growing.
async function rerunExcursions(){
  const closed=_excCache.closedRef; if(!closed)return;
  const btn=$('excRerun'); if(btn){ btn.disabled=true; btn.textContent='Updating…'; }
  try{
    const openT=allTrades.filter(t=>t.isOpen&&viewFilter(t));
    const out=await runExcursions(closed,openT);
    _excCache={..._excCache,...out};
    for(const r of out.rows)_excM[r.id]=r;
    // open-position measurements are tagged: once the trade closes, the stale entry-to-
    // earlier-now window must not feed the miner's exc families until the ratchet re-measures
    for(const r of (out.openRows||[]))_excM[r.id]={...r,openMeas:true};
    renderExcResults(_excCache);
    setStatus('Excursions updated'+(out.openRows&&out.openRows.length?' · '+out.openRows.length+' open position'+(out.openRows.length===1?'':'s')+' re-measured':' · no open positions in this view')+'.');
  }catch(e){ setStatus('Excursion update stopped: '+e.message);
    const b=$('excRerun'); if(b){ b.disabled=false; b.textContent='Update open positions'; } }
}
function wireExcursions(closed){
  const box=$('excBox'); if(!box)return;
  const key=[view,period,customRange.from,customRange.to,closed.length,dexView].join('|'); // dex filter can change the universe at identical length
  if(_excCache.key===key&&_excCache.rows){ renderExcResults(_excCache); return; }
  const btn=$('runExc'); if(!btn)return;
  btn.onclick=async()=>{ btn.disabled=true; btn.textContent='Fetching candles…';
    try{ const openT=allTrades.filter(t=>t.isOpen&&viewFilter(t));
      const out=await runExcursions(closed,openT);
      _excCache={key,...out,closedRef:closed}; // closedRef powers the update-open-positions re-run
      for(const r of out.rows)_excM[r.id]=r;
    // open-position measurements are tagged: once the trade closes, the stale entry-to-
    // earlier-now window must not feed the miner's exc families until the ratchet re-measures
    for(const r of (out.openRows||[]))_excM[r.id]={...r,openMeas:true};
      // fresh excursion data unlocks new miner families — invalidate any cached scan
      _minerCache={key:null,res:null,deep:null};
      const rb=$('runMiner'); if(rb){ rb.disabled=false; rb.textContent='Run pattern miner + deep scan'; }
      renderExcResults(_excCache);
      renderTable(); // journal rows now show per-trade MAE/MFE
      setStatus(`Excursions computed for ${out.rows.length} trade${out.rows.length===1?'':'s'}${out.openRows&&out.openRows.length?' + '+out.openRows.length+' open':''}${out.skippedN?' · '+out.skippedN+' skipped (no candles)':''}.`);
    }catch(e){ box.innerHTML='<p class="lead">Excursion scan stopped: '+esc(e.message)+'</p>'
      +'<button class="btn ghost" id="runExc">Retry</button>'; wireExcursions(closed); setStatus(''); } };
}

/* ============================ trade replay (per-trade candle chart) ============================ */
let _replayChart=null,_replayFor=null;
// open price for candle i: the stored open when the cache row has one (5-element rows, new fetches),
// else the previous candle's close (a perp trades continuously, so prev close IS the open),
// else its own close/midpoint. Old 4-element cache rows are handled honestly, never fabricated flat.
function candleOpen(candles,i){ const k=candles[i];
  if(isFinite(k[4]))return k[4];
  if(i>0&&isFinite(candles[i-1][3]))return candles[i-1][3];
  return isFinite(k[3])?k[3]:(k[1]+k[2])/2; }
async function ensureTradeCandles(t){
  // fetch (cache-aware) candles for one trade's window, falling back coarser like the main scan
  const now=Date.now();
  for(let pass=0;pass<3;pass++){
    const itv=chooseItv(t,now,pass), k=excKey(t.coin,itv.name,candleVenue(t));
    let cache=null; try{ cache=await idbGet('cnd:'+k); }catch(e){}
    if(!cache||cache.v!==1||!Array.isArray(cache.candles)||!Array.isArray(cache.ranges))cache={v:1,candles:[],ranges:[]};
    const want=[t.openTime-itv.ms,(t.isOpen?now:t.closeTime)+itv.ms];
    for(const u of uncoveredRanges(want,cache.ranges)){
      if(u[1]-u[0]<=itv.ms)continue;
      try{ const c=await venueFetchCandles(candleVenue(t),t.coin,itv.name,u[0],u[1]);
        cache.candles=mergeCandles(cache.candles,c.rows);
        if(c.coveredTo>u[0]) cache.ranges=mergeRanges([...cache.ranges,[u[0],c.coveredTo]],1);
      }catch(e){ return null; }
    }
    try{ await idbSet('cnd:'+k,cache); }catch(e){}
    const a=t.openTime-itv.ms, b=(t.isOpen?now:t.closeTime)+itv.ms;
    const win=cache.candles.filter(c=>c[0]>=a&&c[0]<=b);
    if(win.length)return {candles:win,itv};
  }
  return null;
}
// The adverse and favorable extremes between entry and exit (or now, for an open trade),
// located on the candle that printed them — the MAE/MFE made visible. Pure.
function replayExtremes(t,candles,ms){
  const e=t.avgEntry; if(!(e>0)||!candles||!candles.length)return null;
  const a=t.openTime, b=t.isOpen?Infinity:t.closeTime, short=t.dir==='Short';
  let hi=null, lo=null;
  for(const c of candles){ if(c[0]+ms<=a||c[0]>=b)continue;
    if(isFinite(c[1])&&(!hi||c[1]>hi.y))hi={x:c[0],y:c[1]};
    if(isFinite(c[2])&&(!lo||c[2]<lo.y))lo={x:c[0],y:c[2]}; }
  if(!hi||!lo)return null;
  const w=short?hi:lo, bst=short?lo:hi;
  const pct=y=>(short?(e-y):(y-e))/e*100;
  return {worst:pct(w.y)<0?{...w,kind:'worst',pct:pct(w.y)}:null, best:pct(bst.y)>0?{...bst,kind:'best',pct:pct(bst.y)}:null};
}
async function openReplay(id,btn){
  const box=document.getElementById('replay-'+id); if(!box)return;
  if(_replayFor===id&&_replayChart){ clearInterval(_replayTimer); _replayChart.destroy(); _replayChart=null; _replayFor=null; box.innerHTML=''; return; }
  const t=allTrades.find(x=>x.id===id); if(!t){ box.innerHTML='<p class="lead">Trade not found.</p>'; return; }
  if(btn)btn.textContent='Loading candles…';
  const got=await ensureTradeCandles(t);
  if(btn)btn.textContent='📈 Price chart';
  if(!got){ box.innerHTML='<p class="lead" style="font-size:12px">No candles available for this trade (coin unsupported or beyond retention).</p>'; return; }
  const {candles,itv}=got;
  const closeT=t.isOpen?Date.now():t.closeTime;
  // candlesticks as two overlaid floating-bar datasets (thin wick low..high, thick body open..close),
  // per-candle up/down colors; open derived via candleOpen so pre-open cache rows still render.
  const wick=[],wickBg=[],body=[],bodyBg=[],meta=[];
  for(let i=0;i<candles.length;i++){ const k=candles[i];
    const o=candleOpen(candles,i), c=isFinite(k[3])?k[3]:(k[1]+k[2])/2, up=c>=o;
    const a=up?'rgba(47,208,140,':'rgba(244,88,106,';
    wick.push({x:k[0],y:[k[2],k[1]]}); wickBg.push(a+'.85)');
    body.push({x:k[0],y:[Math.min(o,c),Math.max(o,c)]}); bodyBg.push(a+(up?'.8)':'.85)'));
    meta.push({o,c}); }
  // price range from the candles + avg lines first — marker flag offsets are sized from it.
  let plo=Infinity,phi=-Infinity;
  for(const k of candles){ if(isFinite(k[2])&&k[2]<plo)plo=k[2]; if(isFinite(k[1])&&k[1]>phi)phi=k[1]; }
  if(isFinite(t.avgEntry)&&t.avgEntry>0){ plo=Math.min(plo,t.avgEntry); phi=Math.max(phi,t.avgEntry); }
  if(!t.isOpen&&t.avgExit>0){ plo=Math.min(plo,t.avgExit); phi=Math.max(phi,t.avgExit); }
  // the written plan (stop / target) and the trade's own worst / best prices while it was on
  const plan=coachOn()?nfPlan(journal[t.id]):null;
  const ex=coachOn()?replayExtremes(t,candles,itv.ms):null;
  if(plan){ for(const v of [plan.stop,plan.target]) if(v>0){ plo=Math.min(plo,v); phi=Math.max(phi,v); } }
  // fill markers: every entry/add (gold triangle up) and every partial/final close (green triangle
  // down). Drawn as flags UNDER (entry/add) or OVER (close) the candle that holds the fill — never
  // at the raw fill price, which buries the marker inside the candle body. Several fills on the
  // same side of one candle stack outward. The exact fill price/size/time lives in the hover.
  const evs=(t.events||[]).filter(e=>e[0]>=t.openTime-itv.ms&&e[0]<=closeT+itv.ms);
  const cIdx=ts=>{ let lo=0,hi=candles.length-1,best=0;
    while(lo<=hi){ const m=(lo+hi)>>1; if(candles[m][0]<=ts){best=m;lo=m+1;} else hi=m-1; } return best; };
  const off=(phi-plo)*0.045||Math.abs(phi)*0.002||1;
  const stacked={};
  const marks=evs.map((e,i)=>{ const ci=cIdx(e[0]), k=candles[ci], key=ci+':'+(e[3]>0?'b':'s');
    const n=stacked[key]=(stacked[key]||0)+1;
    const y=e[3]>0 ? (isFinite(k[2])?k[2]:e[1])-off*(0.6+0.9*n)
                   : (isFinite(k[1])?k[1]:e[1])+off*(0.6+0.9*n);
    return {x:k[0],y,px:e[1],k:e[3],sz:e[2],
      lbl:e[3]>0?(i===0?'entry':'add'):((!t.isOpen&&i===evs.length-1)?'exit':'partial close')}; });
  const xmin=candles[0][0]-itv.ms/2, xmax=candles[candles.length-1][0]+itv.ms/2;
  // bar datasets default the value axis to beginAtZero, which squashes a tight price range
  // against 0 — pin the y range to the actual extremes (candles + marker flags + avg lines).
  let ylo=plo,yhi=phi;
  for(const m of marks){ if(m.y<ylo)ylo=m.y; if(m.y>yhi)yhi=m.y; }
  const ypad=(yhi-ylo)*0.06||Math.abs(yhi)*0.002||1; ylo-=ypad; yhi+=ypad;
  const hline=(y,color,dash)=>({type:'line',data:[{x:xmin,y},{x:xmax,y}],borderColor:color,borderWidth:1.2,borderDash:dash,pointRadius:0,fill:false});
  const dsets=[
    {type:'bar',data:wick,backgroundColor:wickBg,grouped:false,barThickness:1,borderWidth:0,minBarLength:1,order:4},
    {type:'bar',data:body,backgroundColor:bodyBg,grouped:false,barPercentage:0.82,categoryPercentage:1,maxBarThickness:14,borderWidth:0,minBarLength:2,order:3},
    hline(t.avgEntry,'rgba(230,180,80,.8)',[4,3]),
  ];
  const XDS=!t.isOpen&&t.avgExit>0?dsets.length:-1; // the avg-exit line: hidden while replaying, until the close
  if(!t.isOpen&&t.avgExit>0)dsets.push(hline(t.avgExit,'rgba(47,208,140,.8)',[4,3]));
  if(plan&&plan.stop>0)dsets.push(hline(plan.stop,'rgba(244,88,106,.9)',[2,3]));
  if(plan&&plan.target>0)dsets.push(hline(plan.target,'rgba(47,208,140,.95)',[2,3]));
  const EDS=ex?dsets.length:-1;
  if(ex)dsets.push({type:'scatter',order:2,data:[ex.worst,ex.best].filter(Boolean),
    pointStyle:'crossRot',pointRadius:7,pointHoverRadius:8,borderWidth:2,
    borderColor:[ex.worst,ex.best].filter(Boolean).map(p=>p.kind==='worst'?'rgba(244,88,106,1)':'rgba(47,208,140,1)')});
  const MDS=dsets.length;
  if(marks.length)dsets.push({type:'scatter',data:marks,order:1,
    pointStyle:'triangle',rotation:marks.map(m=>m.k>0?0:180),
    pointRadius:6,pointHoverRadius:7,borderColor:'rgba(10,14,24,.9)',borderWidth:1,
    backgroundColor:marks.map(m=>m.k>0?'rgba(230,180,80,.95)':'rgba(47,208,140,.95)')});
  box.innerHTML='<div class="chart-box" style="height:260px;margin:8px 0"><canvas id="rp-'+id.replace(/[^a-zA-Z0-9_-]/g,'_')+'"></canvas></div>'
    +'<p class="lead" style="font-size:11.5px;color:var(--faint);margin:2px 0 8px">'+itv.name+' candles · \u25b2 = entry / add fill · \u25bc = close fill · gold dash = avg entry'+(!t.isOpen&&t.avgExit>0?' · green dash = avg exit':'')
    +(plan&&plan.stop>0?' · red dots = planned stop':'')+(plan&&plan.target>0?' · green dots = planned target':'')
    +(ex?' · \u2715 = worst / best price while the trade was on':'')+' · hover a candle for OHLC, a marker for the fill</p>'
    +(ex&&plan&&plan.stop>0&&ex.worst&&(t.dir==='Short'?ex.worst.y>plan.stop:ex.worst.y<plan.stop)?'<p class="lead" style="font-size:12px;margin:0 0 8px;border-left:2px solid var(--loss);padding-left:8px">Price traded through your planned stop (worst '+ex.worst.y.toLocaleString(undefined,{maximumFractionDigits:6})+' vs stop '+plan.stop.toLocaleString(undefined,{maximumFractionDigits:6})+') and the position stayed open.</p>':'');
  const cv=box.querySelector('canvas');
  if(_replayChart)_replayChart.destroy();
  _replayFor=id;
  const fpx=v=>{const a=Math.abs(v);return v.toLocaleString(undefined,{maximumFractionDigits:a>=1000?2:a>=1?4:6});};
  const szf=v=>v.toLocaleString(undefined,{maximumFractionDigits:6});
  _replayChart=new Chart(cv,{data:{datasets:dsets},options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{
      filter:i=>i.datasetIndex===1||(marks.length&&i.datasetIndex===MDS)||i.datasetIndex===EDS,
      callbacks:{title:()=>'',label:c=>{
        if(c.datasetIndex===EDS){ const p=c.raw;
          return ' '+(p.kind==='worst'?'worst':'best')+' price while on: '+fpx(p.y)+' ('+(p.pct>=0?'+':'')+p.pct.toFixed(2)+'% vs avg entry) · '+new Date(p.x).toLocaleString(); }
        if(marks.length&&c.datasetIndex===MDS){ const m=c.raw;
          return ' '+m.lbl+' · '+szf(m.sz)+' @ '+fpx(m.px)+' · '+new Date(m.x).toLocaleString(); }
        const i=c.dataIndex,k=candles[i],m=meta[i];
        const chg=m.o>0?(m.c/m.o-1)*100:null;
        return [' '+new Date(k[0]).toLocaleString(),
          ' O '+fpx(m.o)+'  H '+fpx(k[1])+'  L '+fpx(k[2])+'  C '+fpx(m.c)+(chg!=null?'  ('+(chg>=0?'+':'')+chg.toFixed(2)+'%)':'')];
      }}}},
    scales:{x:{type:'linear',min:xmin,max:xmax,grid:{color:GRID,drawTicks:false},border:{display:false},
      ticks:{maxTicksLimit:7,callback:v=>{const d=new Date(v);return (closeT-t.openTime>3*86400e3)?(d.getMonth()+1)+'/'+d.getDate():d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');}}},
      y:{min:ylo,max:yhi,beginAtZero:false,grid:{color:GRID,drawTicks:false},border:{display:false},
        ticks:{callback:v=>{const a=Math.abs(v);return v.toLocaleString(undefined,{maximumFractionDigits:a>=1000?2:a>=1?4:6});}}}},
    interaction:{intersect:false,mode:'nearest'}}});
  replayWire(box,t,{candles,wick,wickBg,body,bodyBg,marks,EDS,MDS,XDS,cIdx,fpx});
}

/* ---- bar-by-bar replay: watch the trade unfold the way you lived it ---- */
// The chart above, played forward one candle at a time from a few bars before the entry:
// fills appear as they happened, the exit line and the worst/best marks only at the end, and
// a readout shows the position and its P&L at each bar (gross, before fees). The journal note
// sits underneath, so the replay is a review: what did you know, and what did you do?
let _replayTimer=null;
// Pure. Position and P&L at time ts with the bar's close at `price`, from the trade's fill
// events [time, px, size, +1 add | -1 reduce]: running average entry, realized on reductions.
function replayPnlAt(dir, events, ts, price){
  const sgn=dir==='Short'?-1:1; let pos=0, avg=0, realized=0;
  for(const e of events||[]){ if(e[0]>ts)break; const px=e[1], sz=e[2];
    if(e[3]>0){ avg=pos+sz>0?(avg*pos+px*sz)/(pos+sz):px; pos+=sz; }
    else { const q=Math.min(sz,pos); realized+=(px-avg)*q*sgn; pos-=q; if(pos<=1e-12){ pos=0; } } }
  const open=pos>0&&isFinite(price)?(price-avg)*pos*sgn:0;
  return {pos,avg:pos>0?avg:null,realized,open,total:realized+open};
}
function replayWire(box,t,S){
  clearInterval(_replayTimer); _replayTimer=null;
  const ch=_replayChart, n=S.candles.length;
  const start=Math.max(0,S.cIdx(t.openTime)-5), end=n-1;
  let k=end, speed=1;
  const evs=[...(t.events||[])].sort((a,b)=>a[0]-b[0]);
  const risk=typeof riskFor==='function'?riskFor(t):null;
  const j=journal[t.id]||{};
  const ctl=document.createElement('div'); ctl.className='rpctl';
  ctl.innerHTML=`<div class="rprow" role="group" aria-label="Replay">
      <button type="button" class="btn ghost" data-rp="start" title="Back to before the entry" aria-label="Back to before the entry">⏮</button>
      <button type="button" class="btn ghost" data-rp="back" title="One bar back" aria-label="One bar back">◀</button>
      <button type="button" class="btn" data-rp="play" aria-label="Play">▶ Replay</button>
      <button type="button" class="btn ghost" data-rp="fwd" title="One bar forward" aria-label="One bar forward">▶|</button>
      <input type="range" min="${start}" max="${end}" value="${end}" step="1" aria-label="Replay position">
      <select aria-label="Replay speed"><option value="1">1×</option><option value="3">3×</option><option value="8">8×</option></select>
      <button type="button" class="btn ghost" data-rp="attach" title="Save this chart, as it looks now, to the trade’s screenshots — then mark it up with ✎">📎 Attach chart</button></div>
    <div class="rpread" aria-live="polite"></div>
    ${j.notes?`<div class="rpnote"><b>Your note</b> ${esc(j.notes)}</div>`:''}`;
  box.appendChild(ctl);
  const slider=ctl.querySelector('input[type=range]'), read=ctl.querySelector('.rpread'), playBtn=ctl.querySelector('[data-rp="play"]');
  const show=i=>{ k=Math.max(start,Math.min(end,i)); slider.value=k;
    const D=ch.data.datasets, upTo=S.candles[k][0], done=k===end;
    D[0].data=S.wick.slice(0,k+1); D[0].backgroundColor=S.wickBg.slice(0,k+1);
    D[1].data=S.body.slice(0,k+1); D[1].backgroundColor=S.bodyBg.slice(0,k+1);
    if(S.marks.length&&D[S.MDS]){ const vis=S.marks.map((m,i)=>m.x<=upTo?i:-1).filter(i=>i>=0);
      D[S.MDS].data=vis.map(i=>S.marks[i]); D[S.MDS].rotation=vis.map(i=>S.marks[i].k>0?0:180);
      D[S.MDS].backgroundColor=vis.map(i=>S.marks[i].k>0?'rgba(230,180,80,.95)':'rgba(47,208,140,.95)'); }
    if(S.XDS>=0&&D[S.XDS])D[S.XDS].hidden=!done;
    if(S.EDS>=0&&D[S.EDS])D[S.EDS].hidden=!done;
    ch.update('none');
    const c=S.candles[k], px=isFinite(c[3])?c[3]:(c[1]+c[2])/2, barEnd=c[0]+(k+1<n?S.candles[k+1][0]-c[0]:0)-1;
    const p=replayPnlAt(t.dir,evs,barEnd,px);
    const r=risk>0?' ('+(p.total/risk>=0?'+':'')+(p.total/risk).toFixed(2)+'R)':'';
    read.innerHTML=`<span>${esc(new Date(c[0]).toLocaleString())}</span> · close ${esc(S.fpx(px))} · `
      +(p.pos>0?`holding ${esc(+p.pos.toPrecision(6)+'')} @ ${esc(S.fpx(p.avg))} · `:barEnd<t.openTime?'not in yet · ':'flat · ')
      +`P&L so far <b class="${cls(p.total)}">${esc(fmtUsd(p.total))}${esc(r)}</b> <span style="color:var(--faint)">gross, before fees</span>`;
  };
  const stop=()=>{ clearInterval(_replayTimer); _replayTimer=null; playBtn.textContent='▶ Replay'; playBtn.setAttribute('aria-label','Play'); };
  const play=()=>{ if(k>=end)show(start); playBtn.textContent='⏸ Pause'; playBtn.setAttribute('aria-label','Pause');
    _replayTimer=setInterval(()=>{ if(!document.body.contains(slider)||_replayChart!==ch){ stop(); return; } if(k>=end){ stop(); return; } show(k+1); },Math.round(450/speed)); };
  ctl.addEventListener('click',async e=>{ const b=e.target.closest('[data-rp]'); if(!b)return; const a=b.dataset.rp;
    if(a==='play'){ if(_replayTimer)stop(); else play(); return; }
    stop();
    if(a==='start')show(start); else if(a==='back')show(k-1); else if(a==='fwd')show(k+1);
    else if(a==='attach'){ try{
        const src=ch.canvas, out=document.createElement('canvas'); out.width=src.width; out.height=src.height;
        const x=out.getContext('2d'); x.fillStyle=getComputedStyle(document.body).getPropertyValue('--panel').trim()||'#0d1117'; x.fillRect(0,0,out.width,out.height); x.drawImage(src,0,0);
        const arr=(await idbGet('att:'+t.id))||[]; if(arr.length>=12){ setErr('Max 12 images per trade — remove one first.'); return; }
        arr.push(out.toDataURL('image/jpeg',0.85)); await idbSet('att:'+t.id,arr); loadAttachments(t.id); syncAttUp(t.id);
        b.textContent='📎 Attached'; setTimeout(()=>{ b.textContent='📎 Attach chart'; },1500);
      }catch(err){ setErr('Couldn’t attach the chart: '+err.message); } }
  });
  slider.addEventListener('input',()=>{ stop(); show(+slider.value); });
  ctl.querySelector('select').addEventListener('change',e=>{ speed=+e.target.value||1; if(_replayTimer){ stop(); play(); } });
  show(end);
}

/* ============================ benchmark: you vs buy-and-hold ============================ */
let _diagMC={key:null}; // memoized Monte Carlo results for renderDiagnostic (see mcKey there)
let _benchToken=0; // stale-render guard: only the latest benchmark run may draw (the miner has the same guard)
async function renderBenchmark(closed){
  const el=$('diagBench'); if(!el||closed.length<5)return;
  const tok=++_benchToken;
  try{
    const t0=Math.min(...closed.map(t=>t.openTime)), t1=Math.max(...closed.map(t=>t.closeTime));
    if(!(t1>t0))return;
    const series={};
    for(const coin of ['BTC','HYPE']){
      const k=excKey(coin,'1d');
      let cache=null; try{ cache=await idbGet('cnd:'+k); }catch(e){}
      if(!cache||cache.v!==1||!Array.isArray(cache.candles)||!Array.isArray(cache.ranges))cache={v:1,candles:[],ranges:[]};
      const want=[t0-86400e3,t1+86400e3];
      for(const u of uncoveredRanges(want,cache.ranges)){
        if(u[1]-u[0]<=86400e3)continue;
        try{ const c=await fetchCandles(coin,'1d',u[0],u[1]);
          cache.candles=mergeCandles(cache.candles,c.rows);
          if(c.coveredTo>u[0]) cache.ranges=mergeRanges([...cache.ranges,[u[0],c.coveredTo]],1); }catch(e){}
      }
      try{ await idbSet('cnd:'+k,cache); }catch(e){}
      const win=cache.candles.filter(c=>c[0]>=t0-86400e3&&c[0]<=t1+86400e3);
      if(win.length>=2)series[coin]=win;
    }
    // a Diagnostic re-render during the awaited candle fetches replaced this card's canvas —
    // drawing now would paint a detached element and destroy the newer run's chart
    if(tok!==_benchToken||!el.isConnected)return;
    if(!Object.keys(series).length)return;
    // your line: cumulative net as % of average deployed notional — a stated approximation
    const avgNotional=_avg(closed.map(t=>(t.maxSize||0)*(t.avgEntry||0)).filter(x=>x>0));
    if(!(avgNotional>0))return;
    const byClose=[...closed].sort((a,b)=>a.closeTime-b.closeTime);
    let cum=0; const mine=byClose.map(t=>{ cum+=t.net; return {x:t.closeTime,y:cum/avgNotional*100}; });
    mine.unshift({x:t0,y:0});
    const px=c=>isFinite(c[3])?c[3]:(c[1]+c[2])/2;
    const colors={BTC:'rgba(230,180,80,.85)',HYPE:'rgba(47,208,140,.85)'};
    const dsets=Object.entries(series).map(([coin,win])=>{ const base=px(win[0]);
      return {label:coin+' hold',data:win.map(c=>({x:c[0],y:(px(c)/base-1)*100})),
        borderColor:colors[coin],borderWidth:1.3,pointRadius:0,fill:false,tension:0}; });
    dsets.push({label:'you',data:mine,borderColor:'rgba(139,147,255,.95)',borderWidth:1.8,pointRadius:0,fill:false,stepped:true});
    const card=el.closest('.diag-card'); if(card)card.classList.remove('hide');
    if(_diagCharts.bench)_diagCharts.bench.destroy();
    _diagCharts.bench=new Chart(el,{type:'line',data:{datasets:dsets},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,labels:{color:TXT,boxWidth:10,font:{size:11}}},
        tooltip:{callbacks:{label:c=>' '+c.dataset.label+' '+(c.parsed.y>=0?'+':'')+c.parsed.y.toFixed(1)+'%'}}},
      scales:{x:{type:'linear',grid:{color:GRID,drawTicks:false},border:{display:false},
        ticks:{maxTicksLimit:8,callback:v=>{const d=new Date(v);return (d.getMonth()+1)+'/'+d.getDate();}}},
        y:{grid:{color:GRID,drawTicks:false},border:{display:false},ticks:{callback:v=>v+'%'}}},
      interaction:{intersect:false,mode:'nearest'}}});
  }catch(e){ /* benchmark is a bonus — never break the diagnostic over it */ }
}

/* ============================ auto-refresh + automatic MAE/MFE ratchet ============================ */
let _loading=false,_excBusy=false;
const _ratchetTried=new Set(); // attempted this session but unmeasurable (no candles / retention) — don't replan + refetch them on every 3-minute auto-refresh
async function autoRatchet(){
  // silently lock in precise MAE/MFE for recently closed trades after each data load —
  // the ratchet then maintains itself without ever pressing the excursions button
  if(_excBusy)return; _excBusy=true;
  try{
    const now=Date.now();
    let persisted=null; try{ persisted=await idbGet('excRows'); }catch(e){}
    const have=(persisted&&persisted.v===1&&persisted.rows)||{};
    const recent=allTrades.filter(t=>!t.isOpen&&t.avgEntry>0&&(t.maxSize||0)*(t.avgEntry||0)>0
      &&t.closeTime>now-21*86400e3&&!have[t.id]&&!_ratchetTried.has(t.id));
    if(!recent.length)return;
    // the newest 25 per run: the rest follow on the next refresh instead of queueing a hundred candle requests at start
    recent.sort((a,b)=>b.closeTime-a.closeTime); recent.length=Math.min(recent.length,25);
    setStatus('Locking in MAE/MFE for '+recent.length+' recent trade'+(recent.length===1?'':'s')+'…',true);
    const out=await runExcursions(recent,[]);
    const got=new Set(out.rows.map(r=>r.id));
    for(const t of recent)if(!got.has(t.id))_ratchetTried.add(t.id);
    for(const r of out.rows)_excM[r.id]=r;
    schedulePersist();
    setStatus('MAE/MFE locked in for '+out.rows.length+' recent trade'+(out.rows.length===1?'':'s')+'.');
  }catch(e){ /* budget guard or transient — the manual button still works */ }
  finally{ _excBusy=false; }
}
let _autoTimer=null;
function setupAutoRefresh(){
  if(_autoTimer)clearInterval(_autoTimer);
  const btn=$('autoBtn');
  const on=settings.autoRefresh!==false;
  if(btn){ btn.textContent='⟳ auto: '+(on?'on':'off'); btn.classList.toggle('on',on);
    btn.onclick=()=>{ settings.autoRefresh=!(settings.autoRefresh!==false); Store.set(S_KEY,settings); setupAutoRefresh(); }; }
  if(!on)return;
  _autoTimer=setInterval(()=>{
    if(document.visibilityState!=='visible')return;
    if(_loading||!settings.wallets.length)return;
    loadAll({auto:true});
  },180000);
}

let _minerCache={key:null,res:null,deep:null};
let _minerToken=0; // stale-render guard: only the latest scan paints the panel
function renderMinerResults(r,deep,basis){ basis=basis||'usd';
  const fmtA = basis==='pct' ? (n=>(n>=0?'+':'')+n.toFixed(2)+'%') : (n=>fmtUsd(n));
  const unitT = basis==='pct' ? '%-points' : '';
  const box=$('minerBox'); if(!box)return;
  if(!r){ box.innerHTML='<p class="lead">Needs ≥30 completed trades.</p>'; return; }
  const li=(cls,mk,txt)=>`<li class="${cls}"><span class="mk">${mk}</span><span>${txt}</span></li>`;
  const ciTag=v=> v.ci ? ` · 95% CI ${fmtA(v.ci.lo)} to ${fmtA(v.ci.hi)} per trade` : '';
  const oosTag=v=>{
    if(!r.split) return ' <span class="badge mid" data-tip="Not enough trades (need \u226560) to hold out a validation slice, so this is in-sample only. Confirm forward before sizing on it.">in-sample only</span>';
    if(v.oosN==null||v.oosN<5) return ` <span class="badge mid" data-tip="Too few matching trades in the held-out window to judge out-of-sample.">only ${v.oosN||0} held-out</span>`;
    return v.holds
      ? ` <span class="badge ok" data-tip="The edge kept the same direction on the most recent trades — data it was NOT discovered on. This is the difference between a real pattern and a lucky slice.">holds out-of-sample \u00b7 ${fmtA(v.oosExp)}/trade on ${v.oosN} held-out</span>`
      : ` <span class="badge no" data-tip="On the held-out recent trades the edge flipped or vanished. Very likely an in-sample artifact \u2014 do not size on it.">fails out-of-sample \u00b7 ${fmtA(v.oosExp)}/trade on ${v.oosN} held-out</span>`;
  };
  const row=v=>{ const good=v.uplift>=0;
    const upliftTxt=(v.uplift>=0?'+':'')+(basis==='pct'?v.uplift.toFixed(1)+' '+unitT:fmtUsd(v.uplift));
    const lossTxt=basis==='pct'?Math.abs(v.uplift).toFixed(1)+' '+unitT:fmtUsd(Math.abs(v.uplift));
    const sent=good
      ? `${v.n} trades averaging <b>${fmtA(v.exp)}</b> each, vs ${fmtA(r.mAll)} across all your trades — roughly <b>${upliftTxt}</b> of your ${basis==='pct'?'cumulative return':'PnL'} traces to this pattern.`
      : `${v.n} trades averaging <b>${fmtA(v.exp)}</b> each, vs ${fmtA(r.mAll)} across all your trades — this pattern cost you roughly <b>${lossTxt}</b> ${basis==='pct'?'of cumulative return':''} vs trading at your baseline.`;
    const stats=`<span style="color:var(--faint);font-size:11px" data-tip="p is the chance of a gap this large appearing by pure luck (permutation test) — lower means more likely real. The CI is the plausible range for the true per-trade average.">p=${v.p<0.001?'<0.001':v.p.toFixed(3)}${ciTag(v)}</span>`;
    return li(good?'good':'bad',good?'▲':'▼',
      `<b>${esc(v.name)}</b>${oosTag(v)}${pinCtl(v)}${ruleCtl(v)}<br>${sent}<br>${stats}`); };
  const byPid={};
  const ruleCtl=v=>{ if(!v.pid||v.uplift>=0||!coachOn())return'';
    return customRules().some(r=>r.pid===v.pid)?' <span class="sr-note" style="margin-left:6px">rule \u2713</span>'
      :` <button class="btn ghost rulebtn" data-pid="${esc(v.pid)}" data-tip="Turn this leak into a personal rule: every trade that matches it is counted as a break with its dollar cost, open positions that match get a warning chip (when the condition is known at entry), and the rules card tracks whether you break it less from today on." style="font-size:10px;padding:1px 7px;margin-left:6px">+ rule</button>`; };
  const pinCtl=v=>{ if(!v.pid)return''; byPid[v.pid]=v;
    const already=pinsList().some(p=>p.pid===v.pid&&p.basis===basis);
    return already?' <span class="sr-note" style="margin-left:6px">tracking \u2713</span>'
      :` <button class="btn ghost pinbtn" data-pid="${esc(v.pid)}" data-tip="Pin this pattern to track it forward: every trade you close from now on that matches this condition gets measured against the discovered edge \u2014 a rolling out-of-sample test in the Tracked patterns card above." style="font-size:10px;padding:1px 7px;margin-left:6px">\ud83d\udccc track forward</button>`; };
  const vHtml=r.validated.length?r.validated.map(row).join(''):li('warn','·','No pattern here is statistically distinguishable from luck yet — after accounting for how many combinations were scanned, every apparent hot or cold pocket is within what chance alone would produce. That itself is useful to know.');
  const sHtml=r.suggestive.length?r.suggestive.map(row).join(''):'';

  let statesHtml='', cpHtml='', szHtml='', ideas=[];
  if(deep&&deep.states){
    const rows=deep.states.filter(x=>!x.skip);
    statesHtml=rows.map(x=>{
      const tag=x.sig?(x.delta<0?'<span class="badge no">drain</span>':'<span class="badge ok">boost</span>'):'<span class="sr-note">no clear effect</span>';
      const d=basis==='pct'
        ? (x.delta>=0?'+':'\u2212')+Math.abs(x.delta).toFixed(2)+' pts'
        : (x.delta>=0?'+':'\u2212')+fmtUsd(Math.abs(x.delta));
      return `<div class="state-row" data-tip="Expectancy of trades entered in this state vs your overall average, in the selected basis. p from a two-sample test vs all other trades; significance is Benjamini–Hochberg FDR-controlled across every state tested, so 'boost'/'drain' isn't just the best of many coin-flips. 'no clear effect' = not distinguishable from your average."><div class="sr-top"><span class="sr-name">${esc(x.name)}</span>${tag}</div><div class="sr-sub">${x.n} trades · averaged <b>${fmtA(x.exp)}</b> per trade · ${d} vs your baseline</div></div>`;
    }).join('')||'<p class="lead">Too few trades per state.</p>';
    const _thr=basis==='pct'?5:100;
    for(const x of rows){
      if(x.sig&&x.delta<0&&x.impact<-_thr) ideas.push({w:(basis==='pct'?40:1)*-x.impact,txt:`<b>${esc(x.name)}</b>: ${x.n} trades averaging ${fmtA(x.exp)} — ${fmtA(Math.abs(x.delta)).replace('+','')}/trade below your baseline. Cutting or halving these ≈ <b>${basis==='pct'?fmtA(-x.impact).replace('+','')+' cumulative':fmtUsd(-x.impact)}</b> over this sample. A hard rule (cooldown, daily cap) beats willpower.`});
      if(x.sig&&x.delta>0&&x.impact>_thr) ideas.push({w:(basis==='pct'?40:1)*x.impact,txt:`<b>${esc(x.name)}</b> is a genuine boost: ${fmtA(x.delta)}/trade over baseline across ${x.n} trades. Lean in when this state holds.`});
    }
  }
  if(deep&&deep.cp){
    const c=deep.cp; const dir=c.after.exp>=c.before.exp?'improved':'deteriorated';
    cpHtml=c.sig
      ? `<p class="lead">Strongest break in your expectancy sequence: <b>${fmtDate(c.at)}</b> (trade ${c.k} of ${c.before.n+c.after.n}) — ${fmtA(c.before.exp)}/trade before → <b>${fmtA(c.after.exp)}/trade</b> after (p=${c.p<0.001?'<0.001':c.p.toFixed(3)}). Your edge <b>${dir}</b> around that date; think back to what changed — size, markets, process — and ${dir==='improved'?'protect it':'undo it'}.</p>`
      : `<p class="lead">No statistically significant regime change (p=${c.p.toFixed(2)}) — your per-trade expectancy is consistent across the whole sequence. Stability is a feature.</p>`;
    if(c.series&&c.series.length>2) cpHtml+=`<div style="height:130px;margin-top:10px"><canvas id="regimeSpark"></canvas></div><p class="lead" style="font-size:11px;color:var(--faint);margin-top:4px">Rolling ${c.win}-trade expectancy over your sequence${c.sig?' — the gold dashed line marks the detected break':''}.</p>`;
    if(c.sig&&c.after.exp<c.before.exp) ideas.push({w:(basis==='pct'?40:1)*(c.before.exp-c.after.exp)*c.after.n,txt:`Your expectancy <b>dropped around ${fmtDate(c.at)}</b> (${fmtA(c.before.exp)} → ${fmtA(c.after.exp)}/trade, significant). Review what changed then — this is the single highest-leverage question in your data.`});
  }
  if(deep&&deep.sz){
    const z=deep.sz;
    const szSub=z.sig?(z.rho<0?'your results get worse as your position size grows':'your results improve as your position size grows'):'size barely relates to outcome here';
    szHtml=`<div class="state-row" data-tip="Spearman rank correlation between position notional and %-return on notional, permutation-tested. Percent basis is deliberate: $ PnL scales mechanically with size, which fakes a correlation — % isolates whether your decision quality actually changes with size."><div class="sr-top"><span class="sr-name">Do bigger trades do better or worse?</span>${z.sig?(z.rho<0?'<span class="badge no">bigger = worse</span>':'<span class="badge ok">bigger = better</span>'):'<span class="sr-note">no dependence</span>'}</div><div class="sr-sub">${z.n} trades · ${szSub} (rank correlation \u03c1=${z.rho.toFixed(2)}, p=${z.p<0.001?'<0.001':z.p.toFixed(3)})</div></div>`;
    if(z.sig&&z.rho<-0.1) ideas.push({w:500,txt:`Outcome falls as size rises (ρ=${z.rho.toFixed(2)}, significant) — conviction sizing is miscalibrated. Cap size at your median notional until the correlation flattens.`});
  }
  let probHtml='';
  if(deep&&deep.prob){
    const P=deep.prob;
    const TAGTXT={ok:'edge',mid:'fragile',no:'loses'};
    const prow=(x)=>{ const ci=(x.lo*100).toFixed(0)+'\u2013'+(x.hi*100).toFixed(0)+'%';
      const ec=x.exp>0?'var(--profit)':x.exp<0?'var(--loss)':'var(--muted)';
      const nt=x.note?`<span style="color:var(--faint);font-weight:400"> \u00b7 ${x.note}</span>`:'';
      return `<div class="metric-row" data-tip="Split by money then reliability: an edge clears break-even AND its 95% Wilson win-rate floor sits above 50%; fragile is profitable but the floor dips under a coin flip (often just a small sample); loses is negative expectancy. One spine \u2014 sorted by %/trade. Every condition appears on exactly one side."><span class="ml"><span class="badge ${x.tone}">${TAGTXT[x.tone]}</span>${esc(x.name)} \u00b7 ${x.n} trades${nt}</span><span class="mv">${(x.wr*100).toFixed(0)}% <span style="color:var(--faint);font-weight:400">(${ci})</span> \u00b7 <span style="color:${ec}">${fmtA(x.exp)}/trade</span></span></div>`; };
    const emptyRow=(t)=>`<div class="metric-row"><span class="ml" style="color:var(--faint)">${t}</span></div>`;
    probHtml=`<div class="diag-grid" style="margin-top:14px">
      <div class="diag-card"><h3 data-tip="Conditions worth leaning into: positive expectancy in your selected basis AND a 95% Wilson win-rate floor above 50%, so a 4-for-4 fluke can't outrank a proven edge. Sorted by %/trade. Your overall decisive win rate is ${(P.overall.wr*100).toFixed(0)}% (${(P.overall.lo*100).toFixed(0)}\u2013${(P.overall.hi*100).toFixed(0)}%, n=${P.overall.n}).">Lean in \u00b7 your edges</h3>${P.best.length?P.best.map(prow).join(''):emptyRow('no confirmed edges yet')}</div>
      <div class="diag-card"><h3 data-tip="Ease off \u2014 leaks and fragile spots. Losing conditions (negative expectancy) first, then profitable-but-unconfirmed ones whose win-rate floor is under a coin flip. A high %/trade with a low floor is usually a small sample, not a clean edge \u2014 re-test before trusting it.">Ease off \u00b7 leaks &amp; fragile</h3>${P.worst.length?P.worst.map(prow).join(''):emptyRow('nothing dragging \u2014 clean run')}</div>
    </div>`;
    const topB=P.best[0], topW=P.worst[0];
    if(topB&&topB.state==='edge') ideas.push({w:400+topB.n,txt:`Your strongest edge is <b>${esc(topB.name)}</b>: ${fmtA(topB.exp)}/trade over ${topB.n} decisive trades, ${(topB.wr*100).toFixed(0)}% win (\u2265${(topB.lo*100).toFixed(0)}% at 95%). Lean in when this state holds.`});
    if(topW&&topW.state==='losing') ideas.push({w:380+topW.n,txt:`<b>${esc(topW.name)}</b> loses money: ${fmtA(topW.exp)}/trade over ${topW.n} decisive trades (${(topW.wr*100).toFixed(0)}% win). This is the one to cut or rework \u2014 not size down.`});
  }
  if(r.validated[0]){ const v=r.validated[0];
    const oos = !r.split ? ' (in-sample only — confirm forward)'
      : v.holds ? ' — and it held on held-out trades, which is the version worth acting on'
      : (v.oosN>=5 ? ' — but it FAILED out-of-sample, so treat it as noise until it re-proves itself' : ' (too few held-out trades to confirm yet)');
    const act = v.uplift>=0
      ? (r.split && v.holds ? 'Allocate more attention and size here.' : 'Promising, but confirm it forward before sizing up.')
      : (r.split && v.holds ? 'Stop taking these — the leak persists on fresh data.' : 'Stop or paper-trade these for a month to confirm before risking more.');
    ideas.push({w:(basis==='pct'?40:1)*Math.abs(v.uplift)*0.8*((r.split&&!v.holds&&v.oosN>=5)?0.3:1),txt:`${v.uplift>=0?'Best validated pattern':'Worst validated leak'}: <b>${esc(v.name)}</b> (${(v.uplift>=0?'+':'')+(basis==='pct'?v.uplift.toFixed(1)+' %-points cumulative':fmtUsd(v.uplift))}, FDR-controlled)${oos}. ${act}`}); }
  ideas.sort((a,b)=>b.w-a.w);
  // one-line top verdict: the single most actionable finding, or an honest null result
  let verdictHtml='';
  { const holders=r.validated.filter(v=>v.holds);
    const pool=holders.length?holders:r.validated;
    if(pool.length){ const v0=[...pool].sort((a,b)=>Math.abs(b.uplift)-Math.abs(a.uplift))[0];
      const amt=basis==='pct'?Math.abs(v0.uplift).toFixed(1)+' '+unitT:fmtUsd(Math.abs(v0.uplift));
      verdictHtml=`<p class="lead" style="font-size:13px;margin:0 0 12px;border-left:2px solid var(--${v0.uplift>=0?'profit':'loss'});padding-left:10px">${v0.uplift>=0?'Your clearest real edge':'Your clearest leak'}: <b>${esc(v0.name)}</b> \u2014 roughly <b>${amt}</b> of your ${basis==='pct'?'cumulative return':'PnL'} ${v0.uplift>=0?'traces to it':'drained into it'}${v0.holds?', and it held up on trades it was not discovered on':''}.</p>`; }
    else verdictHtml=`<p class="lead" style="font-size:13px;margin:0 0 12px;border-left:2px solid var(--line);padding-left:10px">No condition beats luck yet across ${r.tested} candidates \u2014 your hot and cold pockets are within what chance produces. Trade your process and re-scan as the sample grows.</p>`; }
  const ideasHtml=ideas.length?`
   <div class="diag-section" style="margin-top:22px">
     <h2>Actionable ideas <span style="font-size:11px;color:var(--faint);font-weight:400">ranked by dollar impact · in-sample</span></h2>
     <ol class="recs">${ideas.slice(0,6).map(i=>`<li>${i.txt}</li>`).join('')}</ol>
   </div>`:'';

  const splitNote = r.split
    ? `<p class="lead" style="margin:0 0 10px;font-size:11.5px">Discovered on your earlier <b>${r.discN}</b> trades, then re-tested on the <b>${r.holdN}</b> most recent (held out). The out-of-sample tag on each pattern is the important part — it's the difference between an edge and a lucky slice.</p>`
    : `<p class="lead" style="margin:0 0 10px;font-size:11.5px">In-sample only — need \u226560 trades to hold out a validation slice. Treat these as hypotheses to confirm forward.</p>`;
  box.innerHTML=`${verdictHtml}
    <div class="diag-grid">
      <div class="diag-card"><h3 data-tip="Survived the permutation test AND the false-discovery correction across all ${r.tested} candidates tested — discovered on an earlier slice and, where possible, re-tested on held-out recent trades. Correlated conditions can still be proxies for one cause.">Patterns that survived statistical testing <span style="font-size:11px;color:var(--faint);font-weight:400">FDR 10%</span></h3>${splitNote}<ul class="diag-list">${vHtml}</ul></div>
      <div class="diag-card"><h3 data-tip="Raw p ≤ 0.05 but did NOT survive correction for the ${r.tested} candidates scanned — with this many tests, some of these are expected to be flukes. Watch, don't act.">Hints only — could easily be flukes <span style="font-size:11px;color:var(--faint);font-weight:400">p \u2264 0.05, failed correction</span></h3><ul class="diag-list">${sHtml||li('warn','·','None.')}</ul></div>
    </div>
    <div class="diag-grid" style="margin-top:14px">
      <div class="diag-card"><h3 data-tip="Your expectancy conditioned on the psychological/temporal state you were in at entry — computed from entry-time truth only (trades closed before you entered).">How you were doing when you entered</h3>${statesHtml}${szHtml}</div>
      <div class="diag-card"><h3 data-tip="Binary-segmentation change-point detection with permutation significance: finds and dates the strongest break in your per-trade expectancy sequence — far sharper than an earlier/recent half-split.">Did your edge change at some point?</h3>${cpHtml}</div>
    </div>
    ${probHtml}
    ${ideasHtml}
    <p class="lead" style="margin-top:10px">How this works: ${r.tested} candidate conditions were scanned (single conditions plus cross-combinations, each needing ≥${r.minN} trades). Each was shuffle-tested ${r.perms} times to ask “could luck alone produce this gap?”, and because scanning many candidates guarantees a few flukes, results are corrected so no more than ~10% of what survives is expected to be a false alarm (Benjamini–Hochberg FDR). Behavioral states use only what you knew at entry time. Numbers are in your selected basis (${basis==='pct'?'% of notional — size-neutral':'dollars'}). Everything here shows correlation on past trades — treat patterns as hypotheses to trade deliberately and re-test, not guarantees.${r.seed?' Deterministic run (seed '+r.seed+'): the same trade selection always reproduces these exact numbers.':''}</p>`;
  // pin buttons -> forward tracker (re-render restores miner results from cache)
  box.querySelectorAll('.pinbtn').forEach(b=>{ b.onclick=async()=>{ const v=byPid[b.dataset.pid]; if(!v)return;
    b.disabled=true; b.textContent='pinned \u2713';
    await addPin(v,basis,r.famParams||null);
    renderDiagnostic(periodTrades(),periodTradesAll()); }; });
  box.querySelectorAll('.rulebtn').forEach(b=>{ b.onclick=async()=>{ const v=byPid[b.dataset.pid]; if(!v)return;
    b.disabled=true; b.textContent='rule \u2713';
    await addCustomRule({pid:v.pid,name:'Avoid: '+v.name,params:r.famParams||{}});
    renderGuardrails(); renderDiagnostic(periodTrades(),periodTradesAll()); }; });
  // rolling-expectancy sparkline with the change-point marked
  if(charts.regime){ try{charts.regime.destroy();}catch(e){} charts.regime=null; }
  if(deep&&deep.cp&&deep.cp.series&&$('regimeSpark')){
    const S=deep.cp.series; let cpX=null;
    if(deep.cp.sig){ cpX=S.findIndex(p=>p.i>=deep.cp.k); if(cpX<0)cpX=null; }
    const vline={id:'cpv',afterDatasetsDraw(ch){ if(ch.$cp==null)return;
      const x=ch.scales.x.getPixelForValue(ch.$cp), a=ch.chartArea, c=ch.ctx;
      c.save(); c.strokeStyle='#C9A85C'; c.setLineDash([4,3]); c.lineWidth=1;
      c.beginPath(); c.moveTo(x,a.top); c.lineTo(x,a.bottom); c.stroke(); c.restore(); }};
    const ch=new Chart($('regimeSpark'),{type:'line',plugins:[vline],
      data:{labels:S.map(p=>fmtDate(p.t)),datasets:[{data:S.map(p=>p.v),borderColor:'#8a7bd8',borderWidth:1.6,pointRadius:0,tension:.3,fill:false}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c2=>fmtA(c2.parsed.y)+'/trade (rolling '+deep.cp.win+')'}}},
        scales:{x:{ticks:{color:TXT,maxTicksLimit:4,maxRotation:0,font:{size:10}},grid:{display:false}},
                y:{ticks:{color:TXT,font:{size:10},callback:v=>fmtA(v)},grid:{color:GRID}}}}});
    ch.$cp=cpX; charts.regime=ch;
  }
}
