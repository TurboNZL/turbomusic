/**
 * The "now playing" widget: one self-contained page (no build step, no libraries) for an OBS Browser Source, a second screen, or any
 * always-on-top browser window. It polls /api/nowplaying on the same server and draws the playing track in the chosen skin.
 *
 * Options are read from the address, so the Settings card only has to build a link (see apps/web/src/lib/widgetUrl.ts, which owns the
 * list and its defaults; keep the two in step):
 *   token  the access token (required)      skin   compact | boxy | gallery | minimal | macos | discord
 *   cover  square | vinyl | none            glow   1: a soft glow of the cover's colour behind the card
 *   blur   1: the cover, blurred, as the card's background
 *   accent a hex colour for the progress bar (default: from the cover's average)
 *   bg     transparent (OBS) | dark | light: a solid page for a normal window
 *   scale  size multiplier, 0.5 to 3        progress  1: show the progress bar and times
 *   w      card width in px (200 to 1200, default 380, the same for every skin)     h  card height in px (60 to 800; unset = fits its content)
 *   hide   paused: hide the widget while nothing plays     songchange  seconds: show only that long after a song changes (0 = always)
 *   idle   text shown when nothing plays (empty = the placeholder cover and "Nothing playing")
 */
export const WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TurboMusic now playing</title>
<style>
:root{--accent:#a855f7;--fg:#fff;--muted:rgba(255,255,255,.68);--card:rgba(18,18,22,.86);--scale:1;--w:380px;--h:auto}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:"Albert Sans","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg)}
body.bg-dark{background:#0e0e12}body.bg-light{background:#eceef2;--fg:#15151a;--muted:rgba(20,20,30,.62);--card:rgba(255,255,255,.88)}
#stage{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:flex-start;padding:14px}
#p{position:relative;transform:scale(var(--scale));transform-origin:top left;transition:opacity .45s ease,transform .45s ease;opacity:1}
#p.gone{opacity:0;transform:scale(calc(var(--scale)*.96)) translateY(8px)}
.card{position:relative;overflow:hidden;background:var(--card);border-radius:16px;display:flex;gap:14px;align-items:center;padding:12px 16px 12px 12px;width:var(--w);height:var(--h);box-sizing:border-box}
.glow::before{content:"";position:absolute;inset:-30px;z-index:-1;background:var(--art) center/cover;filter:blur(36px) saturate(1.5);opacity:.55;border-radius:50%}
#p{isolation:isolate}
.bgblur{position:absolute;inset:-20px;background:var(--art) center/cover;filter:blur(28px) brightness(.55) saturate(1.3);z-index:0}
.card>*:not(.bgblur){position:relative;z-index:1}
.art{flex:none;width:76px;height:76px;border-radius:12px;background:#2a2a32 center/cover no-repeat;box-shadow:0 6px 18px rgba(0,0,0,.35);position:relative}
.cover-vinyl .art{border-radius:50% !important;animation:spin 6s linear infinite;animation-play-state:paused;box-shadow:0 6px 18px rgba(0,0,0,.45),inset 0 0 0 3px rgba(0,0,0,.35)}
.cover-vinyl.playing .art{animation-play-state:running}
.cover-vinyl .art::after{content:"";position:absolute;left:50%;top:50%;width:18%;height:18%;transform:translate(-50%,-50%);border-radius:50%;background:#101014;box-shadow:0 0 0 3px rgba(255,255,255,.1)}
.cover-none .art{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
.text{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.title{font-weight:700;font-size:20px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.artist{font-size:15px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.album{font-size:13px;color:var(--muted);opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{margin-top:8px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden}
.light-bar .bar{background:rgba(0,0,0,.14)}
.fill{height:100%;width:0;background:var(--accent);border-radius:2px;transition:width .3s linear}
.times{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:3px;font-variant-numeric:tabular-nums}
.noprog .bar,.noprog .times{display:none}
.swap .text,.swap .art{animation:rise .5s ease both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* compact: the default row */
/* boxy: sharp, wide, cover at the left edge */
[data-skin=boxy] .card{border-radius:3px;padding:0 18px 0 0;gap:16px;min-height:84px}
[data-skin=boxy] .art{width:84px;height:84px;border-radius:0;box-shadow:none}
[data-skin=boxy].cover-vinyl .art{border-radius:50%;margin:6px 0 6px 6px;width:72px;height:72px}
[data-skin=boxy] .title{font-size:18px;text-transform:uppercase;letter-spacing:.04em}
/* gallery: a tall card, the cover on top */
[data-skin=gallery] .card{flex-direction:column;align-items:stretch;gap:12px;padding:14px}
[data-skin=gallery] .art{width:100%;height:auto;aspect-ratio:1;border-radius:14px}
[data-skin=gallery].cover-vinyl .art{border-radius:50%}
[data-skin=gallery] .text{text-align:center}
/* minimal: just words and a thin line */
[data-skin=minimal] .card{background:none;padding:12px 16px;gap:0}
[data-skin=minimal] .art{display:none}
[data-skin=minimal] .title{font-size:26px;text-shadow:0 2px 10px rgba(0,0,0,.55)}
[data-skin=minimal] .artist,[data-skin=minimal] .album,[data-skin=minimal] .times{text-shadow:0 1px 6px rgba(0,0,0,.6)}
[data-skin=minimal] .bar{height:2px}
/* macos: frosted glass */
[data-skin=macos] .card{background:rgba(40,40,46,.55);backdrop-filter:blur(22px) saturate(1.6);border:1px solid rgba(255,255,255,.16);border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
[data-skin=macos] .art{border-radius:10px;width:64px;height:64px}
[data-skin=macos] .title{font-size:16px;font-weight:600}
[data-skin=macos] .artist{font-size:13px}
/* discord: the "Listening to" activity card */
[data-skin=discord] .card{background:#1e1f22;border-radius:8px;flex-wrap:wrap;gap:12px;padding:14px;border:1px solid #2b2d31}
[data-skin=discord] .head{flex-basis:100%;font-size:12px;font-weight:700;letter-spacing:.02em;color:#b5bac1;display:flex;gap:6px;align-items:center}
[data-skin=discord] .head::before{content:"";width:8px;height:8px;border-radius:50%;background:#23a55a}
[data-skin=discord] .art{width:60px;height:60px;border-radius:8px;box-shadow:none}
[data-skin=discord] .title{font-size:16px;font-weight:600}
[data-skin=discord] .artist,[data-skin=discord] .album{font-size:14px;color:#dbdee1}
[data-skin=discord] .album{color:#b5bac1}
.head{display:none}[data-skin=discord] .head{display:flex}
</style></head>
<body>
<div id="stage"><div id="p" class="gone" data-skin="compact">
 <div class="card" id="card"><div class="bgblur" id="bgblur" hidden></div>
  <div class="head" id="head">Listening to TurboMusic</div>
  <div class="art" id="art"></div>
  <div class="text"><div class="title" id="title"></div><div class="artist" id="artist"></div><div class="album" id="album"></div>
   <div class="bar"><div class="fill" id="fill"></div></div><div class="times"><span id="t0">0:00</span><span id="t1">0:00</span></div></div>
 </div>
</div></div>
<script>
(function(){
var q=new URLSearchParams(location.search),token=q.get('token')||'';
var skin=q.get('skin')||'compact',cover=q.get('cover')||'square';
var p=document.getElementById('p'),art=document.getElementById('art'),root=document.documentElement;
var allowed=['compact','boxy','gallery','minimal','macos','discord'];
if(allowed.indexOf(skin)<0)skin='compact';
p.setAttribute('data-skin',skin);
p.classList.add('cover-'+(['square','vinyl','none'].indexOf(cover)<0?'square':cover));
if(q.get('glow')==='1')document.getElementById('card').classList.add('glow');
document.getElementById('bgblur').hidden=q.get('blur')!=='1'||skin==='minimal';
if(q.get('progress')==='0')p.classList.add('noprog');
var accent=q.get('accent');if(accent&&/^#?[0-9a-f]{3,8}$/i.test(accent))root.style.setProperty('--accent',accent[0]==='#'?accent:'#'+accent);
var bg=q.get('bg');if(bg==='dark'||bg==='light')document.body.className='bg-'+bg;
var wpx=parseInt(q.get('w')||'0',10);if(wpx>=200&&wpx<=1200)root.style.setProperty('--w',wpx+'px');var hpx=parseInt(q.get('h')||'0',10);if(hpx>=60&&hpx<=800)root.style.setProperty('--h',hpx+'px');
var scale=parseFloat(q.get('scale')||'1');if(!(scale>=.5&&scale<=3))scale=1;root.style.setProperty('--scale',String(scale));
var hidePaused=q.get('hide')==='paused',songChange=Math.max(0,parseFloat(q.get('songchange')||'0')||0),idleText=q.get('idle')||'';
var st=null,got=0,lastId=null,shownUntil=0,hideTimer=0;
function fmt(s){s=Math.max(0,Math.floor(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function cssUrl(u){return 'url("'+u.replace(/"/g,'%22')+'")'}
function render(){
  var title=document.getElementById('title'),artist=document.getElementById('artist'),album=document.getElementById('album');
  var np=st&&st.track;
  if(!np){title.textContent=idleText||'Nothing playing';artist.textContent='';album.textContent='';art.style.backgroundImage='';p.classList.remove('playing');setGone(idleText==='' ? hidePaused : true);return;}
  var m=np.meta||{};
  title.textContent=m.title||'Unknown track';artist.textContent=m.artist||'';album.textContent=m.album||'';
  var u=m.cover?'/api/files/'+m.cover+'?token='+encodeURIComponent(token):'';
  art.style.backgroundImage=u?cssUrl(u):'';p.style.setProperty('--art',u?cssUrl(u):'none');
  p.classList.toggle('playing',!!np.playing);
  if(np.trackId!==lastId){lastId=np.trackId;p.classList.remove('swap');void p.offsetWidth;p.classList.add('swap');
    if(songChange>0){shownUntil=Date.now()+songChange*1000;clearTimeout(hideTimer);hideTimer=setTimeout(function(){render()},songChange*1000+50)}}
  var hide=(hidePaused&&!np.playing)||(songChange>0&&Date.now()>shownUntil);
  setGone(hide);
}
function setGone(g){p.classList.toggle('gone',!!g)}
function frame(){
  if(!st||!st.track)return;var np=st.track,pos=np.position+(np.playing?(performance.now()-got)/1000:0);
  if(np.duration>0)pos=Math.min(np.duration,pos);
  document.getElementById('fill').style.width=(np.duration>0?Math.min(100,pos/np.duration*100):0)+'%';
  document.getElementById('t0').textContent=fmt(pos);document.getElementById('t1').textContent=fmt(np.duration);
}
function poll(){
  fetch('/api/nowplaying?token='+encodeURIComponent(token),{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){st=j;got=performance.now();render()}).catch(function(){});
}
poll();setInterval(poll,1500);setInterval(frame,250);
})();
</script></body></html>`;
