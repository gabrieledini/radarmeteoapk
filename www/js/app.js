// Radar previsionale nuvole e pioggia (Europa, 3 giorni) su dati Open-Meteo.
(function(){
'use strict';

function boot(){
  if (window.L) return start();
  // Leaflet locale assente (es. pagina aperta senza "npm run build"): ripiego su CDN
  const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  s.onload=start; s.onerror=()=>{document.getElementById('status').textContent='Impossibile caricare la mappa: controlla la connessione e riapri l\'app.';};
  document.head.appendChild(s);
}

function start(){
  const $=id=>document.getElementById(id);
  const fmtTime=d=>d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  const fmtNum=(v,dec)=>v.toFixed(dec).replace('.',',');

  let HOME={lat:43.8667,lon:10.25,name:'Viareggio'};
  try{const h=JSON.parse(localStorage.getItem('radar-home')||'null'); if(h&&isFinite(h.lat)&&isFinite(h.lon)&&h.name)HOME=h;}catch(e){}

  // estensione Europa
  const LAT_S=34, LAT_N=71.5, LON_W=-12, LON_E=42;
  const NX=26, NY=22;                       // 572 punti, passo ~2.1° lon / 1.8° lat
  const CHUNK=110;                          // punti per richiesta
  const PAST_H=6, FUTURE_H=72, SUB=6;       // 3 giorni, frame ogni 10 min
  const PXW=640, PXH=520;
  let times=[], cloud=[], rain=[], prob=[], T=0, frames=0, speed=1, timer=null, lastPopup=null;
  let showRain=true, showCloud=true;

  // ---- mappa ----
  const bounds=L.latLngBounds([LAT_S,LON_W],[LAT_N,LON_E]);
  const map=L.map('map',{zoomControl:false,minZoom:3,maxZoom:10,attributionControl:true});
  const focusHome=(animate)=>{
    const pad={paddingTopLeft:[0,innerWidth<760?200:20],paddingBottomRight:[innerWidth<760?0:480,innerWidth<760?260:0]};
    const b=L.latLng(HOME.lat,HOME.lon).toBounds(1100000);
    animate?map.flyToBounds(b,{...pad,duration:.8}):map.fitBounds(b,pad);
  };
  focusHome(false);
  if(matchMedia('(pointer:fine)').matches)L.control.zoom({position:'bottomleft'}).addTo(map);
  map.attributionControl.setPrefix(false);
  // base Esri senza etichette sotto, etichette sopra l'overlay così le città restano leggibili sulla pioggia
  map.createPane('labels'); map.getPane('labels').style.zIndex=450; map.getPane('labels').style.pointerEvents='none';
  const esri='https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/{layer}/MapServer/tile/{z}/{y}/{x}';
  L.tileLayer(esri,{layer:'World_Dark_Gray_Base',maxZoom:16,className:'tint',
    attribution:'Mappa &copy; Esri, HERE, Garmin, &copy; OpenStreetMap · dati <a href="https://open-meteo.com">Open-Meteo</a>'}).addTo(map);
  L.tileLayer(esri,{layer:'World_Dark_Gray_Reference',maxZoom:16,pane:'labels'}).addTo(map);

  // overlay disegnato direttamente su canvas (niente toDataURL a ogni frame)
  const CanvasOverlay=L.ImageOverlay.extend({
    _initImage(){
      const c=this._image=this._url;
      L.DomUtil.addClass(c,'leaflet-image-layer');
      if(this._zoomAnimated)L.DomUtil.addClass(c,'leaflet-zoom-animated');
      c.onselectstart=L.Util.falseFn; c.onmousemove=L.Util.falseFn;
    }
  });
  const canvas=document.createElement('canvas'); canvas.width=PXW; canvas.height=PXH;
  const ctx=canvas.getContext('2d');
  const img=ctx.createImageData(PXW,PXH);
  const overlay=new CanvasOverlay(canvas,bounds,{interactive:false}).addTo(map);

  const homeMarker=L.marker([HOME.lat,HOME.lon],{icon:L.divIcon({className:'',html:'<div class="home-dot"></div>',iconSize:[14,14]}),keyboard:false})
    .addTo(map).bindTooltip('',{permanent:true,direction:'right',className:'lbl',offset:[8,0]});
  homeMarker.setTooltipContent(document.createTextNode(HOME.name));
  $('homeName').querySelector('span').textContent=HOME.name;

  // ---- griglia ----
  const lats=[],lons=[];
  for(let i=0;i<NY;i++)for(let j=0;j<NX;j++){
    lats.push((LAT_S+(LAT_N-LAT_S)*i/(NY-1)).toFixed(2));   // i: sud→nord
    lons.push((LON_W+(LON_E-LON_W)*j/(NX-1)).toFixed(2));   // j: ovest→est
  }
  const toGx=lon=>(lon-LON_W)/(LON_E-LON_W)*(NX-1), toGy=lat=>(lat-LAT_S)/(LAT_N-LAT_S)*(NY-1);
  let HOME_K=0;
  function homeIndex(){HOME_K=Math.round(toGy(HOME.lat))*NX+Math.round(toGx(HOME.lon));}
  homeIndex();

  // ---- ricerca località ----
  function toggleSearch(open){
    $('search').hidden=!open; $('homeName').setAttribute('aria-expanded',open);
    if(open)$('q').focus(); else{$('results').replaceChildren();$('q').value='';}
  }
  function setHome(lat,lon,name){
    HOME={lat:+lat,lon:+lon,name}; try{localStorage.setItem('radar-home',JSON.stringify(HOME));}catch(e){}
    homeIndex(); homeMarker.setLatLng([HOME.lat,HOME.lon]); homeMarker.setTooltipContent(document.createTextNode(HOME.name));
    $('homeName').querySelector('span').textContent=HOME.name; toggleSearch(false);
    focusHome(true);
    if(T){drawSpark(+slider.value);render(+slider.value);}
  }
  function resultMsg(text){const li=document.createElement('li');li.className='empty';li.textContent=text;$('results').replaceChildren(li);}
  $('homeName').addEventListener('click',()=>toggleSearch($('search').hidden));
  let qTimer=null;
  $('q').addEventListener('input',()=>{clearTimeout(qTimer);const v=$('q').value.trim();if(v.length<2){$('results').replaceChildren();return;}qTimer=setTimeout(()=>geocode(v),350);});
  $('q').addEventListener('keydown',e=>{
    if(e.key==='Enter'){const li=$('results').querySelector('li:not(.empty)');if(li)li.click();}
    if(e.key==='Escape')toggleSearch(false);
  });
  function geocode(name){
    fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=8&language=it&format=json')
      .then(r=>r.json()).then(j=>{
        const ul=$('results'); ul.replaceChildren();
        (j.results||[]).forEach(r=>{
          if(r.latitude<LAT_S||r.latitude>LAT_N||r.longitude<LON_W||r.longitude>LON_E)return;
          const li=document.createElement('li'), sm=document.createElement('small'); li.tabIndex=0;
          li.textContent=r.name; sm.textContent=[r.admin1,r.country].filter(Boolean).join(', '); li.appendChild(sm);
          li.addEventListener('click',()=>setHome(r.latitude,r.longitude,r.name));
          li.addEventListener('keydown',e=>{if(e.key==='Enter')li.click();});
          ul.appendChild(li);
        });
        if(!ul.children.length)resultMsg('Nessuna località trovata in Europa');
      }).catch(()=>resultMsg('Ricerca non disponibile: controlla la connessione'));
  }
  $('geo').addEventListener('click',()=>{
    if(!navigator.geolocation)return resultMsg('Il dispositivo non fornisce la posizione');
    resultMsg('Rilevo la posizione…');
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude:la,longitude:lo}=pos.coords;
      if(la<LAT_S||la>LAT_N||lo<LON_W||lo>LON_E)return resultMsg('Sei fuori dall\'area coperta (Europa)');
      // nome leggibile dal geocoding inverso; se non disponibile uso le coordinate
      fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=it&lat='+la+'&lon='+lo)
        .then(r=>r.json()).then(j=>{const a=j.address||{};return a.city||a.town||a.village||a.municipality||j.name;})
        .catch(()=>null).then(n=>setHome(la,lo,n||fmtNum(la,2)+', '+fmtNum(lo,2)));
    },()=>resultMsg('Posizione non concessa: abilitala nelle impostazioni'),{timeout:10000,maximumAge:600000});
  });
  $('recenter').addEventListener('click',()=>focusHome(true));

  // ---- cache locale (validità 4 ore) ----
  const CACHE_KEY='radar-eu-v3-'+NX+'x'+NY+'-'+PAST_H+'-'+FUTURE_H, TTL=4*3600*1000;
  function readCache(){
    try{const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); if(c&&c.times&&c.cloud&&c.rain&&c.prob)return c;}catch(e){}
    return null;
  }
  function writeCache(data){
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(data));}catch(e){/* quota piena: si prosegue senza cache */}
  }
  function ageText(ms){const m=Math.round(ms/60000);return m<60?m+' min':Math.floor(m/60)+' h '+(m%60)+' min';}
  function setStatus(text,err){$('status').textContent=text;$('status').classList.toggle('err',!!err);}

  function apply(data,fromCache){
    times=data.times.map(t=>new Date(t+'Z').getTime()); T=times.length; frames=(T-1)*SUB;
    cloud=data.cloud.map(a=>Float32Array.from(a)); rain=data.rain.map(a=>Float32Array.from(a)); prob=data.prob.map(a=>Float32Array.from(a));
    slider.max=frames; slider.value=nowFrame();
    drawTicks(); render(+slider.value);
    const when=fmtTime(new Date(data.ts));
    setStatus(fromCache?'Dati delle '+when+' ('+ageText(Date.now()-data.ts)+' fa)':'Aggiornato alle '+when);
  }

  // ---- dati (a blocchi, con timeout e un tentativo di ripetizione) ----
  function fetchChunk(url,tries=2){
    const ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),20000);
    return fetch(url,{signal:ctl.signal}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(x=>Array.isArray(x)?x:[x]).finally(()=>clearTimeout(to))
      .catch(e=>{if(tries>1)return new Promise(r=>setTimeout(r,1500)).then(()=>fetchChunk(url,tries-1));throw e;});
  }
  let loading=false;
  function load(){
    if(loading)return; loading=true; $('refresh').classList.add('busy');
    const hadData=T>0; let done=0;
    const urls=[];
    for(let a=0;a<lats.length;a+=CHUNK)urls.push('https://api.open-meteo.com/v1/forecast?latitude='+lats.slice(a,a+CHUNK).join(',')+'&longitude='+lons.slice(a,a+CHUNK).join(',')
      +'&hourly=cloud_cover,precipitation,precipitation_probability&past_hours='+PAST_H+'&forecast_hours='+FUTURE_H+'&timezone=GMT');
    const bar=$('progress'), fill=bar.firstElementChild;
    bar.hidden=false; fill.style.width='4%';
    const prog=()=>{done++; fill.style.width=(4+96*done/urls.length)+'%';};
    setStatus(hadData?'Aggiorno i dati…':'Scarico la previsione…');
    Promise.all(urls.map(u=>fetchChunk(u).then(x=>{prog();return x;}))).then(parts=>{
      const arr=parts.flat(), tm=arr[0].hourly.time, TT=tm.length;
      const mk=()=>Array.from({length:TT},()=>new Array(NX*NY).fill(0));
      const cl=mk(), rn=mk(), pr=mk();
      arr.forEach((loc,k)=>{for(let t=0;t<TT;t++){cl[t][k]=Math.round(loc.hourly.cloud_cover[t]??0);rn[t][k]=Math.round((loc.hourly.precipitation[t]??0)*100)/100;pr[t][k]=Math.round(loc.hourly.precipitation_probability?.[t]??0);}});
      const data={ts:Date.now(),times:tm,cloud:cl,rain:rn,prob:pr};
      writeCache(data);
      const keepFrame=hadData?+slider.value:null; const wasPlaying=!!timer;
      apply(data,false);
      if(keepFrame!=null){slider.value=Math.min(keepFrame,frames);render(+slider.value);if(wasPlaying)play();}
    }).catch(e=>{
      setStatus(hadData?'Aggiornamento non riuscito ('+e.message+'): restano i dati precedenti.':'Previsione non disponibile ('+e.message+'). Tocca ⟳ per riprovare.',true);
    }).finally(()=>{loading=false; $('refresh').classList.remove('busy'); setTimeout(()=>{bar.hidden=true;fill.style.width='0';},400);});
  }
  // controllo periodico: se la cache supera le 4 ore, riscarica
  const checkStale=()=>{const c=readCache(); if(!loading&&(!c||Date.now()-c.ts>TTL))load();};
  setInterval(checkStale,10*60*1000);
  function nowFrame(){const f=(Date.now()-times[0])/3600000*SUB;return Math.max(0,Math.min(frames,Math.round(f)));}
  function frameDate(f){return new Date(times[0]+f/SUB*3600000);}

  // ---- colori ----
  const STOPS=[[0.1,[60,170,255]],[0.5,[80,220,140]],[1.5,[255,230,80]],[4,[255,150,40]],[10,[235,50,60]],[25,[200,60,220]]];
  function rainColor(mm){
    if(mm<=STOPS[0][0])return STOPS[0][1];
    for(let i=1;i<STOPS.length;i++)if(mm<=STOPS[i][0]){
      const a=STOPS[i-1],b=STOPS[i],f=(Math.log(mm)-Math.log(a[0]))/(Math.log(b[0])-Math.log(a[0]));
      return [0,1,2].map(k=>a[1][k]+(b[1][k]-a[1][k])*f);
    }
    return STOPS[STOPS.length-1][1];
  }
  // tabella precalcolata: indice = mm/h * 20, fino a 40 mm/h
  const LUT_N=801, LUT=new Uint8ClampedArray(LUT_N*3);
  for(let i=0;i<LUT_N;i++){const c=rainColor(Math.max(0.1,i/20));LUT[i*3]=c[0];LUT[i*3+1]=c[1];LUT[i*3+2]=c[2];}

  // ---- rendering ----
  const cur=new Float32Array(NX*NY), rur=new Float32Array(NX*NY), pur=new Float32Array(NX*NY);
  function bilinear(arr,gx,gy){
    gx=Math.max(0,Math.min(NX-1,gx)); gy=Math.max(0,Math.min(NY-1,gy));
    const x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(x0+1,NX-1),y1=Math.min(y0+1,NY-1),fx=gx-x0,fy=gy-y0;
    const a=arr[y0*NX+x0],b=arr[y0*NX+x1],c=arr[y1*NX+x0],d=arr[y1*NX+x1];
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  }
  function interp(f){
    const t0=Math.min(T-1,Math.floor(f/SUB)),t1=Math.min(T-1,t0+1),fr=f/SUB-t0;
    for(let k=0;k<NX*NY;k++){cur[k]=cloud[t0][k]*(1-fr)+cloud[t1][k]*fr; rur[k]=rain[t0][k]*(1-fr)+rain[t1][k]*fr; pur[k]=prob[t0][k]*(1-fr)+prob[t1][k]*fr;}
  }
  // l'overlay è stirato in proiezione Mercatore: mappo ogni riga del canvas alla latitudine reale
  const merc=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
  const mS=merc(LAT_S), mN=merc(LAT_N);
  const rowGy=new Float32Array(PXH), colGx=new Float32Array(PXW);
  for(let py=0;py<PXH;py++){
    const m=mN-(mN-mS)*py/(PXH-1), lat=(2*Math.atan(Math.exp(m))-Math.PI/2)*180/Math.PI;
    rowGy[py]=toGy(lat);
  }
  for(let px=0;px<PXW;px++)colGx[px]=px/(PXW-1)*(NX-1);

  const COND=[
    [(c,r)=>r>=4,'w-storm','Pioggia forte'],
    [(c,r)=>r>=0.3,'w-rain','Pioggia'],
    [(c,r)=>r>=0.05,'w-rain','Pioviggine'],
    [(c)=>c>=80,'w-cloud','Coperto'],
    [(c)=>c>=45,'w-cloud','Nuvoloso'],
    [(c)=>c>=15,'w-part','Poco nuvoloso'],
    [()=>true,null,'Sereno'],
  ];
  function condition(c,r,dt){
    const [,icon,text]=COND.find(x=>x[0](c,r)); const h=dt.getHours(), night=h<7||h>=19;
    return {icon:icon||(night?'w-moon':'w-sun'),text:text};
  }

  function render(f){
    if(!T)return; interp(f);
    const d=img.data;
    for(let py=0;py<PXH;py++){
      const gy=rowGy[py];
      for(let px=0;px<PXW;px++){
        const gx=colGx[px], o=(py*PXW+px)*4;
        let r=0,g=0,b=0,a=0;
        if(showCloud){
          let ct=(bilinear(cur,gx,gy)/100-0.25)/0.75; ct=ct<0?0:ct; ct=ct*ct*(3-2*ct);
          const lum=170+80*ct; r=lum-8;g=lum-2;b=lum+8;a=ct*.6;
        }
        if(showRain){
          const mm=bilinear(rur,gx,gy);
          if(mm>0.08){
            const li=Math.min(LUT_N-1,(mm*20)|0)*3, ra=Math.min(.85,.42+Math.log1p(mm)/4);
            // bordo morbido: la soglia minima sfuma invece di tagliare netto
            const edge=mm<0.2?(mm-0.08)/0.12:1, k=ra*edge;
            r=r*(1-k)+LUT[li]*k;g=g*(1-k)+LUT[li+1]*k;b=b*(1-k)+LUT[li+2]*k;a=Math.max(a,k);
          }
        }
        d[o]=r;d[o+1]=g;d[o+2]=b;d[o+3]=a*255;
      }
    }
    ctx.putImageData(img,0,0);

    const dt=frameDate(f), nf=nowFrame(), isNow=Math.abs(f-nf)<SUB/2;
    const hm=fmtTime(dt);
    const day=dt.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
    const tb=$('time').firstElementChild; tb.textContent=hm;
    if(isNow){const em=document.createElement('em');em.textContent='adesso';tb.appendChild(em);}
    $('time').lastElementChild.textContent=day.charAt(0).toUpperCase()+day.slice(1)+(isNow?'':f<nf?', passato':', previsione');
    drawSpark(f);

    const hgx=toGx(HOME.lon), hgy=toGy(HOME.lat);
    const hc=bilinear(cur,hgx,hgy), hp=bilinear(pur,hgx,hgy), hr=bilinear(rur,hgx,hgy);
    const cnd=condition(hc,hr,dt);
    $('wIcon').firstElementChild.setAttribute('href','#'+cnd.icon);
    $('wText').textContent=cnd.text;
    $('homeT').textContent=(isNow?'Adesso, ':'Alle ')+hm;
    $('hC').textContent=Math.round(hc)+'%'; $('hP').textContent=Math.round(hp)+'%';
    $('hR').textContent=hr<0.05?'0 mm':fmtNum(hr,1)+' mm';
    if(lastPopup)updatePopup();
  }

  // ---- timeline: istogramma della località scelta ----
  const spark=$('spark'),sctx=spark.getContext('2d');
  function drawSpark(f){
    const w=spark.clientWidth,h=spark.clientHeight,dpr=devicePixelRatio||1;
    if(spark.width!==Math.round(w*dpr)||spark.height!==Math.round(h*dpr)){spark.width=Math.round(w*dpr);spark.height=Math.round(h*dpr);}
    sctx.setTransform(dpr,0,0,dpr,0,0); sctx.clearRect(0,0,w,h);
    if(!T)return;
    const bw=w/(T-1), top=8, base=h-2, H=base-top;
    // giorni alterni
    for(let t=0;t<T-1;t++){const dd=new Date(times[t]);if(dd.getDate()%2){sctx.fillStyle='rgba(255,255,255,.03)';sctx.fillRect(t*bw,0,bw+.5,h);}}
    // passato più scuro
    const nx=nowFrame()/frames*w;
    sctx.fillStyle='rgba(0,0,0,.18)'; sctx.fillRect(0,0,nx,h);
    // nuvole come area continua
    sctx.beginPath(); sctx.moveTo(0,base);
    for(let t=0;t<T;t++)sctx.lineTo(t*bw,base-cloud[t][HOME_K]/100*H*.85);
    sctx.lineTo(w,base); sctx.closePath(); sctx.fillStyle='rgba(201,212,220,.16)'; sctx.fill();
    // pioggia a barre colorate
    let max=1; for(let t=0;t<T;t++)max=Math.max(max,rain[t][HOME_K]);
    for(let t=0;t<T-1;t++){const v=rain[t][HOME_K];if(v<0.05)continue;const [r,g,b]=rainColor(v);sctx.fillStyle=`rgb(${r|0},${g|0},${b|0})`;
      const hh=Math.max(3,Math.log1p(v)/Math.log1p(max)*H);sctx.fillRect(t*bw+.5,base-hh,Math.max(1,bw-1),hh);}
    sctx.fillStyle='rgba(200,225,240,.18)'; sctx.fillRect(0,base,w,1);
    // ora attuale
    sctx.strokeStyle='rgba(143,224,208,.85)';sctx.lineWidth=1;sctx.setLineDash([3,3]);sctx.beginPath();sctx.moveTo(nx+.5,0);sctx.lineTo(nx+.5,h);sctx.stroke();sctx.setLineDash([]);
    // testina di lettura
    if(f!=null){
      const x=Math.round(f/frames*w);
      sctx.fillStyle='#fff'; sctx.fillRect(x-1,2,2,h-2);
      sctx.beginPath(); sctx.arc(x,5,5,0,Math.PI*2); sctx.fill();
    }
  }
  function drawTicks(){
    const el=$('ticks'); el.replaceChildren();
    const w=el.clientWidth||1;
    for(let t=0;t<T;t++){
      const dt=new Date(times[t]), hh=dt.getHours();
      if(hh!==0&&hh!==12)continue;
      const x=t/(T-1)*w; if(x<14||x>w-14)continue;
      const s=document.createElement('span'); s.style.left=x+'px';
      if(hh===0){s.className='day';s.textContent=dt.toLocaleDateString('it-IT',{weekday:'short',day:'numeric'});}
      else s.textContent='12';
      el.appendChild(s);
    }
  }

  // ---- interazione ----
  const slider=$('slider');
  slider.addEventListener('input',()=>{stop();render(+slider.value);});
  $('play').addEventListener('click',()=>timer?stop():play());
  $('speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?4:1;$('speed').textContent=speed+'×';if(timer){stop();play();}});
  $('toNow').addEventListener('click',()=>{if(!T)return;stop();slider.value=nowFrame();render(+slider.value);});
  const setPlayIcon=on=>{$('play').firstElementChild.firstElementChild.setAttribute('href',on?'#i-pause':'#i-play');
    $('play').setAttribute('aria-label',on?'Ferma animazione':'Avvia animazione');};
  function play(){
    if(!T||timer)return; setPlayIcon(true);
    let last=0; const step=130/speed;
    const tick=ts=>{
      if(!timer)return;
      if(ts-last>=step){last=ts;let v=+slider.value+1;if(v>frames)v=0;slider.value=v;render(v);}
      timer=requestAnimationFrame(tick);
    };
    timer=requestAnimationFrame(tick);
  }
  function stop(){if(timer)cancelAnimationFrame(timer);timer=null;setPlayIcon(false);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else checkStale();});
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input[type=search]'))return;
    if(e.key===' '){e.preventDefault();timer?stop():play();}
    else if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&e.target!==slider&&T){
      stop();slider.value=Math.max(0,Math.min(frames,+slider.value+(e.key==='ArrowRight'?SUB:-SUB)));render(+slider.value);
    }
  });

  $('lyRain').addEventListener('change',e=>{showRain=e.target.checked;render(+slider.value);});
  $('lyCloud').addEventListener('change',e=>{showCloud=e.target.checked;render(+slider.value);});

  map.on('click',e=>{
    if(!T)return; const ll=e.latlng;
    if(!bounds.contains(ll)){if(lastPopup){map.closePopup(lastPopup);lastPopup=null;}return;}
    lastPopup=L.popup({closeButton:false,autoPan:false}).setLatLng(ll).openOn(map); updatePopup();
  });
  map.on('popupclose',()=>lastPopup=null);
  function updatePopup(){
    const ll=lastPopup.getLatLng(), gx=toGx(ll.lng), gy=toGy(ll.lat);
    const cc=bilinear(cur,gx,gy), mm=bilinear(rur,gx,gy), pp=bilinear(pur,gx,gy);
    const row=(k,v)=>'<div><span>'+k+'</span><span>'+v+'</span></div>';
    lastPopup.setContent('<div class="pp"><b>'+fmtTime(frameDate(+slider.value))+'</b>'
      +row('Nuvole',Math.round(cc)+'%')+row('Prob. pioggia',Math.round(pp)+'%')+row('Pioggia',mm<0.05?'assente':fmtNum(mm,1)+' mm/h')+'</div>');
  }
  $('refresh').addEventListener('click',()=>{
    try{localStorage.removeItem(CACHE_KEY);}catch(e){}
    load();
  });
  $('opacity').addEventListener('input',e=>overlay.setOpacity(e.target.value/100)); overlay.setOpacity(.75);
  // su schermi larghi la legenda parte aperta
  if(innerWidth>=760)$('more').open=true;
  let rz=null; addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{drawTicks();drawSpark(+slider.value);},120);});

  const cached=readCache();
  if(cached){apply(cached,true); if(Date.now()-cached.ts>TTL)load();}
  else load();
}

boot();
})();
