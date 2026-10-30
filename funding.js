'use strict';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>v==null||!Number.isFinite(+v)?'—':new Intl.NumberFormat('it-IT',{maximumFractionDigits:d,minimumFractionDigits:d}).format(+v);
const money=v=>fmt(v)+' USDP',pct=v=>fmt(v,3)+'%',color=v=>v>0?'positive':v<0?'negative':'';
const date=t=>t?new Date(t).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const labels={hedged:'Copertura a fattori',patient:'Paper paziente',leveraged:'Candidato V2',ar1:'AR(1) · 6 ore',neutral:'Neutrale',aggressive:'Aggressivo',directional:'Direzionale',carry_ewma:'Funding coperto · EWMA 24h',carry_ar1:'Funding coperto · AR(1) 24h'};
const colors={leveraged:'#7654cb',ar1:'#2f8f9b',hedged:'#2f8f9b',patient:'#d29539',neutral:'#538772',aggressive:'#525fba',directional:'#bb708c',live:'#182232',carry_ewma:'#2f8f9b',carry_ar1:'#d29539'};
let data=null,selected='leveraged',asset='pas:ETH',unit='net_pnl',hours=0;
function kpi(label,value,sub='',cls=''){return `<div class="kpi"><label>${esc(label)}</label><strong class="${cls}">${esc(value)}</strong><small>${esc(sub)}</small></div>`}
function dl(rows){return rows.map(([a,b])=>`<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}
function stage(s){return ({not_started:'Non avviato',stopped:'Fermo',failed:'Errore',ready:'Pronto',blocked:'Da verificare',paper_running:'Paper attivo',running:'Attivo',read_only_plan:'Solo lettura',stale:'Dati in ritardo',starting:'In avvio',degraded:'Letture in recupero'})[s]||s||'—'}
// Freshness uses HTTP server time and monotonic elapsed time, never the viewer's clock.
let sourceFreshness={generated:null,observedAt:0,ageAtObservation:0,confirmed:false};
function observeSource(payload,httpDate,cacheControl){
 const now=performance.now(),serverTime=Date.parse(httpDate||'');
 const changed=sourceFreshness.generated!==payload.generated_ms;
 const progressed=sourceFreshness.generated!=null&&payload.generated_ms>sourceFreshness.generated;
 if(changed)sourceFreshness={generated:payload.generated_ms,observedAt:now,ageAtObservation:0,confirmed:progressed};
 const maxAge=/max-age=(\d+)/i.exec(cacheControl||'');
 sourceFreshness.budget=Math.max(180000,Math.min(300000,maxAge?Number(maxAge[1])*1000:0)+120000);
 if(Number.isFinite(serverTime)){
  sourceFreshness.ageAtObservation=Math.max(0,serverTime-payload.generated_ms);
  sourceFreshness.observedAt=now;sourceFreshness.confirmed=true;
 }
}
function sourceProblem(unavailable){
 if(unavailable)return 'Aggiornamento della pagina non riuscito. Lo stato del processo non risulta ricontrollato.';
 if(!Number.isFinite(data.generated_ms))return 'Timestamp della fonte mancante o non valido.';
 if(!sourceFreshness.confirmed)return 'Verifica della freschezza in corso: attendo il prossimo campione pubblicato.';
 if(sourceFreshness.ageAtObservation+performance.now()-sourceFreshness.observedAt>(sourceFreshness.budget||180000))return 'La fonte non avanza oltre il ritardo di cache previsto: lo stato mostrato potrebbe essere cambiato.';
 return null;
}
function renderSupervisor(unavailable=false){
 const s=data.supervisor||{},freshnessIssue=sourceProblem(unavailable),publicationOld=!!freshnessIssue;
 const initialVerification=!unavailable&&!sourceFreshness.confirmed&&Number.isFinite(data.generated_ms)&&performance.now()-sourceFreshness.observedAt<=(sourceFreshness.budget||180000);
 const state=publicationOld?(initialVerification&&s.worker_alive===true?'checking_updates':'unverified'):(s.state||'unknown');
 const names={checking_updates:'Attivo all’ultima lettura',waiting:'Attivo · in attesa',reviewing:'Verifica in corso',stopped:'Fermo',stopping:'Arresto in corso',failed:'Processo non attivo',overdue:'Controllo in ritardo',degraded:'Ultimo controllo con problemi',unverified:'Stato non verificabile',not_started:'Non avviato',starting:'In avvio',unknown:'Stato non disponibile'};
 const tone=['failed','overdue'].includes(state)?'error':['degraded','unverified','checking_updates'].includes(state)?'warn':['waiting','reviewing'].includes(state)?'ok':'neutral';
 const notes={checking_updates:'Il processo risulta attivo nel campione ricevuto. Attendo il prossimo aggiornamento del sito per confermare che la pubblicazione continui.',waiting:'Il processo è attivo. L’attesa tra due controlli è normale.',reviewing:'GPT sta analizzando lo stato e i sorgenti del sistema.',stopped:'Il supervisore è fermo. Il trader ha un processo e uno stato separati.',stopping:'È stato richiesto lo stop del solo supervisore.',failed:'Il processo atteso non risulta attivo: nessuna nuova revisione è garantita.',overdue:'La revisione non è partita o non è terminata entro il tempo previsto.',degraded:'Il processo è attivo, ma l’ultima revisione richiede attenzione.',unverified:freshnessIssue||'Impossibile confermare lo stato del processo.',not_started:'Nessun avvio registrato per il supervisore.',starting:'Avvio del supervisore in corso.',unknown:'La fonte non fornisce ancora lo stato del supervisore.'};
 const actions={none:'Nessun intervento necessario',restart_trader:'Ripresa del trader',repair_and_restart:'Correzione e ripresa',restart_helpers:'Ripristino servizi',report_only:'Segnalazione senza intervento'};
 const outcomes={complete:'Completato',blocked_or_failed:'Bloccato o fallito',started:'In corso'};
 const issues={process_not_running:'Processo assente: il supervisore non sta eseguendo i controlli.',process_unverified:'Accesso ai metadati del processo non disponibile.',clock_mismatch:'Timestamp incoerente: verificare l’orologio del PC.',review_overdue:'Scadenza del controllo superata.',tests_failed:'La correzione proposta non ha superato i test e non è stata applicata.',source_conflict:'I sorgenti sono cambiati durante la revisione: nessuna sovrascrittura automatica.',reconciliation_failed:'Riconciliazione del conto non completata: riavvio non autorizzato dal controller.',model_unavailable:'Revisione GPT non disponibile: verificare accesso, quota o runtime.',review_timeout:'La revisione ha superato il tempo massimo.',manual_stop:'Uno stop manuale impedisce il riavvio automatico.',scope_rejected:'La correzione proposta è fuori dall’ambito automatico.',restart_failed:'Il riavvio non è stato confermato: serve verificare la sessione.',review_failed:'Il ciclo non è riuscito a completare tutti i controlli.',review_inconclusive:'La revisione segnala un problema che non ha potuto verificare o correggere automaticamente.',review_warning:'L’ultima revisione contiene una segnalazione da controllare.'};
 $('supervisor-badge').className='pill supervisor-pill '+tone;$('supervisor-badge').textContent='Supervisore · '+(names[state]||state);
 $('supervisor-state').className='supervisor-state '+tone;$('supervisor-state').textContent=names[state]||state;
 $('supervisor-summary').textContent=(s.model==='gpt-6.1-sol'?'GPT‑6.1 Sol'+(s.reasoning_effort?' · '+(s.reasoning_effort==='low'?'Light':s.reasoning_effort):'')+' · ':'')+(notes[state]||'');
 const metrics=[['Ultimo controllo completato',date(s.last_review_ms)],['Prossimo controllo',date(s.next_review_ms)],['Ultimo esito',outcomes[s.last_outcome]||'—'],['Ultima azione',actions[s.last_action]||'—']];
 $('supervisor-metrics').innerHTML=metrics.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
 const issue=$('supervisor-issue');issue.hidden=!s.issue;issue.textContent=issues[s.issue]||'Segnalazione da verificare.';issue.className='small supervisor-issue '+(tone==='error'?'negative':'');
 const yes=v=>v===true?'Sì':v===false?'No':'Non registrato';
 $('supervisor-details').innerHTML=dl([['Processo verificato attivo',yes(s.worker_alive)],['Frequenza',s.interval_seconds?fmt(s.interval_seconds/60,0)+' minuti':'—'],['Thread dedicato indipendente',s.independent_thread?'Verificato':'Non verificato'],['Stato operativo aggiornato',date(s.updated_ms)],['File corretti nell’ultimo ciclo',s.last_review_ms?fmt(s.changed_files_count,0):'—'],['Test della correzione',s.tests_passed==null?'Nessuna correzione testata nel ciclo':s.tests_passed?'Superati':'Falliti'],['Trader riavviato nell’ultimo ciclo',s.last_review_ms?yes(s.trader_restarted):'—'],['Report notificato su Telegram',yes(s.telegram_notified)]]);
}
function chart(id,series,field,kind='money'){
 const el=$(id),W=Math.max(el.clientWidth,300),H=el.clientHeight,L=66,R=18,T=18,B=34;
 const cutoff=hours?Date.now()-hours*3600000:0;
 series=series.map(s=>({...s,points:s.points.filter(p=>p.time>=cutoff&&p[field]!=null)}));
 const all=series.flatMap(s=>s.points);
 if(!all.length){el.innerHTML='<div class="empty">Nessun campione disponibile nella finestra</div>';return}
 let xmin=Math.min(...all.map(p=>p.time)),xmax=Math.max(...all.map(p=>p.time));if(xmin===xmax)xmax=xmin+60000;
 let ymin=Math.min(0,...all.map(p=>p[field])),ymax=Math.max(0,...all.map(p=>p[field]));let pad=(ymax-ymin)*.12||1;ymin-=pad;ymax+=pad;
 const x=t=>L+(t-xmin)/(xmax-xmin)*(W-L-R),y=v=>T+(ymax-v)/(ymax-ymin)*(H-T-B);
 const show=v=>kind==='rate'?fmt(v,4)+'%':kind==='percent'?fmt(v,2)+'%':fmt(v,1);
 let svg=`<svg viewBox="0 0 ${W} ${H}" aria-label="Serie temporali">`;
 for(let i=0;i<=4;i++){let v=ymin+(ymax-ymin)*i/4,yy=y(v);svg+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e9eaf2"/><text x="${L-9}" y="${yy+4}" text-anchor="end" fill="#7a8195" font-size="11">${esc(show(v))}</text>`}
 svg+=`<line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="#bdc0ce" stroke-dasharray="4 4"/>`;
 for(let i=0;i<=3;i++){let t=xmin+(xmax-xmin)*i/3;svg+=`<text x="${x(t)}" y="${H-8}" text-anchor="middle" fill="#7a8195" font-size="10">${esc(new Date(t).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}))}</text>`}
 for(const s of series){if(!s.points.length)continue;let points=s.points.map(p=>`${x(p.time)},${y(p[field])}`).join(' ');svg+=`<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round"/>`;const p=s.points.at(-1);svg+=`<circle cx="${x(p.time)}" cy="${y(p[field])}" r="3.5" fill="${s.color}"/>`}
 el.innerHTML=svg+'</svg>';
 el.onmousemove=e=>{let t=xmin+Math.max(0,Math.min(1,(e.offsetX-L)/(W-L-R)))*(xmax-xmin),rows=[];
 for(const s of series){if(!s.points.length)continue;const p=s.points.reduce((a,b)=>Math.abs(a.time-t)<Math.abs(b.time-t)?a:b);rows.push(`${s.name}: ${show(p[field])}`)}
 const tip=$('tooltip');tip.textContent=date(t)+'\n'+rows.join('\n');tip.hidden=false;tip.style.left=Math.min(e.clientX+15,window.innerWidth-240)+'px';tip.style.top=(e.clientY+15)+'px'};
 el.onmouseleave=()=>{$('tooltip').hidden=true};
}
function render(){if(!data)return;const a=data.account,lh=data.live_health,ph=data.paper_health;
 renderSupervisor();
 $('updated').textContent='Fonte: '+date(a.asof_ms);
 const stale=(a.age_seconds??Infinity)>180;const banner=$('banner');banner.className='notice'+(stale?' warn':lh.state==='failed'?' error':'');
 banner.textContent=stale?'Dati in ritardo: sono mostrati gli ultimi valori disponibili.':lh.trading_enabled?(lh.state==='running'?'Trader testnet attivo · '+data.dex+' · monitoraggio del conto reale della competizione.':'Automazione live: '+stage(lh.state)+'. Verificare le posizioni del conto; un arresto non implica che siano chiuse.'):'Trading sul conto non avviato. '+stage(ph.state)+' · preparazione live '+(data.preflight.ready?'verificata':'da riconfermare')+'.';
 $('account-kpis').innerHTML=kpi('Saldo del conto',money(a.balance),'USDP effettivi')+kpi('Valore conto unified',money(a.equity),'PnL aperto incluso nel saldo USDP')+kpi('Nozionale lordo conto',money(a.gross_notional),'Somma delle esposizioni assolute')+kpi('Leva effettiva conto',fmt(a.effective_leverage,2)+'×','Nozionale / equity')+kpi('Funding conto · 24h',money(a.funding_24h),'Pagamenti letti: '+date(a.payments_asof_ms),color(a.funding_24h))+kpi('Margine utilizzato',money(a.margin_used),'Dalle posizioni del conto');
 $('live-summary').innerHTML=dl([['Trader sul conto',lh.trading_enabled?stage(lh.state):'Non avviato'],['Ottimizzazione',lh.optimization_state==='ready'?'Pronta':('Bloccata: '+(lh.optimization_reason||'da verificare'))],['Modello prezzi',({none:'Solo funding',momentum:'Momentum sperimentale',reversal:'Reversal sperimentale',ridge:'Ridge prezzi + funding'})[lh.alpha_method]||'Solo funding'],['Scenario PnL prezzi',money(lh.expected_price_pnl_scenario)],['PnL sessione live',money(a.session_pnl)],['Funding sessione live',money(a.funding_session)],['Ordini aperti',a.open_orders??'—'],['Account',a.account_mode],['API wallet autorizzato',a.api_approved?'Sì':'Non verificato'],['Ultimo controllo conto',date(a.asof_ms)],['Aggiornamento sito',({publishing:'Pubblicazione attiva',retrying:'Riprova dopo errore',failed:'Errore',stopped:'Fermo'})[data.publication?.stage]||'—']]);
 const series=data.papers.map(p=>({name:labels[p.name]||p.name,color:colors[p.name],points:data.paper_history.filter(x=>x.profile===p.name)}));if(data.live_history.length)series.unshift({name:'Conto live',color:colors.live,points:data.live_history});
 chart('equity-chart',series,unit,unit==='return_percent'?'percent':'money');$('chart-legend').innerHTML=series.map(s=>`<span style="--series-color:${s.color}">${esc(s.name)}</span>`).join('');
 $('paper-cards').innerHTML=data.papers.map(p=>`<div class="paper-card" style="--series-color:${colors[p.name]}"><span class="tag">PAPER</span>${esc(labels[p.name]||p.name)}<strong class="${color(p.metrics.net_pnl)}">${money(p.metrics.net_pnl)}</strong><div class="detail"><span>Rendimento netto</span><b>${pct(p.metrics.return_percent)}</b></div><div class="detail"><span>Funding stimato incassato</span><span>${money(p.metrics.estimated_funding)}</span></div><div class="detail"><span>Commissioni</span><span>${money(p.metrics.fees)}</span></div><div class="detail"><span>Esposizione / leva effettiva</span><span>${fmt(p.gross_notional,0)} / ${fmt(p.effective_leverage)}×</span></div>${p.carry_criteria?`<div class="detail"><span>Coppie ammesse / esaminate</span><span>${fmt(p.pair_admissible_count,0)} / ${fmt(p.pair_candidate_count,0)}</span></div><div class="detail"><span>Funding prudente / costi</span><span>${fmt(p.max_robust_carry_cost_ratio,3)}x - soglia ${fmt(p.carry_criteria.cost_multiple,2)}x</span></div>`:""}</div>`).join('');
 const select=$('portfolio-source'),old=select.value||selected;select.innerHTML='<option value="live">Conto testnet</option>'+data.papers.map(p=>`<option value="${p.name}">${esc(labels[p.name]||p.name)} · PAPER</option>`).join('');select.value=[...select.options].some(o=>o.value===old)?old:'live';selected=select.value;
 const assetSelect=$('asset');assetSelect.innerHTML=data.markets.map(m=>`<option value="${m.coin}">${m.coin.slice(4)}</option>`).join('');assetSelect.value=asset;if(!assetSelect.value)assetSelect.selectedIndex=0;asset=assetSelect.value;
 $('markets-table').innerHTML=data.markets.map(m=>`<tr><td>${m.coin.slice(4)}</td><td>${fmt(m.funding*100,5)}%</td><td>${fmt(m.funding_last_24h*100,4)}%</td><td class="${color(-m.funding)}">${fmt(-10000*m.funding,3)}</td><td>${fmt(m.bid,4)}</td><td>${fmt(m.ask,4)}</td><td>${fmt(m.spread_bps,2)}</td><td>${fmt(m.basis_bps,2)}</td><td class="${m.stale?'negative':''}">${fmt(m.age_seconds,0)} s</td></tr>`).join('');
 const checkLabels={testnet_scope:'Endpoint testnet e DEX pas',account_mode:'Modalità unified',api_approval:'Autorizzazione API valida',api_credential:'Credenziale cifrata leggibile',flat_account:'Conto inizialmente senza posizioni',no_open_orders:'Assenza di ordini aperti',data_fresh:'Dati di mercato disponibili',no_unresolved_basket:'Nessun basket da riconciliare',signer_available:'Signer non usato da altri trader',configuration:'Configurazione V2 verificata'};
 $('preflight-title').textContent=(data.preflight.ready?'Pronto per avvio esplicito':!data.preflight.fresh?'Preflight da aggiornare prima dell’avvio':'Controlli da completare')+' · '+date(data.preflight.asof_ms);
 $('checks').innerHTML=dl(Object.entries(checkLabels).map(([k,v])=>[v,data.preflight.checks[k]===true?'OK':data.preflight.checks[k]===false?'NON PRONTO':'—']));
 const cfg=data.live_configuration;$('live-config').innerHTML=dl([['Orizzonte economico',fmt(cfg.horizon_hours,0)+' ore'],['Finestra di ribilanciamento',fmt(cfg.rebalance_seconds/3600,0)+' ore'],['Nozionale lordo massimo',fmt(cfg.gross_leverage,1)+'× equity'],['Capacità massima teorica',money(a.equity==null?null:a.equity*cfg.gross_leverage)],['Budget margine massimo',pct(cfg.max_margin_fraction*100)],['Stop drawdown',pct(cfg.drawdown_stop_fraction*100)],['Limite esposizione fattori',pct(cfg.max_factor_exposure*100)],['Buffer aggiuntivo costi',fmt(cfg.incremental_cost_buffer,1)+'×'],['Trend osservato',fmt(cfg.entry_trend_hours,0)+' ore']]);
 $('paper-configs').innerHTML=data.papers.map(p=>`<details><summary>${esc(labels[p.name]||p.name)}</summary><dl>${dl([['Orizzonte',fmt(p.configuration.horizon_hours,0)+' ore'],['Ribilanciamento',fmt(p.configuration.rebalance_seconds/3600,0)+' ore'],['Prossima finestra',date(p.next_rebalance_ms)],['Funding pianificato',money(p.expected_funding)],['Costi pianificati',money(p.estimated_costs)],['Netto atteso prima del prezzo',money(p.expected_net)],['Stress perdita stimata',money(p.stress_loss)],['Proposta eseguibile nel modello',p.plan_ready?'Sì':'No'],['Filtro costi intervenuto',p.cost_gate_rejected?'Sì':'No']])}</dl></details>`).join('');
 $('refresh-info').textContent=location.hostname==='127.0.0.1'||location.hostname==='localhost'?'Vista aggiornata ogni 5 s; fonte circa ogni minuto.':'Pubblicazione numerica ogni minuto; ritardo di rete possibile.';
 renderPortfolio();renderMarket();}
function renderPortfolio(){const a=data.account,p=data.papers.find(p=>p.name===selected),isLive=selected==='live';const rows=isLive?a.positions:(p?.positions||[]),eq=isLive?a.equity:p?.metrics.equity,gross=isLive?a.gross_notional:p?.gross_notional;
 const flow=rows.reduce((s,r)=>{const m=data.markets.find(m=>m.coin===r.coin);return s+(m?-r.quantity*m.oracle*m.funding:0)},0);
 $('portfolio-kpis').innerHTML=kpi('Equity',money(eq),isLive?'Conto':'Capitale virtuale')+kpi('Nozionale lordo',money(gross))+kpi('Leva effettiva',fmt(isLive?a.effective_leverage:p?.effective_leverage)+'×')+kpi('Funding orario stimato',money(rows.length?flow:0),'Se quantità e tassi restano invariati',color(flow));
 $('positions').innerHTML=rows.length?rows.map(r=>{const m=data.markets.find(m=>m.coin===r.coin);return `<tr><td>${r.coin.slice(4)}</td><td class="${r.quantity>0?'positive':'negative'}">${r.quantity>0?'LONG':'SHORT'}</td><td>${fmt(r.quantity,5)}</td><td>${fmt(r.notional)}</td><td>${m?fmt(m.funding*100,5)+'%':'—'}</td><td class="${color(m?-r.quantity*m.oracle*m.funding:0)}">${m?fmt(-r.quantity*m.oracle*m.funding,3):'—'}</td><td>${isLive?fmt(r.configured_leverage,0)+'×':'—'}</td></tr>`}).join(''):'<tr><td colspan="7">Nessuna posizione aperta in questo portafoglio.</td></tr>';
 $('positions-note').textContent=isLive?'Quantità effettive lette dal conto. Leva impostata e leva effettiva sono misure diverse.':'Posizioni simulate. Il funding incassato paper è stimato; la leva di margine del conto non viene applicata al paper.';
 const fills=(isLive?a.fills:p?.fills||[]).slice().reverse();$('fills-note').textContent=isLive?'Fill effettivi del conto, rilevazione ultime 24 ore.':'Fill simulati della sessione; BUY e SELL indicano il lato, non necessariamente apertura e chiusura.';
 $('fills').innerHTML=fills.length?fills.map(f=>`<tr><td>${date(f.time)}</td><td>${f.coin.slice(4)}</td><td>${f.side?(f.side==='B'?'BUY':'SELL'):(f.quantity>0?'BUY':'SELL')}</td><td>${fmt(Math.abs(f.quantity),5)}</td><td>${fmt(f.price,4)}</td><td>${fmt(f.fee,4)}</td></tr>`).join(''):'<tr><td colspan="6">Nessuna operazione nella finestra disponibile.</td></tr>';
}
function renderMarket(){const m=data.markets.find(m=>m.coin===asset);if(!m)return;
 chart('funding-chart',[{name:m.coin.slice(4),color:'#7654cb',points:m.history.map(p=>({time:p.time,value:p.rate*100}))}],'value','rate');
 $('book-title').textContent='Book · '+m.coin.slice(4);for(const side of ['bids','asks'])$(side).innerHTML=m[side].map(l=>`<div class="book-line"><b class="${side==='bids'?'positive':'negative'}">${fmt(l.price,4)}</b><span>${fmt(l.quantity,5)}</span></div>`).join('');$('book-age').textContent=(m.stale?'Book non recente · ':'')+'Età: '+fmt(m.age_seconds,0)+' s · primi cinque livelli osservati.';
}
async function refresh(){
 try{
  const url=window.FUNDING_ENDPOINT+(window.FUNDING_ENDPOINT.includes('?')?'&':'?')+'v='+Math.floor(Date.now()/30000);
  const response=await fetch(url,{cache:'no-store',credentials:'omit'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const incoming=await response.json();
  data=incoming;observeSource(data,response.headers.get('Date'),response.headers.get('Cache-Control'));
 }catch(e){
  if(data)renderSupervisor(true);
  $('banner').className='notice error';$('banner').textContent='Aggiornamento non riuscito. Gli eventuali valori presenti sono gli ultimi ricevuti.';
  setTimeout(refresh,30000);return;
 }
 renderSupervisor();
 try{render()}catch(e){
  console.error('Dashboard rendering failed',e);
  $('banner').className='notice error';$('banner').textContent='Errore nella visualizzazione dei dati. Lo stato del supervisore indica la lettura ricevuta; aggiornare la pagina.';
 }
 setTimeout(refresh,location.hostname==='127.0.0.1'||location.hostname==='localhost'?5000:30000);
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab],.tab').forEach(e=>e.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');render()});
$('portfolio-source').onchange=e=>{selected=e.target.value;renderPortfolio()};$('asset').onchange=e=>{asset=e.target.value;renderMarket()};$('window').onchange=e=>{hours=+e.target.value;render()};$('unit').onchange=e=>{unit=e.target.value;render()};window.addEventListener('resize',()=>{if(data)render()});refresh();
