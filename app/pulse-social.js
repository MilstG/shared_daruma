// Ledger app · part 12 of 14: Pulse social (leagues, competitions, following) and accounts (wallet claims, sign-in, encrypted sync).
// ledger.html loads the parts in order as classic scripts sharing one global scope. Code that
// runs while a part loads (not inside a function called later) may only use names declared in
// this part or an earlier one; the boot part runs last. See "Development and testing" in README.md.

/* ======================= 11b · PULSE SOCIAL: leagues, competitions, following ======================= */
// Talks to /api/social on the server that served the page (social.js). A member is a random
// key in this browser (X-Pulse-Key). Only the numbers in pzSocialStats() are ever sent; the
// journal, notes and trades never leave the browser. Returns are read on the server from the
// chain, never sent from here. Sample data is never posted.
const SOC_KEY_STORE='pz_social_key';
const SOC_DEFAULT_SHARE={profile:true,boards:true,global:false,page:false,feed:true,habits:true,verify:true,ret:false,usd:false,addr:false,mentor:false};
const SOC_SHARE_ROWS=[
  ['profile','Public profile','Your profile page: streak, discipline, badges. Name, level and league show wherever you appear'],
  ['boards','Process leaderboards','Weekly XP, discipline and streak boards in your leagues'],
  ['global','Global leaderboards','Appear on the server-wide boards, ranked against everyone who opted in, whatever their league'],
  ['page','Public badge page','A page anyone with the link can open: your badges, level and streak — no trades, P&L or wallet'],
  ['feed','Milestones in the feed','Level-ups, streaks, badges and challenges'],
  ['habits','Habits you run','Others can see and adopt them'],
  ['verify','Verify my discipline','The server reads your public fills to confirm your Discipline score — the discipline board only counts verified scores. The owner can see your address'],
  ['ret','Show % return','30-day return and drawdown, read from your first wallet on chain'],
  ['usd','Show dollar P&L','Reveals your account size to everyone',true],
  ['addr','Show wallet address','Anyone could look up every trade and balance',true],
  ['mentor','Let mentors see my days','Mentors the owner appointed see your scores, slips and the lesson you write each night, and can leave you notes. No trades, P&L or wallet']];
const SOC_BOARDS=[['xp','Weekly XP'],['discipline','Discipline'],['streak','Streak'],['level','All-time XP'],['riskadj','Return / drawdown'],['ret','% Return'],['usd','$ P&L']];
const SOC_BOARD_NOTE={
  xp:'XP earned this week in your league — process, never profit. The top of the league moves up on Monday, the bottom moves down.',
  discipline:'Average Discipline score over the last 7 days, minimum 3 trading days — recomputed by the server from each trader’s own fills, so it can’t be typed in.',
  streak:'Current discipline streak: trading days in a row at 70+. Shields count; days off never break it.',
  level:'All the XP you’ve earned, by process.',
  riskadj:'30-day return divided by max drawdown, read on chain. Rewards making money without blowing up.',
  ret:'30-day return, read on chain. Over 25% drawdown drops you off this board.',
  usd:'30-day dollar P&L, read on chain. Only traders who opt in appear — it reveals account size.'};
const SOC_COMP_KIND={discipline:'Discipline',survivor:'Survivor',journal:'Journal streak',return:'Return under a drawdown cap'};
const SOC_COMP_HOW={
  discipline:'Your daily process score, averaged over the competition days. Profit doesn’t count: a red day with a clean process scores the same as a green one.',
  survivor:'Stay under your daily loss limit on every trading day. The first day you hit it, you’re out. Days you don’t trade are safe.',
  journal:'Journal every closed trade, day after day. Your longest run of fully journaled trading days counts.',
  return:'Return over the competition dates, read from your wallet on chain. Cross the drawdown cap at any point and you finish last.'};
const PZ_THEMES=[['mint','Mint','#3FE0A0'],['ember','Ember','#FF9F5A'],['aurora','Aurora','#8FA8FF'],['gold','Gold','#F4C04E']];
const PZ_UNLOCK_DEFAULTS={unlocksOn:true,unlocks:{trends:2,share:3,compete:4},themes:{ember:3,aurora:5,gold:8}};
var SOC={cfg:null,cfgTried:false,key:null,me:null,share:null,sub:'league',board:'rank',cfilter:'mine',feed:'following',
  cache:{},busy:{},lastSent:'',lastSentAt:0,timer:null,draft:null};
try{ SOC.key=localStorage.getItem(SOC_KEY_STORE)||null; }catch(e){}

// The numbers a member shares, from the shared game context. Pure given its inputs.
function pzSocialStats(g, habits, J, withLessons){
  const done=g.challenges.filter(c=>c.status==='done');
  return {xp:g.xp.total, level:g.level.level, week:g.nowWeek, weekXp:g.weekXp, tz:pzClockZone(),
    streak:g.streak.current, best:g.streak.best, shields:g.streak.shields,
    challengesDone:done.length, lastChallenge:done.length?habitSentence(done[done.length-1].ch.spec):'',
    badges:g.catalog?g.catalog.earned.map(b=>({id:b.id,t:b.t,c:b.c,r:b.r,k:b.k,d:b.desc||''})):g.achievements.filter(a=>a.at).map(a=>({id:a.id,t:a.title})),
    badgeN:g.catalog?g.catalog.earned.length:g.achievements.filter(a=>a.at).length, badgeTotal:g.catalog?g.catalog.total:0,
    habits:(habits||[]).slice(0,5),
    days:g.days.slice(-45).map(d=>{ const o={k:d.key,s:d.score,b:!!d.breached,j:d.parts.journal===1}, fl=(d.behavior&&d.behavior.flags)||{};
      const f=Object.keys(fl).filter(k=>fl[k]>0); if(f.length)o.f=f;
      const e=J&&J['day:'+d.key], v=e&&e.eod; if(v&&v.at)o.r=true; if(withLessons&&v&&v.lesson)o.l=String(v.lesson).slice(0,200);
      return o; }),
    xpDays:Object.fromEntries(Object.entries((g.xp&&g.xp.byDay)||{}).filter(([k,v])=>v>0).sort().slice(-100))};
}
// The server only gets a wallet address when a toggle needs it — Verify my discipline (fills),
// % return or dollar P&L (portfolio), or Show wallet address; otherwise it never leaves the browser.
function socAddressFor(share){ const w=settings.wallets[0]; return w&&share&&(share.verify||share.ret||share.usd||share.addr)?w.address:null; }
// The IANA zone the app's day keys use, so the server scores the same calendar days.
function pzClockZone(){ try{ return settings&&settings.tz==='utc'?'UTC':Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'; }catch(e){ return 'UTC'; } }
// "When X, Y." -> a self-graded habit spec (kept via the day journal's "I followed the plan").
function socHabitSpec(sentence){
  const s=String(sentence||'').trim(), m=s.match(/^when (.+?), (.+?)\.?$/i);
  return m?{kind:'self',when:m[1],then:m[2]}:{kind:'self',when:'I trade',then:s.replace(/\.$/,'')};
}
// Level-gated features and themes. 0 = available; otherwise the level that unlocks it.
function pzUnlockCfg(){ return SOC.cfg||PZ_UNLOCK_DEFAULTS; }
function pzNeeds(feature, level, cfg, demo, unlocked){
  cfg=cfg||PZ_UNLOCK_DEFAULTS; if(!cfg.unlocksOn||demo||unlocked)return 0;
  const need=feature.startsWith('theme:')?(cfg.themes||{})[feature.slice(6)]:((cfg.modules||cfg.unlocks||{})[feature]);
  return need>1&&level<need?need:0;
}
// Pulse's own check: the league's levels, unless the owner fully unlocked this member (or it's the owner)
function pzLocked(feature, level){ return pzNeeds(feature,level,pzUnlockCfg(),pzS.demo,!!(SOC.me&&SOC.me.unlocked)||!!(SRV.token&&!SRV.badAuth)); }
function socValue(board,v){ if(v==null)return '—';
  if(board==='ret')return (v>=0?'+':'−')+Math.abs(v*100).toFixed(1)+'%';
  if(board==='usd')return signedPlain(v);
  if(board==='riskadj')return v.toFixed(1);
  return Math.round(v).toLocaleString(); }
function socAgo(ms){ const m=Math.max(0,Math.round((Date.now()-ms)/60000)); return m<1?'just now':m<60?m+'m':m<1440?Math.round(m/60)+'h':Math.round(m/1440)+'d'; }
function socAv(h,size){ const P=['#B69CFF','#5AA9FF','#FFB25A','#3FE0A0','#F4C04E','#FF9A7E','#9FB4C8'];
  let x=0; for(const c of String(h||''))x=(x*31+c.charCodeAt(0))>>>0;
  return `<span class="pz-av" aria-hidden="true" style="background:${P[x%P.length]}${size?`;width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px`:''}">${esc(String(h||'?').slice(0,2).toUpperCase())}</span>`; }

function socAvailable(){ return /^https?:$/.test(location.protocol)&&SRV.enabled; }
async function socFetch(p,o){ o=o||{};
  o.headers=Object.assign({},o.body?{'Content-Type':'application/json'}:{},SOC.key?{'X-Pulse-Key':SOC.key}:{},o.headers||{});
  const r=await fetch('/api/social'+p,o);
  let d; try{ d=await r.json(); }catch(e){ if(r.ok)throw new Error('The server’s answer didn’t arrive in full. Try again.'); d={}; } // a cut-off body is never an empty success
  if(!r.ok){ const e=new Error(d.error||('HTTP '+r.status)); e.status=r.status; e.data=d; throw e; }
  return d; }
function socBoot(){
  if(SOC.cfgTried||!socAvailable())return; SOC.cfgTried=true;
  socFetch('/config').then(c=>{ SOC.cfg=c; pzApplyCfg(c); if(!SOC.key)return;
    return socFetch('/me').then(d=>{ SOC.me=d.me; SOC.share=d.share; PZ_CFG.rev++; },e=>{
      if(e.status===401||e.status===403){ SOC.key=null; vaultForget(); try{ localStorage.removeItem(SOC_KEY_STORE); }catch(_){} if(e.status===403)pzNote(e.message,'err'); } }); })
    .catch(()=>{}).finally(()=>{ if(PZ)pzRender(); else if(typeof allTrades!=='undefined'&&allTrades.length)render(); });
}
// the league's levels, titles and XP weights reach the game layer (both views)
function pzApplyCfg(c){ if(!c)return; PZ_CFG={rev:PZ_CFG.rev+1,levels:c.levels||null,xp:c.xp||null}; }
// Cached GET: returns what's cached (possibly stale) and refreshes in the background.
function socGet(name, p, maxAge){
  const c=SOC.cache[name], fresh=c&&Date.now()-c.at<(maxAge||30000);
  if(!fresh&&!SOC.busy[name]){ SOC.busy[name]=true;
    socFetch(p).then(d=>{ SOC.cache[name]={at:Date.now(),d,err:null}; },e=>{ SOC.cache[name]={at:Date.now(),d:c?c.d:null,err:e.message}; })
      .finally(()=>{ SOC.busy[name]=false; if(PZ)pzRender(); }); }
  return c||null;
}
function socStale(){ for(const k in SOC.cache)SOC.cache[k].at=0; }
function socSync(g){
  if(!SOC.key||!SOC.me||pzS.demo||!settings.wallets.length)return;
  let p; try{ p=JSON.stringify(pzSocialStats(g,habitsList().map(habitSentence),journal,!!(SOC.share&&SOC.share.mentor))); }catch(e){ return; }
  if(p===SOC.lastSent)return;
  clearTimeout(SOC.timer);
  SOC.timer=setTimeout(()=>{ SOC.lastSentAt=Date.now();
    socFetch('/stats',{method:'POST',body:p}).then(()=>{ SOC.lastSent=p; socStale(); },()=>{}); },
    Math.max(1500,15000-(Date.now()-SOC.lastSentAt)));
}

// ---- screens ----

function socHead(){
  return `<header class="pz-head"><div><span class="pz-kick">${SOC.cfg&&SOC.cfg.week?'Week '+esc(SOC.cfg.week.slice(-2)):'Social'}</span><h1 class="pz-h1">Social</h1></div>
    <div class="pz-chips">${SOC.me.mentor?`<a class="pz-chip" href="#mentor" style="font-weight:700;font-size:13px;padding:0 14px">Mentees</a>`:''}<a class="pz-chip icon" href="#u/${esc(SOC.me.handle)}" aria-label="My profile">${socAv(SOC.me.handle,30)}</a><a class="pz-chip icon" href="#sharing" aria-label="What you share">${pzI('gear',20)}</a></div></header>`;
}
function socUnavailableHtml(){
  return `${pzHead('Leagues · competitions · friends','Social')}<section class="pz-card"><p class="pz-sub">Social lives on the Ledger server this page comes from. Open Pulse from your server’s <b>/pulse</b> link to join the league${/^https?:$/.test(location.protocol)?' — this server didn’t answer just now; try again in a moment.':'.'}</p></section>`;
}
const SOC_SHARE_GROUPS=[['Profile',['profile','page','feed','habits','mentor']],['Boards',['boards','global','verify','ret']],['Sensitive',['usd','addr']]];
function socToggles(share, attr){
  return SOC_SHARE_GROUPS.map(([g,keys])=>`<section class="pz-card" style="padding:4px 16px"><span class="pz-lbl" style="display:block;margin:12px 0 2px;color:${g==='Sensitive'?'#FFB39E':'var(--pz-muted)'}">${g}</span>${socToggleRows(share,attr,keys)}</section>`).join('');
}
function socToggleRows(share, attr, keys){
  return SOC_SHARE_ROWS.filter(r=>keys.includes(r[0])).map(([k,l,n,risky])=>`<div class="pz-toggle"><span style="flex:1"><b id="soct_${k}">${esc(l)}</b><span class="${risky?'risky':''}">${esc(n)}</span></span>
    <button type="button" role="switch" class="pz-switch" ${attr}="${k}" aria-checked="${!!share[k]}" aria-labelledby="soct_${k}"><i></i></button></div>`).join('');
}
function socJoinHtml(){
  const cfg=SOC.cfg; SOC.draft=SOC.draft||{...SOC_DEFAULT_SHARE};
  if(cfg&&!cfg.open)return `${pzHead('Leagues · competitions · friends','Social')}${pzLinkCardHtml()}<section class="pz-card"><p class="pz-sub">This league isn’t taking new members right now. Ask the person who shared the link.</p></section>`;
  const linkCard=pzLinkCardHtml();
  return `${pzHead('Leagues · competitions · friends','Join the league')}${linkCard?`<div style="max-width:560px;margin-bottom:14px">${linkCard}</div>`:''}
  <div class="pz-wide">
    <div class="pz-col"><section class="pz-card" style="display:flex;flex-direction:column;gap:10px">
      <div class="pz-big">Compete on discipline, not luck</div>
      <p class="pz-sub">Weekly leagues rank XP, which only comes from process. Competitions are scored from your fills. Follow traders and adopt the habits that work for them.</p>
      <p class="pz-sub">${cfg?cfg.members+' trader'+(cfg.members===1?'':'s')+' in this league so far.':''}</p></section>
      <div class="pz-field"><label for="socHandle">Your public name</label><input type="text" id="socHandle" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. slowhands"></div>
      ${cfg&&cfg.inviteRequired?'<div class="pz-field"><label for="socInvite">Invite code</label><input type="text" id="socInvite" maxlength="40" autocomplete="off"></div>':''}</div>
    <div class="pz-col"><b style="display:block;font-size:15px">What you share</b>${socToggles(SOC.draft,'data-soc-draft')}
      <button type="button" class="pz-cta" id="socJoin">Join the league</button>
      <p class="pz-fine">Your journal, notes and trades stay in this browser. Only the numbers switched on here are sent, and returns are read from the chain, never from this device.</p></div>
  </div>`;
}

function socCompCard(c, level){
  const need=pzLocked('compete',level);
  const when=c.status==='upcoming'?'Starts '+dayLabel(c.start):c.status==='live'?'Ends '+dayLabel(c.end):'Finished '+dayLabel(c.end);
  const meLine=c.me?`#${c.me.rank} of ${c.entrants} · ${c.me.note}`:c.entrants+' joined';
  const act=c.status==='finished'?`<a class="pz-ghost pz-sm" href="#c/${esc(c.id)}">Results</a>`
    :c.joined?`<a class="pz-ghost pz-sm" href="#c/${esc(c.id)}">Standings</a>`
    :need?`<span class="pz-fine">${pzI('lock',14)} Unlocks at level ${need}</span>`
    :`<button type="button" class="pz-cta pz-sm" style="width:auto;min-height:40px;padding:0 18px" data-soc-join="${esc(c.id)}">Join</button>`;
  return `<section class="pz-card" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;gap:10px"><span class="pz-lbl" style="color:${c.type==='survivor'?'#FFB25A':c.type==='return'?PZ_COL.xp:c.type==='journal'?PZ_COL.risk:PZ_COL.good}">${esc(SOC_COMP_KIND[c.type]||c.type)}</span><span class="pz-sub" style="font-size:12px">${esc(when)}</span></div>
    <a href="#c/${esc(c.id)}" style="color:var(--pz-text);text-decoration:none"><b style="font-size:17px">${esc(c.title)}</b></a>${c.rule?`<p class="pz-sub" style="font-size:13px">${esc(c.rule)}</p>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:13px;font-weight:600;color:${c.me&&c.me.out?PZ_COL.low:'var(--pz-soft)'}">${esc(meLine)}</span>${act}</div></section>`;
}
function socCompeteHtml(g){
  const c=socGet('comps','/competitions',30000), all=c&&c.d?c.d.competitions:null;
  const F=SOC.cfilter;
  const seg=`<div class="pz-seg" role="group" aria-label="Show">${[['mine','Mine'],['open','Open'],['past','Past']].map(([k,l])=>`<button type="button" data-soc-cf="${k}" aria-pressed="${F===k}">${l}</button>`).join('')}</div>`;
  if(!all)return `${seg}<p class="pz-sub">${c&&c.err?esc(c.err):'<span class="pz-spin"></span>Loading…'}</p>`;
  const list=all.filter(x=>F==='past'?x.status==='finished':F==='mine'?x.joined&&x.status!=='finished':!x.joined&&x.status!=='finished');
  const empty=F==='mine'?'You’re not in a competition right now. Pick one from Open.':F==='open'?'No open competitions. The league owner creates them — check back soon.':'Finished competitions land here.';
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">${seg}<span class="pz-fine">Prizes are badges and bragging rights, never money.</span></div>
    ${list.length?`<div class="pz-jgrid">${pzPage('comps:'+F,list).items.map(x=>socCompCard(x,g.level.level)).join('')}</div>${pzPage('comps:'+F,list).html}`:`<section class="pz-card"><p class="pz-sub">${empty}</p></section>`}`;
}
function socCompHtml(D, id){
  const c=socGet('comp:'+id,'/competitions/'+encodeURIComponent(id),20000), x=c&&c.d&&c.d.competition;
  const back=`<a class="pz-back" href="#social">${pzI('back',20)}Social</a>`;
  if(!x)return `${back}<p class="pz-sub">${c&&c.err?esc(c.err):'<span class="pz-spin"></span>Loading…'}</p>`;
  const need=pzLocked('compete',D.g.level.level);
  const act=x.status==='finished'?'':x.joined?`<button type="button" class="pz-ghost" data-soc-leave="${esc(x.id)}">Leave this competition</button>`
    :need?`<p class="pz-fine">${pzI('lock',14)} Competitions unlock at level ${need}. You’re level ${D.g.level.level}.</p>`:`<button type="button" class="pz-cta" data-soc-join="${esc(x.id)}">Join</button>`;
  const spg=pzPage('st:'+x.id,x.standings||[]), rows=spg.items.map(r=>`<li class="pz-li${r.me?' me':''}"><span class="pz-rank${r.rank<=3?' top':''}">${r.rank}</span>${socAv(r.handle)}<a class="pz-who" href="#u/${esc(r.handle)}"><b>${r.me?'You':'@'+esc(r.handle)}</b><span${r.out?' style="color:var(--pz-err-t)"':''}>${esc(r.note)}</span></a></li>`).join('');
  return `${back}${pzHead((SOC_COMP_KIND[x.type]||x.type)+' · '+(x.status==='upcoming'?'starts '+dayLabel(x.start):x.status==='live'?'ends '+dayLabel(x.end):'finished'),x.title)}
    <div class="pz-wide"><div class="pz-col">
      ${x.me?`<div class="pz-grid3"><div class="pz-tile good"><span class="pz-t">Your rank</span><span class="pz-n">#${x.me.rank}</span><span class="pz-t">of ${x.entrants}</span></div><div class="pz-tile" style="grid-column:span 2"><span class="pz-t">Your standing</span><span style="font-size:15px;font-weight:600">${esc(x.me.note)}</span></div></div>`:''}
      <section class="pz-card" style="display:flex;flex-direction:column;gap:8px"><b style="font-size:15px">How it’s scored</b>${x.rule?`<p class="pz-sub" style="font-size:13px">${esc(x.rule)}</p>`:''}<p class="pz-sub" style="font-size:13px">${esc(SOC_COMP_HOW[x.type]||'')}</p><p class="pz-fine">${esc(dayLabel(x.start))} → ${esc(dayLabel(x.end))}${x.type==='discipline'?' · minimum '+x.minDays+' trading days':x.type==='journal'?' · done at '+x.minDays+' days':x.type==='return'&&x.ddCap?' · drawdown cap '+Math.round(x.ddCap*100)+'%':''}</p></section>
      ${act}</div>
      <div class="pz-col">${rows?`<ol class="pz-list" aria-label="Standings">${rows}</ol>${spg.html}`:'<section class="pz-card"><p class="pz-sub">No one has joined yet.</p></section>'}</div></div>`;
}
function socFeedHtml(){
  const S=SOC.feed, c=socGet('feed:'+S,'/feed?scope='+S,20000), d=c&&c.d;
  const seg=`<div class="pz-seg full" role="group" aria-label="Show">${[['following','Following'],['discover','Discover']].map(([k,l])=>`<button type="button" data-soc-feed="${k}" aria-pressed="${S===k}">${l}</button>`).join('')}</div>`;
  if(!d)return `${seg}<p class="pz-sub">${c&&c.err?esc(c.err):'<span class="pz-spin"></span>Loading…'}</p>`;
  const sug=d.suggest&&d.suggest.length?`<section style="display:flex;flex-direction:column;gap:8px"><span class="pz-lbl" style="color:var(--pz-muted)">Traders to follow</span><div class="pz-grid3">${d.suggest.map(p=>`<a class="pz-tile" href="#u/${esc(p.handle)}" style="align-items:center;text-align:center;text-decoration:none;color:var(--pz-text)">${socAv(p.handle,40)}<b style="font-size:13px">@${esc(p.handle)}</b><span class="pz-t">${esc(p.tierName)} · ${esc(p.why)}</span></a>`).join('')}</div></section>`:'';
  const fpg=pzPage('feed:'+S,d.events), ev=fpg.items.map(e=>`<article class="pz-card pz-ev"><div class="pz-evh">${e.admin?`<span class="pz-av" style="background:#3FE0A0" aria-hidden="true">${pzI('bolt',16)}</span>`:socAv(e.handle,36)}
      <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:14px;line-height:1.35">${e.admin?'<b>League</b>':`<a href="#u/${esc(e.handle)}" style="color:var(--pz-text);font-weight:700;text-decoration:none">${e.mine?'You':'@'+esc(e.handle)}</a>`} ${esc(e.text)}</span><span class="pz-sub" style="font-size:11px">${socAgo(e.at)}</span></span></div>
      ${e.quote?`<div class="pz-quote">${esc(e.quote)}</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">${e.admin||e.mine?(e.mine&&e.kudos?`<span class="pz-fine">${e.kudos} kudos</span>`:''):`<button type="button" class="pz-kudo" data-soc-kudos="${esc(e.id)}" aria-pressed="${e.liked}" aria-label="Kudos, ${e.kudos}">${pzI('check',16)}${e.kudos}</button>`}
      ${e.type==='habit'&&e.quote&&!e.mine?`<button type="button" class="pz-kudo" data-soc-adopt="${esc(e.quote)}">Adopt this habit</button>`:''}</div></article>`).join('');
  const empty=S==='following'?'Nothing here yet. Follow traders from Discover or the leaderboards and their milestones show up here.':'No posts yet.';
  return `${seg}${sug}${ev?`<div class="pz-jgrid">${ev}</div>${fpg.html}`:`<section class="pz-card"><p class="pz-sub">${empty}</p></section>`}`;
}
function socSocialHtml(D){
  socBoot();
  if(!socAvailable())return socUnavailableHtml();
  if(!SOC.cfg)return `${pzHead('Leagues · competitions · friends','Social')}<p class="pz-sub"><span class="pz-spin"></span>Loading…</p>`;
  if(SOC.cfg.enabled===false)return `${pzHead('Leagues · competitions · friends','Social')}<section class="pz-card"><p class="pz-sub">The league opens once the server owner sets an access token (AUTH_TOKEN). Without one, anyone with the link could read the owner’s journal.</p></section>`;
  if(!SOC.me)return socJoinHtml();
  const body=SOC.sub==='feed'?socPartnersHtml()+socFeedHtml():SOC.sub==='boards'?socBoardsHtml(D.g):socLeagueHtml(D.g)+`<section style="display:flex;flex-direction:column;gap:10px;margin-top:10px"><span class="pz-lbl" style="color:var(--pz-muted)">Competitions</span>${socCompeteHtml(D.g)}</section>`;
  return `${socHead()}${socSubTabs()}${body}`;
}
function socProfileHtml(D, handle){
  const back=`<a class="pz-back" href="#social">${pzI('back',20)}Social</a>`;
  if(!socAvailable()||!SOC.me)return `${back}${socSocialHtml(D)}`;
  const c=socGet('u:'+handle.toLowerCase(),'/profile/'+encodeURIComponent(handle),30000), d=c&&c.d, p=d&&d.profile;
  if(!p)return `${back}<p class="pz-sub">${c&&c.err?esc(c.err):'<span class="pz-spin"></span>Loading…'}</p>`;
  const T=(SOC.cfg&&SOC.cfg.tiers)||[];
  const follow=p.isMe?`<a class="pz-ghost" href="#sharing">Edit what you share</a>`
    :`<button type="button" class="${p.isFollowing?'pz-ghost':'pz-cta'}" data-soc-follow="${esc(p.handle)}" data-on="${p.isFollowing?1:0}">${p.isFollowing?'Following':'Follow'}</button>
      <button type="button" class="pz-ghost" data-soc-pask="${esc(p.handle)}">Ask to be accountability partners</button>`;
  const tiles=p.private?'<section class="pz-card"><p class="pz-sub">This profile is private.</p></section>'
    :`<div class="pz-grid3"><div class="pz-tile good"><span class="pz-n">${p.discipline30==null?'—':p.discipline30}</span><span class="pz-t">Discipline · 30d${p.verified?' · verified':''}</span></div>
      <div class="pz-tile warm"><span class="pz-n">${p.streak}</span><span class="pz-t">Day streak · best ${p.best}</span></div>
      <div class="pz-tile"><span class="pz-n">${p.badgeN}</span><span class="pz-t">Badges</span></div></div>`;
  const money=p.ret!=null||p.usd!=null?`<section class="pz-card" style="display:flex;justify-content:space-between;gap:12px"><span><span class="pz-t pz-sub" style="font-size:12px">30-day return${p.isMe?' (only you see this unless you share it)':''}</span><br><b style="font-family:var(--pz-num);font-size:26px;color:${p.ret>=0?PZ_COL.good:PZ_COL.low}">${p.ret!=null?socValue('ret',p.ret):'—'}</b>${p.usd!=null?` <span class="pz-sub">${esc(signedPlain(p.usd))}</span>`:''}</span><span style="text-align:right"><span class="pz-sub" style="font-size:12px">Max drawdown</span><br><b style="font-family:var(--pz-num);font-size:26px">${p.dd!=null?(p.dd*100).toFixed(1)+'%':'—'}</b></span></section>`:'';
  const habits=p.habits&&p.habits.length?`<section class="pz-card" style="padding:6px 16px"><b style="display:block;font-size:15px;margin:10px 0 4px">Habits ${p.isMe?'you run':'they run'}</b>${p.habits.map(h=>`<div class="pz-toggle"><span style="flex:1;font-size:14px;line-height:1.4">${esc(h)}</span>${p.isMe?'':`<button type="button" class="pz-kudo" data-soc-adopt="${esc(h)}">Adopt</button>`}</div>`).join('')}</section>`:'';
  const badges=p.badges&&p.badges.length?`<section style="display:flex;flex-wrap:wrap;gap:6px">${p.badges.map(b=>`<span class="pz-chipbtn" style="height:32px;display:inline-flex;align-items:center;gap:6px;cursor:default">${pzI('medal',14)}${esc(b)}</span>`).join('')}</section>`:'';
  const ev=(d.events||[]).map(e=>`<div class="pz-ins"><span class="pz-sub" style="font-size:12px;min-width:34px">${socAgo(e.at)}</span><span><b>${esc(e.text)}</b>${e.quote?`<span>${esc(e.quote)}</span>`:''}</span></div>`).join('');
  return `${back}<section style="display:flex;align-items:center;gap:14px">${socAv(p.handle,72)}<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><h1 class="pz-h1" style="font-family:Inter,system-ui,sans-serif;font-size:22px;font-weight:800">@${esc(p.handle)}</h1>
      <span class="pz-sub" style="font-size:13px">Level ${p.level} · ${esc(p.title)} · ${esc(T[p.tier]||p.tierName)} league</span><span class="pz-sub" style="font-size:12px">${p.followers} follower${p.followers===1?'':'s'} · ${p.following} following${p.address?' · '+esc(walletShort(p.address)):''}</span></span></section>
    <div class="pz-wide"><div class="pz-col">${follow}${tiles}${money}${badges}</div><div class="pz-col">${habits}${ev?`<section class="pz-card" style="padding:4px 16px"><b style="display:block;font-size:15px;margin:10px 0 2px">Recent</b>${ev}</section>`:''}</div></div>`;
}
function socSharingHtml(D){
  const back=`<a class="pz-back" href="#social">${pzI('back',20)}Social</a>`;
  if(!socAvailable()||!SOC.me)return `${back}${socSocialHtml(D)}`;
  SOC.draft=SOC.draft||{...SOC.share};
  const w=settings.wallets[0];
  return `${back}${pzHead('Profile & privacy','What you share')}
  <p class="pz-sub" style="margin-top:-6px">Your journal, notes and trades never leave this device. Only the numbers switched on below are sent.</p>
  <div class="pz-wide"><div class="pz-col">
    <div class="pz-field"><label for="socHandle2">Public name</label><input type="text" id="socHandle2" maxlength="20" value="${esc(SOC.draftHandle!=null?SOC.draftHandle:SOC.me.handle)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    ${socToggles(SOC.draft,'data-soc-draft')}</div>
  <div class="pz-col">
    ${SOC.me.walletStatus==='pending'?'<p class="pz-warn">Your wallet is waiting for the league owner’s approval. Until then it doesn’t count for returns, verified Discipline or return competitions.</p>'
      :SOC.me.walletStatus==='rejected'?'<p class="pz-warn">The league owner hasn’t accepted this wallet. It doesn’t count for returns, verified Discipline or return competitions here.</p>':''}
    <p class="pz-fine">${SOC.me.claimed?`Returns and verified Discipline are read on chain from your claimed wallet (${esc(walletShort(SOC.me.claimedAddress||''))}).`:w?`Returns are read on chain from your first wallet (${esc(walletShort(w.address))}) when “Show % return” or “Show dollar P&L” is on. The server owner can see that address.`:'Add a wallet to take part in return boards and competitions.'}</p>
    <button type="button" class="pz-cta" id="socSaveShare">Save</button>
    <a class="pz-card pz-cardlink" href="#account"><span class="pz-ico" style="background:var(--pz-tint-n);color:var(--pz-soft)">${pzI('shield',20)}</span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><b style="font-size:15px">Account</b><span class="pz-sub" style="font-size:12px">Claim your wallet, devices, journal sync, leave the league</span></span>${pzI('chev',18)}</a>
  </div></div>`;
}
// claim, devices, sync and leaving: the things you set once, away from the everyday sharing switches
function socAccountHtml(D){
  const back=`<a class="pz-back" href="#sharing">${pzI('back',20)}What you share</a>`;
  if(!socAvailable()||!SOC.me)return `<a class="pz-back" href="#social">${pzI('back',20)}Social</a>${socSocialHtml(D)}`;
  const sync=(SRV.token&&!SRV.badAuth)?'':socVaultCardHtml();
  return `${back}${pzHead('@'+SOC.me.handle,'Account')}
  <div class="pz-wide"><div class="pz-col">${socClaimCardHtml()}${socPasskeysCardHtml()}${socDevicesCardHtml()}</div>
  <div class="pz-col">${sync}
    <section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px">Leave the league</b><p class="pz-sub" style="font-size:13px">Deletes your profile, posts and competition entries from this server. Your journal isn’t touched.</p><button type="button" class="pz-ghost pz-sm" id="socLeave" style="color:var(--pz-err-t);border-color:var(--pz-err-b)">Leave and delete my profile</button></section>
  </div></div>`;
}
function pzXpToGo(need,g){ const s=pzLevelStart(need); return isFinite(s)?Math.max(0,s-g.level.xp).toLocaleString()+' XP to go.':'Past the top level the league set — ask the owner.'; }
function pzLockedHtml(title, need, g){
  const L=g.level;
  return `${pzHead('Unlocks at level '+need,title)}<section class="pz-card pz-lock">${pzRing(L.level,L.into/L.need,PZ_COL.xp,{size:96,cap:'Level'})}
    <div class="pz-big">${esc(title)} unlocks at level ${need}</div><p class="pz-sub">${pzXpToGo(need,g)} XP comes from process: check in, plan before your first trade, keep your stops and journal every trade.</p>
    <a class="pz-cta" href="#checkin" style="max-width:320px">Earn XP: do today’s check-in</a></section>`;
}
function pzThemesHtml(g){
  const cfg=pzUnlockCfg(), cur=settings.pzTheme||'mint';
  return `<section class="pz-span" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px">Themes</b><div class="pz-swatches">${PZ_THEMES.map(([k,l,c])=>{ const need=k==='mint'?0:pzLocked('theme:'+k,g.level.level);
    return `<button type="button" class="pz-swatch" data-pz-theme="${k}" aria-pressed="${cur===k}"${need?' disabled':''} aria-label="${l} theme${need?', unlocks at level '+need:''}"><i style="background:${need?'#2C333C':c}">${need?pzI('lock',14):''}</i>${l}${need?`<span class="pz-fine" style="font-size:10px">Level ${need}</span>`:''}</button>`; }).join('')}</div></section>`;
}
// A theme only applies while its level is reached (a synced choice from a higher-level device, or
// an owner raising the bar, falls back to Mint instead of showing a locked theme).
function pzApplyTheme(level){ const r=$('pz'); if(!r)return; const t=PZ_THEMES.find(x=>x[0]===settings.pzTheme);
  const need=t&&t[0]!=='mint'?pzLocked('theme:'+t[0],level||1):0;
  const acc=t&&!need?t[2]:'#3FE0A0';
  r.style.setProperty('--pz-acc-d',acc); r.style.setProperty('--pz-acc-l',pzDeepen(acc)); } // the stylesheet picks one by appearance
// the accent on white: mixed 40% toward black, so links and text in it stay readable
function pzDeepen(hex){ const n=parseInt(String(hex).slice(1),16); if(!(n>=0))return hex;
  const f=v=>Math.round(v*0.6).toString(16).padStart(2,'0'); return '#'+f(n>>16&255)+f(n>>8&255)+f(n&255); }

// ---- actions ----
async function socAction(t){
  const ds=t.dataset;
  const done=(m,kind)=>{ if(m)pzNote(m,kind); socStale(); pzRender(); };
  try{
    if(ds.socSub){ SOC.sub=ds.socSub; if(pzTab()!=='social')location.hash='#social'; else pzRender(); return true; }
    // partners
    if(ds.socPask||t.id==='socPAsk'){ const h=ds.socPask||(($('socPIn')||{value:''}).value.trim()); if(!h)return true;
      await socFetch('/partners',{method:'POST',body:JSON.stringify({handle:h})}); delete SOC.cache.partners; done('Asked @'+h.replace(/^@/,'')+'. You’ll see each other’s days once they accept.'); return true; }
    if(ds.socPaccept){ await socFetch('/partners/'+encodeURIComponent(ds.socPaccept)+'/accept',{method:'POST'}); delete SOC.cache.partners; if(SOC.me)SOC.me.partners=(SOC.me.partners||0)+1; done('You’re partners now.'); return true; }
    if(ds.socPdel){ if(!confirm('End this partnership? You stop seeing each other’s days.'))return true;
      await socFetch('/partners/'+encodeURIComponent(ds.socPdel),{method:'DELETE'}); delete SOC.cache.partners; done(''); return true; }
    if(ds.socNudge){ await socFetch('/partners/'+encodeURIComponent(ds.socNudge)+'/nudge',{method:'POST',body:JSON.stringify({})}); delete SOC.cache.partners; done('Nudged. They’ll see it on their next open — or as a notification.'); return true; }
    if(ds.socChfor!==undefined){ pzS.chFor=ds.socChfor||null; pzRender(); const n=$('socChIn'); if(n)n.focus(); return true; }
    if(ds.socChsave){ const v=($('socChIn')||{value:''}).value.trim(); if(!v)return true;
      await socFetch('/partners/'+encodeURIComponent(ds.socChsave)+'/challenge',{method:'PUT',body:JSON.stringify({text:v})}); pzS.chFor=null; delete SOC.cache.partners; done('Shared challenge set for this week.'); return true; }
    // mentor notes
    if(ds.socNotefor!==undefined){ pzS.noteFor=ds.socNotefor||null; pzRender(); const n=$('socNoteIn'); if(n)n.focus(); return true; }
    if(ds.socNsend){ const v=($('socNoteIn')||{value:''}).value.trim(); if(!v)return true;
      await socFetch('/mentor/'+encodeURIComponent(ds.h)+'/notes',{method:'POST',body:JSON.stringify({day:ds.socNsend,text:v})}); pzS.noteFor=null; delete SOC.cache['mentee:'+ds.h.toLowerCase()]; done('Note sent.'); return true; }
    if(ds.socNdel){ if(!confirm('Delete this note?'))return true; await socFetch('/mentor/'+encodeURIComponent(ds.h)+'/notes/'+encodeURIComponent(ds.socNdel),{method:'DELETE'}); delete SOC.cache['mentee:'+ds.h.toLowerCase()]; done(''); return true; }
    if(t.id==='socInboxRead'){ await socFetch('/inbox/read',{method:'POST'}); delete SOC.cache.inbox; if(SOC.me)SOC.me.inbox=0; pzRender(); return true; }
    if(ds.socLg){ SOC.lg=ds.socLg; SOC.board='rank'; pzRender(); return true; }
    if(ds.socGboard){ SOC.gboard=ds.socGboard; pzRender(); return true; }
    if(ds.socGlobal){ const on=ds.socGlobal==='1', share={...(SOC.share||SOC_DEFAULT_SHARE),global:on};
      const r=await socFetch('/me',{method:'PUT',body:JSON.stringify({share})}); SOC.me=r.me; PZ_CFG.rev++; SOC.share=r.share; done(on?'You’re on the global leaderboards.':'You left the global leaderboards.'); return true; }
    if(ds.socLgjoin){ const inv=($('socLgInv')||{value:''}).value.trim();
      const r=await socFetch('/leagues/'+encodeURIComponent(ds.socLgjoin)+'/join',{method:'POST',body:JSON.stringify({invite:inv})});
      SOC.lg=r.league.id; SOC.board='rank'; SOC.sub='league'; SOC.cache={}; done('Welcome to '+r.league.name+'.'); location.hash='#social'; return true; }
    if(ds.socLgleave){ if(!confirm('Leave this league? Your XP and badges stay; you just leave its ranking.'))return true;
      await socFetch('/leagues/'+encodeURIComponent(ds.socLgleave)+'/join',{method:'DELETE'}); SOC.lg=null; SOC.cache={}; done('You left the league.'); return true; }
    if(ds.socLgopen){ SOC.lg=ds.socLgopen; SOC.board='rank'; SOC.sub='league'; location.hash='#social'; return true; }
    if(ds.socBoard){ SOC.board=ds.socBoard; pzRender(); return true; }
    if(ds.socCf){ SOC.cfilter=ds.socCf; pzRender(); return true; }
    if(ds.socFeed){ SOC.feed=ds.socFeed; pzRender(); return true; }
    if(ds.socDraft){ SOC.draft=SOC.draft||{...(SOC.share||SOC_DEFAULT_SHARE)}; SOC.draft[ds.socDraft]=!SOC.draft[ds.socDraft]; t.setAttribute('aria-checked',String(SOC.draft[ds.socDraft])); return true; }
    if(ds.socKudos){ const r=await socFetch('/kudos/'+encodeURIComponent(ds.socKudos),{method:'POST'}); t.setAttribute('aria-pressed',String(r.liked)); t.lastChild.textContent=r.kudos; socStale(); return true; }
    if(ds.socFollow){ const on=ds.on==='1'; await socFetch('/follow/'+encodeURIComponent(ds.socFollow),{method:on?'DELETE':'POST'}); done(on?'Unfollowed.':'Following @'+ds.socFollow+'. Their milestones show up in your feed.'); return true; }
    if(ds.socJoin){ await socFetch('/competitions/'+encodeURIComponent(ds.socJoin)+'/join',{method:'POST'}); done('You’re in. Good luck — play your process.'); return true; }
    if(ds.socLeave){ if(!confirm('Leave this competition?'))return true; await socFetch('/competitions/'+encodeURIComponent(ds.socLeave)+'/join',{method:'DELETE'}); done('You left the competition.'); return true; }
    if(ds.socAdopt){ await adoptHabit(socHabitSpec(ds.socAdopt)); done('Added to your habits. It’s tracked by the day journal’s “I followed the plan”.'); return true; }
    if(ds.pzAppear){ await setAppearance(ds.pzAppear); return true; }
    if(ds.pzTheme){ settings.pzTheme=ds.pzTheme; await Store.set(S_KEY,settings); pzRender(); return true; }
    if((t.id||(t.dataset&&t.dataset.pkDel))&&await acctAction(t))return true;
    switch(t.id){
      case 'socJoin': { const h=($('socHandle')||{value:''}).value.trim(), inv=($('socInvite')||{value:''}).value.trim();
        const share=SOC.draft||SOC_DEFAULT_SHARE;
        const r=await socFetch('/join',{method:'POST',body:JSON.stringify({handle:h,invite:inv,share,address:socAddressFor(share)})});
        vaultForget(); COACH.tried=false; COACH.msgs=null; SOC.key=r.key; try{ localStorage.setItem(SOC_KEY_STORE,r.key); }catch(e){}
        SOC.me=r.me; PZ_CFG.rev++; SOC.share=r.share; SOC.draft=null; SOC.cache={}; SOC.lastSent='';
        done('Welcome to the league, @'+r.me.handle+'.'+(r.walletTaken?' Your wallet is claimed by another profile, so it wasn’t added.':'')); return true; }
      case 'socSaveShare': { const h=($('socHandle2')||{value:''}).value.trim(), share=SOC.draft||SOC.share;
        let r, taken=false;
        try{ r=await socFetch('/me',{method:'PUT',body:JSON.stringify({handle:h,share,address:socAddressFor(share)})}); }
        catch(e){ if(!(e.status===409&&e.data&&e.data.walletTaken))throw e; taken=true; // save the rest without that wallet
          r=await socFetch('/me',{method:'PUT',body:JSON.stringify({handle:h,share,address:null})}); }
        SOC.me=r.me; PZ_CFG.rev++; SOC.share=r.share; SOC.draft=null; SOC.draftHandle=null; SOC.lastSent='';
        done(taken?'Saved — without your wallet: another profile claimed it, so its numbers can’t count for you.':'Saved.'); return true; }
      case 'socLeave': { if(!confirm('Leave the league and delete your profile, posts and competition entries? Your journal isn’t touched.'))return true;
        await socFetch('/me',{method:'DELETE'}); SOC.key=null; SOC.me=null; PZ_CFG.rev++; SOC.share=null; SOC.cache={}; vaultForget(); try{ localStorage.removeItem(SOC_KEY_STORE); }catch(e){}
        location.hash='#social'; done('You left the league.'); return true; }
    }
  }catch(e){ pzNote(e.message,'err'); return true; }
  return false;
}


/* ======================= 11c · PULSE ACCOUNTS: wallet claims, sign-in on any device, encrypted journal sync ======================= */
// A wallet signature (Sign-In with Ethereum) claims a wallet for a profile and signs in on another
// device — no password, no transaction. A one-time code from a signed-in device works too, for
// phones without a wallet app. The journal can follow a member between devices as an encrypted
// copy: encrypted in this browser with a key stretched from a sync passphrase (PBKDF2 → AES-GCM),
// so the server, and its owner, only ever hold ciphertext. There's no reset: lose the passphrase
// and the synced copy can't be opened. The owner (signed in with AUTH_TOKEN) already syncs the
// whole journal to the server, so none of this applies to them.
const VAULT_STORE='pz_vault', VAULT_ITER=310000;
// mid: the member this sync belongs to (another profile signing in on this device never inherits it).
// dirty: journal ids edited here since the last push (with an edit counter, like _dirtyJ).
// base: settings and wallets as last synced, so a merge keeps only the fields changed here (null: all of
// this device's settings win, e.g. after restoring a backup). sGen/sSent: whether settings await a push.
var VAULT={key:null,salt:null,rev:0,mid:null,dirty:new Map(),base:null,sGen:0,sSent:0,timer:null,busy:false,again:false,err:null};
const vb64=buf=>{ let s=''; const a=buf instanceof Uint8Array?buf:new Uint8Array(buf); for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000)); return btoa(s); };
const unvb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function utf8Hex(s){ return '0x'+Array.from(new TextEncoder().encode(s),b=>b.toString(16).padStart(2,'0')).join(''); }

// Ask the browser's wallet to sign the server's message. purpose: 'claim' | 'login'.
async function socWalletSign(purpose){
  const eth=window.ethereum;
  if(!eth||typeof eth.request!=='function')throw new Error('No wallet in this browser. Use a browser with MetaMask or Rabby, or your wallet app’s built-in browser — or sign in with a code from a device you’re already signed in on.');
  const accts=((await eth.request({method:'eth_requestAccounts'}))||[]).map(a=>String(a).toLowerCase());
  const acct=accts[0]; if(!/^0x[0-9a-f]{40}$/.test(acct||''))throw new Error('Your wallet didn’t share an account.');
  const st=await socFetch('/'+purpose+'/start',{method:'POST',body:JSON.stringify({address:acct})});
  let signature;
  try{ signature=await eth.request({method:'personal_sign',params:[utf8Hex(st.message),acct]}); }
  catch(e){ throw new Error(e&&e.code===4001?'You cancelled the signature.':'Your wallet couldn’t sign: '+(e&&e.message||e)); }
  return Object.assign(await socFetch('/'+purpose+'/finish',{method:'POST',body:JSON.stringify({nonce:st.nonce,signature})}),{address:acct});
}
function socSignedIn(r){
  COACH.tried=false; COACH.status=null; COACH.msgs=null; PZ_CFG.rev++;
  if(VAULT.mid&&r.me&&r.me.id!==VAULT.mid)vaultForget(); // another profile: its sync isn't this one's
  SOC.key=r.key; try{ localStorage.setItem(SOC_KEY_STORE,r.key); }catch(e){}
  SOC.me=r.me; PZ_CFG.rev++; SOC.share=r.share; SOC.draft=null; SOC.cache={}; SOC.lastSent='';
}
// After signing in on a device: offer the synced journal if there is one, else read the claimed wallet.
async function acctAfterSignIn(){
  let v=null; try{ v=await socFetch('/vault'); }catch(e){}
  if(v&&v.blob&&!VAULT.key){ pzS.unlock=true; pzRender(); return; }
  await acctUseClaimedWallet();
}
async function acctUseClaimedWallet(){
  pzS.unlock=false; pzS.unlockSkip=true;
  const a=SOC.me&&SOC.me.claimedAddress;
  if(a&&!settings.wallets.some(w=>String(w.address).toLowerCase()===a)){ pzNote('Loading your trades…','busy'); $('walletAddr').value=a; await loadAll(); }
  else pzRender();
}

// ---- the encrypted journal ----
async function vaultLoadLocal(){
  try{ const v=JSON.parse(localStorage.getItem(VAULT_STORE)||'null');
    if(v&&v.k&&v.salt&&v.mid&&vaultCan()){ VAULT.key=await crypto.subtle.importKey('raw',unvb64(v.k),{name:'AES-GCM'},true,['encrypt','decrypt']);
      VAULT.salt=v.salt; VAULT.rev=+v.rev||0; VAULT.mid=v.mid; VAULT.dirty=new Map((v.dirty||[]).map(id=>[id,1]));
      VAULT.base=v.base===undefined?vaultSnapS():v.base; VAULT.sGen=v.sDirty?1:0; VAULT.sSent=0; } }catch(e){}
}
async function vaultSaveLocal(){ if(!VAULT.key)return;
  try{ localStorage.setItem(VAULT_STORE,JSON.stringify({k:vb64(await crypto.subtle.exportKey('raw',VAULT.key)),salt:VAULT.salt,rev:VAULT.rev,mid:VAULT.mid,
    dirty:[...VAULT.dirty.keys()].slice(-5000),base:VAULT.base,sDirty:VAULT.sGen!==VAULT.sSent})); }catch(e){} }
function vaultForget(){ clearTimeout(VAULT.timer); VAULT.key=null; VAULT.salt=null; VAULT.rev=0; VAULT.mid=null; VAULT.dirty=new Map(); VAULT.base=null; VAULT.sGen=VAULT.sSent=0; VAULT.err=null;
  try{ localStorage.removeItem(VAULT_STORE); }catch(e){} }
async function vaultDerive(pass, saltB64, iter){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:unvb64(saltB64),iterations:iter||VAULT_ITER,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}
async function vaultSeal(key, salt, obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  return {v:1,iter:VAULT_ITER,salt,iv:vb64(iv),ct:vb64(ct)};
}
async function vaultOpen(key, blob){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unvb64(blob.iv)},key,unvb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
// what travels: the same snapshot backups and the owner's server sync use (wallets, settings, journal)
function vaultPayload(){ return snapshot(); }
// Web Crypto only exists on https (and localhost): elsewhere sync isn't offered
function vaultCan(){ try{ return !!(window.isSecureContext&&window.crypto&&crypto.subtle); }catch(e){ return false; } }
function vaultSnapS(){ const o=_snapS(); o.wallets=JSON.parse(JSON.stringify(settings.wallets||[])); return o; }
function vaultActive(){
  if(SOC.me&&VAULT.mid&&SOC.me.id!==VAULT.mid)vaultForget(); // signed in as someone else now
  return !!(VAULT.key&&SOC.key&&socAvailable()&&!(SRV.token&&!SRV.badAuth)); }
function vaultDirty(){ return VAULT.dirty.size>0||VAULT.sGen!==VAULT.sSent; }
// called on every local save (Store.set / markJEdit)
function vaultMark(id){ if(!VAULT.key)return; if(id==null)VAULT.sGen++; else VAULT.dirty.set(id,(VAULT.dirty.get(id)||0)+1); }
// a restored backup is this device's word on everything: every entry and setting wins the next merge
// prev: the journal before the restore, so entries it removed stay removed too
function vaultMarkAll(prev, journalOnly){ if(!VAULT.key)return;
  for(const id of new Set([...Object.keys(prev||{}),...Object.keys(journal)]))VAULT.dirty.set(id,(VAULT.dirty.get(id)||0)+1);
  if(!journalOnly){ VAULT.base=null; VAULT.sGen++; } vaultSaveLocal(); }
function vaultSchedule(){ if(!vaultActive()||_applying)return; clearTimeout(VAULT.timer); VAULT.timer=setTimeout(()=>vaultPush(),3000); vaultSaveLocal(); }
// Another device's copy, merged: theirs wins, except journal entries edited here since the last push,
// settings fields changed here (against the last synced values), and wallets added or removed here.
async function vaultMerge(d){
  let theirs; try{ theirs=await vaultOpen(VAULT.key,d.blob); }
  catch(e){ vaultForget(); throw new Error('Your sync passphrase was changed on another device. Enter the new one under Social → What you share → Account to keep syncing.'); }
  const mineJ=journal, mine=vaultSnapS(), base=VAULT.base, ids=[...VAULT.dirty.keys()];
  const wBefore=JSON.stringify(settings.wallets);
  const changed=k=>!base||JSON.stringify(mine[k])!==JSON.stringify(base[k]);
  await applySnapshot(theirs);
  const theirsS=vaultSnapS();
  for(const id of ids){ if(mineJ[id]!==undefined)journal[id]=mineJ[id]; else delete journal[id]; }
  for(const k of _SYNC_S_FIELDS)if(changed(k))settings[k]=_syncMerge(k,mine[k],settings[k]);
  const wk=w=>String(w&&w.address).toLowerCase();
  if(!base)settings.wallets=mine.wallets;
  else { const was=new Set((base.wallets||[]).map(wk)), now=new Set(mine.wallets.map(wk));
    const out=theirsS.wallets.filter(w=>!(was.has(wk(w))&&!now.has(wk(w)))); // removed here
    for(const w of mine.wallets)if(!was.has(wk(w))&&!out.some(x=>wk(x)===wk(w)))out.push(w); // added here
    settings.wallets=out; }
  await rawSet(J_KEY,journal); await rawSet(S_KEY,settings);
  // until the merged copy is pushed, what this device changed still counts as changed against theirs
  VAULT.base=theirsS; VAULT.rev=d.rev; await vaultSaveLocal();
  try{ renderWallets(); }catch(e){}
  return JSON.stringify(settings.wallets)!==wBefore;
}
async function vaultPush(){
  if(!vaultActive())return;
  if(VAULT.busy){ VAULT.again=true; return; } VAULT.busy=true;
  try{
    const sentIds=[...VAULT.dirty.entries()], sentS=VAULT.sGen, sentBase=vaultSnapS();
    const blob=await vaultSeal(VAULT.key,VAULT.salt,vaultPayload());
    if(blob.ct.length>6*1024*1024)throw new Error('Your journal is too large to sync ('+(blob.ct.length/1048576).toFixed(1)+' MB; the limit is 6 MB).');
    const r=await fetch('/api/social/vault',{method:'PUT',headers:{'Content-Type':'application/json','X-Pulse-Key':SOC.key},body:JSON.stringify({rev:VAULT.rev,blob})});
    const d=await r.json().catch(()=>null);
    if(!d)throw new Error('The server’s answer didn’t arrive in full. Will retry.');
    if(r.status===409&&!d.blob){ vaultForget(); if(SOC.me)SOC.me.vault=null; pzNote('Your synced journal was deleted from another device, so this one stopped syncing.'); return; }
    if(r.status===409){ // another device saved first: merge its copy, then push again at its revision
      const walletsChanged=await vaultMerge(d); VAULT.again=true;
      if(walletsChanged&&settings.wallets.length)loadAll({auto:true}); else if(PZ)pzRender(); else render();
      return; }
    if(!r.ok)throw new Error(d.error||'HTTP '+r.status);
    VAULT.rev=d.rev; VAULT.err=null;
    for(const [id,c] of sentIds)if(VAULT.dirty.get(id)===c)VAULT.dirty.delete(id);
    VAULT.sSent=sentS; VAULT.base=sentBase; await vaultSaveLocal();
    if(SOC.me&&SOC.me.vault!==undefined)SOC.me.vault={rev:d.rev,size:blob.ct.length,at:d.at};
  }catch(e){ VAULT.err=e.message; if(PZ&&pzTab()==='account')pzRender(); }
  finally{ VAULT.busy=false; if(VAULT.again&&VAULT.key){ VAULT.again=false; clearTimeout(VAULT.timer); VAULT.timer=setTimeout(()=>vaultPush(),500); } }
}
// On open: take a newer copy from another device (merging anything unsent from here), else push what's unsent.
async function vaultSyncOnOpen(signal){
  if(!vaultActive())return false;
  try{ const d=await socFetch('/vault'+(VAULT.rev>0?'?have='+VAULT.rev:''),signal?{signal}:undefined);
    if(!d||!d.member)throw new Error('The server’s answer didn’t arrive in full.');
    if(VAULT.mid&&d.member!==VAULT.mid){ vaultForget(); return false; }
    let walletsChanged=false;
    if(d.unchanged){}
    else if(d.blob&&d.rev!==VAULT.rev)walletsChanged=await vaultMerge(d);
    else if(!d.blob&&VAULT.rev>0){ vaultForget(); VAULT.err=null; pzNote('Your synced journal was deleted from another device, so this one stopped syncing.'); return false; }
    else if(!d.blob){ VAULT.rev=d.rev||0; VAULT.sGen++; } // turned on here but never sent: send it now
    if(vaultDirty())vaultSchedule();
    return walletsChanged;
  }catch(e){ VAULT.err=e.message; if(e.status===401||e.status===403)vaultForget(); return false; }
}
// At startup, before the first load. A slow server is given up on (aborted, so nothing merges late).
async function vaultBoot(){
  await vaultLoadLocal();
  if(!vaultActive())return false;
  const ac=typeof AbortController==='function'?new AbortController():null, tm=ac?setTimeout(()=>ac.abort(),8000):0;
  try{ return await vaultSyncOnOpen(ac&&ac.signal); } finally{ clearTimeout(tm); }
}
// replace: overwrite a copy that's already there (a new passphrase); otherwise refuse to
async function vaultEnable(pass, replace){
  const salt=vb64(crypto.getRandomValues(new Uint8Array(16)));
  const key=await vaultDerive(pass,salt);
  const d=await socFetch('/vault');
  if(d.blob&&!replace){ if(SOC.me)SOC.me.vault={rev:d.rev,size:0,at:d.at};
    throw new Error('Another device turned on sync for this profile. Enter that passphrase to open your synced journal.'); }
  const sentBase=vaultSnapS(), blob=await vaultSeal(key,salt,vaultPayload());
  const r=await socFetch('/vault',{method:'PUT',body:JSON.stringify({rev:d.rev||0,blob})});
  VAULT.key=key; VAULT.salt=salt; VAULT.rev=r.rev; VAULT.mid=d.member||(SOC.me&&SOC.me.id); VAULT.dirty=new Map(); VAULT.base=sentBase; VAULT.sGen=VAULT.sSent=0; VAULT.err=null; await vaultSaveLocal();
  if(SOC.me)SOC.me.vault={rev:r.rev,size:blob.ct.length,at:r.at};
}
// Open the synced copy here. Anything only on this device is kept alongside it (theirs wins per entry).
async function vaultUnlock(pass){
  const d=await socFetch('/vault'); if(!d.blob)throw new Error('There’s no synced journal for this profile yet.');
  const key=await vaultDerive(pass,d.blob.salt,d.blob.iter);
  let data; try{ data=await vaultOpen(key,d.blob); }catch(e){ throw new Error('That passphrase doesn’t open your synced journal.'); }
  const mineJ=journal||{}, mineW=settings.wallets||[];
  await applySnapshot(data);
  VAULT.key=key; VAULT.salt=d.blob.salt; VAULT.rev=d.rev; VAULT.mid=d.member||(SOC.me&&SOC.me.id); VAULT.dirty=new Map(); VAULT.base=vaultSnapS(); VAULT.sGen=VAULT.sSent=0; VAULT.err=null;
  for(const id in mineJ)if(!(id in journal)){ journal[id]=mineJ[id]; VAULT.dirty.set(id,1); }
  for(const w of mineW)if(!settings.wallets.some(x=>String(x.address).toLowerCase()===String(w.address).toLowerCase())){ settings.wallets.push(w); VAULT.sGen++; }
  await rawSet(J_KEY,journal); await rawSet(S_KEY,settings); await vaultSaveLocal();
  if(vaultDirty())vaultSchedule();
  pzS.unlock=false; renderWallets();
  if(settings.wallets.length)await loadAll(); else await acctUseClaimedWallet();
}

// ---- screens ----
// On the first-run screen: already a member elsewhere? Sign in, or open your synced journal.
// a signed-in member with a synced journal they haven't opened on this device
function acctWantsUnlock(){ return !!(SOC.me&&!VAULT.key&&vaultCan()&&!(SRV.token&&!SRV.badAuth)&&(pzS.unlock||(!pzS.unlockSkip&&SOC.me.vault&&SOC.me.vault.rev&&SOC.me.vaultOn))); }
// the owner sent a sign-in link: one tap to sign in, wherever the member lands
function pzLinkCardHtml(){
  if(!pzS.linkCode||SOC.me||!socAvailable()||!SOC.cfg||!SOC.cfg.enabled)return '';
  return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px">You’ve been invited to the league</b>
    <p class="pz-sub" style="font-size:13px">The league owner made a profile for you. Sign in with your code to pick it up on this device.</p>
    <div class="pz-field"><label for="socLinkIn" style="font-size:13px">Sign-in code</label><input type="text" id="socLinkIn" maxlength="14" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" value="${esc(pzS.linkCode)}"></div>
    <button type="button" class="pz-cta" id="socLinkGo">Sign in</button></section>`;
}
function acctConnectHtml(){
  if(!socAvailable()||!SOC.cfg||!SOC.cfg.enabled||(SRV.token&&!SRV.badAuth))return '';
  if(acctWantsUnlock())return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px;text-align:left"><b style="font-size:15px">Welcome back, @${esc(SOC.me.handle)}</b>
    <p class="pz-sub" style="font-size:13px">Your journal is synced. Enter your sync passphrase to open it on this device.</p>
    <div class="pz-field"><label for="vaultPass" style="font-size:13px">Sync passphrase</label><input type="password" id="vaultPass" autocomplete="current-password"></div>
    <button type="button" class="pz-cta" id="vaultUnlock">Open my journal</button><button type="button" class="pz-ghost pz-sm" id="vaultSkip">Skip — start without it</button></section>`;
  if(SOC.me){ const a=SOC.me.claimedAddress, known=a&&settings.wallets.some(w=>String(w.address).toLowerCase()===a);
    return `<p class="pz-fine">Signed in as @${esc(SOC.me.handle)}.${a?'':' Add your wallet address above to load your trades.'}</p>${a&&!known?`<button type="button" class="pz-ghost" id="acctLoadClaimed">Load my claimed wallet (${esc(walletShort(a))})</button>`:''}`; }
  return `<details class="pz-acct"${pzS.acctOpen?' open':''}><summary class="pz-fine" style="cursor:pointer">Already use Pulse on another device? Sign in</summary>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
    ${pkAvailable()?'<button type="button" class="pz-ghost" id="socPkLogin">Sign in with a passkey</button><p class="pz-fine">Face ID, a fingerprint or your device PIN — once you’ve added a passkey under Account on a signed-in device.</p>':''}
    ${SOC.cfg.claims?'<button type="button" class="pz-ghost" id="socWalletLogin">Sign in with my wallet</button><p class="pz-fine">Works once you’ve claimed your wallet. It’s a signature, not a transaction — nothing moves.</p>':''}
    <div class="pz-field"><label for="socLinkIn" style="font-size:13px">Or enter a code from a signed-in device</label><input type="text" id="socLinkIn" maxlength="14" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="e.g. K7Q2M9XW4P" value="${esc(pzS.linkCode||'')}">
      <button type="button" class="pz-ghost pz-sm" id="socLinkGo">Sign in with code</button></div>
    <p class="pz-fine">Get a code on your other device under Social → What you share → Account → Add a device.</p></div></details>`;
}
function socClaimCardHtml(){
  if(!SOC.cfg||!SOC.cfg.claims)return '';
  const me=SOC.me;
  if(me.claimed)return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${pzI('shield',18)}Wallet claimed</b>
    <p class="pz-sub" style="font-size:13px"><code>${esc(walletShort(me.claimedAddress||''))}</code> is locked to @${esc(me.handle)}. Nobody else can use it here, your boards show a ✓, and you can sign in with it on any device. Only a signature from this wallet can move it.</p>
    <button type="button" class="pz-ghost pz-sm" id="socUnclaim">Release this wallet</button></section>`;
  return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${pzI('shield',18)}Claim your wallet</b>
    <p class="pz-sub" style="font-size:13px">Prove a wallet is yours by signing a short message with it. It’s a signature, not a transaction: no gas, nothing moves. A claimed wallet is locked to your profile, gets a ✓ on the boards${me.requireClaim?' (this league only counts claimed wallets for verified Discipline and returns)':''}, and lets you sign in on any device. The server owner can see the address.</p>
    <button type="button" class="pz-ghost" id="socClaim">Claim with my wallet</button>
    <p class="pz-fine">Signs with the account selected in your browser wallet (MetaMask, Rabby…). On a phone, open this page in your wallet app’s browser.</p></section>`;
}
// ---- passkeys: Face ID / fingerprint / security key sign-in (server side: webauthn.js) ----
function pkAvailable(){ return !!(typeof window!=='undefined'&&window.PublicKeyCredential&&navigator.credentials&&window.isSecureContext&&SOC.cfg&&SOC.cfg.passkeys); }
const pkBuf=s=>Uint8Array.from(atob(String(s).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const pkB64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function pkJSON(c){ const r=c.response, o={id:c.id,rawId:pkB64u(c.rawId),type:c.type,response:{clientDataJSON:pkB64u(r.clientDataJSON)}};
  if(r.attestationObject)o.response.attestationObject=pkB64u(r.attestationObject);
  if(r.authenticatorData){ o.response.authenticatorData=pkB64u(r.authenticatorData); o.response.signature=pkB64u(r.signature); o.response.userHandle=r.userHandle?pkB64u(r.userHandle):null; }
  return o; }
// a short label for a new passkey: the kind of device it was made on
function pkDeviceName(){ const u=navigator.userAgent||''; return /iPhone/.test(u)?'iPhone':/iPad/.test(u)?'iPad':/Android/.test(u)?'Android':/Mac/.test(u)?'Mac':/Windows/.test(u)?'Windows':/Linux/.test(u)?'Linux':'This device'; }
async function pkAdd(){
  const o=await socFetch('/passkey/register/start',{method:'POST'});
  const cred=await navigator.credentials.create({publicKey:{...o,challenge:pkBuf(o.challenge),user:{...o.user,id:pkBuf(o.user.id)},excludeCredentials:(o.excludeCredentials||[]).map(c=>({...c,id:pkBuf(c.id)}))}});
  return socFetch('/passkey/register/finish',{method:'POST',body:JSON.stringify({credential:pkJSON(cred),name:pkDeviceName()})});
}
async function pkLogin(){
  const o=await socFetch('/passkey/login/start',{method:'POST'});
  const cred=await navigator.credentials.get({publicKey:{challenge:pkBuf(o.challenge),rpId:o.rpId,timeout:o.timeout,userVerification:o.userVerification}});
  return socFetch('/passkey/login/finish',{method:'POST',body:JSON.stringify({credential:pkJSON(cred)})});
}
function socPasskeysCardHtml(){
  if(!SOC.cfg||!SOC.cfg.passkeys)return '';
  const me=SOC.me, list=me.passkeys||[];
  return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${pzI('shield',18)}Passkeys</b>
    <p class="pz-sub" style="font-size:13px">Sign in on any device with Face ID, a fingerprint or your device PIN — no code, no wallet. ${list.length?'':'Add one here and it syncs through your phone’s or computer’s password manager.'}</p>
    ${list.map(k=>`<div class="pz-wl"><span>${esc(k.name)} <span class="pz-fine">· added ${esc(socAgo(k.at))}${k.lastUsed?' · last used '+esc(socAgo(k.lastUsed)):''}</span></span><button type="button" class="pz-ghost pz-sm" data-pk-del="${esc(k.id)}" aria-label="Remove passkey ${esc(k.name)}">Remove</button></div>`).join('')}
    ${pkAvailable()?'<button type="button" class="pz-ghost pz-sm" id="socPkAdd">Add a passkey on this device</button>':'<p class="pz-fine">This browser can’t make passkeys here (they need a secure https page and a recent browser).</p>'}</section>`;
}
function socDevicesCardHtml(){
  const me=SOC.me, L=SOC.link&&SOC.link.exp>Date.now()?SOC.link:null;
  return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px">Your devices</b>
    <p class="pz-sub" style="font-size:13px">Signed in on ${me.devices||1} device${(me.devices||1)===1?'':'s'}. On a new device, sign in with ${[(me.passkeys||[]).length?'a passkey':'',me.claimed?'your wallet':''].filter(Boolean).join(' or ')||'a one-time code from here'}${(me.passkeys||[]).length||me.claimed?', or a one-time code from here':''}.</p>
    ${L?`<div class="pz-code" aria-live="polite"><b style="font-family:var(--pz-num);font-size:26px;letter-spacing:.12em">${esc(L.code.slice(0,5)+' '+L.code.slice(5))}</b><span class="pz-fine">On the other device open Pulse, choose “Already use Pulse on another device?” and enter this code. It works once, for 10 minutes.</span></div>`
      :'<button type="button" class="pz-ghost pz-sm" id="socLinkNew">Add a device</button>'}
    ${(me.devices||1)>1?'<button type="button" class="pz-ghost pz-sm" id="socSignOutOthers">Sign out other devices</button>':''}</section>`;
}
function socVaultCardHtml(){
  const me=SOC.me;
  if(!me.vaultOn&&!VAULT.key)return '';
  if(!vaultCan())return `<section class="pz-card"><b style="font-size:15px">Your journal on every device</b><p class="pz-sub" style="font-size:13px;margin-top:6px">Encrypted sync needs a secure (https) connection. Open Pulse from its https address to turn it on.</p></section>`;
  if(VAULT.key)return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${pzI('check',16)}Journal sync is on</b>
    <p class="pz-sub" style="font-size:13px">Your journal, wallets and settings are encrypted on this device before they’re sent, so the server stores only scrambled data. On another device, sign in and enter your sync passphrase.</p>
    ${VAULT.err?`<p class="pz-fine pz-err" role="alert">Last sync failed: ${esc(VAULT.err)}</p>`:me.vault&&me.vault.at?`<p class="pz-fine">Last synced ${socAgo(me.vault.at)}${me.vault.at>Date.now()-60000?'':' ago'}.</p>`:''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="pz-ghost pz-sm" id="vaultOff">Stop syncing on this device</button><button type="button" class="pz-ghost pz-sm" id="vaultDelete" style="color:var(--pz-err-t);border-color:var(--pz-err-b)">Delete the synced copy</button></div></section>`;
  const has=!!(me.vault&&me.vault.rev);
  return `<section class="pz-card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px">Your journal on every device</b>
    <p class="pz-sub" style="font-size:13px">${has?'This profile has a synced journal. Enter its passphrase to open it here — anything only on this device is kept too.'
      :'Choose a sync passphrase. Your journal, wallets and settings are encrypted on this device before they leave it: the server, and its owner, can’t read them. There’s no reset — lose the passphrase and the synced copy can’t be opened.'}</p>
    <div class="pz-field"><label for="vaultPass" style="font-size:13px">Sync passphrase</label><input type="password" id="vaultPass" autocomplete="${has?'current-password':'new-password'}" placeholder="${has?'':'at least 10 characters'}"></div>
    ${has?'<button type="button" class="pz-ghost" id="vaultUnlock">Open my synced journal</button><button type="button" class="pz-ghost pz-sm" id="vaultReplace">Replace it with this device’s journal (new passphrase)</button>'
      :'<div class="pz-field"><label for="vaultPass2" style="font-size:13px">Type it again</label><input type="password" id="vaultPass2" autocomplete="new-password"></div><button type="button" class="pz-ghost" id="vaultOn">Turn on journal sync</button>'}</section>`;
}

// ---- actions (from socAction) ----
async function acctAction(t){
  const done=(m,kind)=>{ if(m)pzNote(m,kind); socStale(); pzRender(); };
  const pass=()=>{ const el=$('vaultPass'), v=el?el.value:''; return v; };
  const clearPass=()=>{ for(const id of ['vaultPass','vaultPass2']){ const el=$(id); if(el)el.value=''; } };
  if(t.dataset&&t.dataset.pkDel){ if(!confirm('Remove this passkey? You won’t be able to sign in with it here any more.'))return true;
    const r=await socFetch('/passkey/'+encodeURIComponent(t.dataset.pkDel),{method:'DELETE'}); SOC.me=r.me; done('Passkey removed.'); return true; }
  switch(t.id){
    case 'socPkAdd': { pzNote('Follow your device’s prompt…','busy');
      try{ const r=await pkAdd(); SOC.me=r.me; done('Passkey added. On another device, choose “Sign in with a passkey”.'); }
      catch(e){ if(e&&e.name==='NotAllowedError'){ pzNote('Cancelled.'); return true; } if(e&&e.name==='InvalidStateError'){ pzNote('This device already has a passkey for your profile.','err'); return true; } throw e; }
      return true; }
    case 'socPkLogin': { pzS.acctOpen=true; pzNote('Follow your device’s prompt…','busy');
      let r; try{ r=await pkLogin(); }catch(e){ if(e&&e.name==='NotAllowedError'){ pzNote('Cancelled.'); return true; } throw e; }
      socSignedIn(r); pzNote('Signed in as @'+r.me.handle+'.'); await acctAfterSignIn(); return true; }
    case 'socClaim': { pzNote('Waiting for your wallet…','busy'); const r=await socWalletSign('claim'); SOC.me=r.me; PZ_CFG.rev++; SOC.share=r.share; SOC.draft=null;
      const known=settings.wallets.some(w=>String(w.address).toLowerCase()===r.address);
      done('Claimed '+walletShort(r.address)+'. It’s locked to your profile.'+(known?'':' It isn’t one of the wallets Pulse reads — add it in Settings to see its trades.')); return true; }
    case 'socUnclaim': { if(!confirm('Release this wallet? Anyone could name it again, and you’d lose wallet sign-in until you claim it again.'))return true;
      const r=await socFetch('/claim/release',{method:'POST'}); SOC.me=r.me; PZ_CFG.rev++; done('Wallet released.'); return true; }
    case 'socWalletLogin': { pzS.acctOpen=true; pzNote('Waiting for your wallet…','busy'); const r=await socWalletSign('login'); socSignedIn(r);
      pzNote('Signed in as @'+r.me.handle+'.'); await acctAfterSignIn(); return true; }
    case 'socLinkGo': { pzS.acctOpen=true; const c=($('socLinkIn')||{value:''}).value.trim(); if(!c)return true;
      const r=await socFetch('/link/finish',{method:'POST',body:JSON.stringify({code:c})}); socSignedIn(r); pzS.linkCode=null; if($('socLinkIn'))$('socLinkIn').value='';
      pzNote('Signed in as @'+r.me.handle+'.'); await acctAfterSignIn(); return true; }
    case 'socLinkNew': { const r=await socFetch('/link/start',{method:'POST'}); SOC.link={code:r.code,exp:r.expiresAt};
      setTimeout(()=>{ if(SOC.link&&SOC.link.code===r.code){ SOC.link=null; if(pzTab()==='account')pzRender(); } },10*60000); pzRender(); return true; }
    case 'socSignOutOthers': { if(!confirm('Sign out every other device? They’ll need your wallet or a new code to sign back in.'))return true;
      const r=await socFetch('/devices',{method:'DELETE'}); SOC.me=r.me; PZ_CFG.rev++; SOC.link=null; done('Other devices are signed out.'); return true; }
    case 'vaultOn': { const p=pass(), p2=($('vaultPass2')||{value:''}).value;
      if(p.length<10){ pzNote('Use at least 10 characters — a few words you’ll remember works well.','err'); return true; }
      if(p!==p2){ pzNote('The two passphrases don’t match.','err'); return true; }
      pzNote('Encrypting your journal…','busy');
      try{ await vaultEnable(p); }catch(e){ pzRender(); throw e; }
      clearPass(); done('Journal sync is on. Keep your passphrase safe: there’s no reset.'); return true; }
    case 'vaultReplace': { const p=pass(); if(p.length<10){ pzNote('Type a new passphrase of at least 10 characters first.','err'); return true; }
      if(!confirm('Replace the synced journal with this device’s journal, under this new passphrase? Other devices will need the new passphrase.'))return true;
      pzNote('Encrypting your journal…','busy'); await vaultEnable(p,true); clearPass(); done('Synced journal replaced.'); return true; }
    case 'vaultUnlock': { const p=pass(); if(!p)return true; pzNote('Opening your journal…','busy');
      await vaultUnlock(p); clearPass(); pzNote('Your journal is open on this device and syncs from here on.'); socStale(); pzRender(); return true; }
    case 'vaultSkip': case 'acctLoadClaimed': await acctUseClaimedWallet(); return true;
    case 'vaultOff': vaultForget(); done('This device stopped syncing. The synced copy is still on the server.'); return true;
    case 'vaultDelete': { if(!confirm('Delete the synced copy from the server? This device keeps its journal; other devices stop syncing.'))return true;
      await socFetch('/vault',{method:'DELETE'}); vaultForget(); if(SOC.me)SOC.me.vault=null; done('Synced copy deleted.'); return true; }
  }
  return false;
}
