// Generated from the Frontier mockups (frontier-mock 08 and 09, Fable design, 11-17): the claim and remove pages' styles and
// the land preview (the F rules: fogged sprite, ground fog, dashed plot line, blank flag) with the H4 lit-up moment.
export const CLAIM_CSS = `:root{--bg:#FAFAF7;--raised:#FFFFFF;--line:#E4E4DF;--text:#26262B;--muted:#6B6B73;--strong:#111111;--accent:#6E4FE0;--accent-text:#5A3CD0;--on-accent:#fff;--warn:#8A5200;--bad:#B3261E;--ok:#0B7A6E;color-scheme:light dark;--font-sans:'IBM Plex Sans',system-ui,sans-serif;--font-mono:'IBM Plex Mono',ui-monospace,monospace;--font-display:'Source Serif 4',Georgia,serif}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--raised:#18181B;--line:#2A2A2F;--text:#E6E6EA;--muted:#8A8A93;--strong:#F7F7FA;--accent:#8B6CF6;--accent-text:#B9A6FF;--on-accent:#fff;--warn:#FFB347;--bad:#FF9A9A;--ok:#4FD1C5}}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 var(--font-sans)}
.cl-top a{display:inline-flex;align-items:center;gap:10px;color:inherit;text-decoration:none}
.cl-eyebrow svg{width:12px;height:12px}.cl-eyebrow.plain{border-style:solid}.cl-eyebrow.ok{border:1px solid var(--ok);color:var(--ok)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
button.cl-go{font:600 16px/1 var(--font-sans)}form.cl-row{margin:0}
@media (max-width:760px){.cl-main{grid-template-columns:minmax(0,1fr);gap:20px;padding-top:20px}.cl-art{order:-1;aspect-ratio:16/10}.cl-go{width:100%}.cl-one{padding-top:24px}}
@media (max-width:520px) and (min-height:600px) and (max-height:720px){.cl-main{padding-top:14px;gap:12px}.cl h1{font-size:22px;margin:8px 0 6px}.cl-lede{font-size:13.5px;margin-bottom:12px}.cl-facts{font-size:12px;margin-top:12px;padding-top:10px;gap:3px 12px}.cl-fine,.cl-alt{font-size:12px}.cl-art{aspect-ratio:16/8}.cl-go{min-height:44px;font-size:14.5px}}

.cl{min-height:100vh;background:var(--bg);color:var(--text)}
.cl-top{display:flex;align-items:center;gap:10px;padding:14px max(16px,env(safe-area-inset-right,0px)) 14px max(16px,env(safe-area-inset-left,0px));border-bottom:1px solid var(--line);font:600 15px/1 var(--font-display,'Source Serif 4',Georgia,serif);color:var(--strong)}
.cl-top i{width:18px;height:18px;border-radius:5px;background:var(--accent);display:inline-block}
.cl-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:32px;align-items:center;max-width:1040px;margin:0 auto;padding:40px max(16px,env(safe-area-inset-right,0px)) 56px max(16px,env(safe-area-inset-left,0px))}
.cl-eyebrow{display:inline-flex;align-items:center;gap:6px;font:600 11px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.08em;text-transform:uppercase;padding:5px 8px;border-radius:5px;border:1px dashed var(--muted);color:var(--muted)}
.cl-eyebrow.lit{border:1px solid var(--accent);color:var(--accent-text)}
.cl h1{font:600 clamp(26px,3.4vw,38px)/1.12 var(--font-display,'Source Serif 4',Georgia,serif);letter-spacing:-.01em;color:var(--strong);margin:12px 0 10px;text-wrap:balance;overflow-wrap:anywhere}
.cl-lede{margin:0 0 18px;max-width:46ch;color:var(--text);font-size:16px}
.cl-go{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;padding:0 22px;border-radius:999px;border:0;background:var(--accent);color:var(--on-accent);font:600 16px/1 var(--font-sans,'IBM Plex Sans',sans-serif);cursor:pointer;text-decoration:none}
.cl-go svg{width:19px;height:19px}
.cl-go:focus-visible,.cl a:focus-visible,.cl button:focus-visible,.cl input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.cl-go.sec{background:transparent;border:1px solid var(--line);color:var(--strong)}
.cl-go.danger{background:var(--bad);color:var(--bg)}
.cl-fine{margin:10px 0 0;font-size:13px;color:var(--muted);max-width:48ch}
.cl-facts{margin:22px 0 0;padding:14px 0 0;border-top:1px solid var(--line);display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;font-size:14px;max-width:52ch}
.cl-facts dt{color:var(--muted)}.cl-facts dd{margin:0;color:var(--text)}
.cl-alt{margin:18px 0 0;font-size:14px;color:var(--muted)}.cl a{color:var(--accent-text)}
.cl-msg{margin:0 0 16px;padding:10px 14px;border-radius:10px;border:1px solid var(--warn);color:var(--text);font-size:14px;max-width:52ch}
.cl-msg b{color:var(--strong)}
.cl-art{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);aspect-ratio:5/4;max-width:100%;background:#2B2350}
.cl-art canvas{display:block;width:100%;height:100%}
.cl-cap{position:absolute;left:10px;bottom:10px;font:500 11.5px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(15,16,22,.82);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 10px}
.cl-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.cl-reward{margin:16px 0 0;padding:12px 14px;border-radius:10px;background:var(--raised);border:1px solid var(--line);font-size:14px;max-width:52ch;display:grid;gap:4px}
.cl-reward b{color:var(--strong)}
.cl-form{display:grid;gap:10px;max-width:46ch;margin:14px 0 0}
.cl-form label{font:600 13px/1.3 var(--font-sans,'IBM Plex Sans',sans-serif);color:var(--strong);display:grid;gap:5px}
.cl-form input,.cl-form textarea{box-sizing:border-box;width:100%;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--raised);color:var(--strong);font:500 16px/1.3 var(--font-mono,'IBM Plex Mono',monospace);padding:10px 12px}
.cl-form small{font-weight:400;color:var(--muted)}
.cl-or{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin:24px 0 4px;color:var(--muted);font:500 11px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.08em;text-transform:uppercase;max-width:46ch}
.cl-or::before,.cl-or::after{content:"";height:1px;background:var(--line)}
.cl-one{max-width:620px;margin:0 auto;padding:40px max(16px,env(safe-area-inset-right,0px)) 56px max(16px,env(safe-area-inset-left,0px))}
.cl.nar .cl-main{grid-template-columns:minmax(0,1fr);gap:20px;padding-top:20px}.cl.nar .cl-art{order:-1;aspect-ratio:16/10}
.cl.nar .cl-go{width:100%}.cl.nar .cl-one{padding-top:24px}
.cl.duo .cl-main{padding-top:14px;gap:12px}.cl.duo h1{font-size:22px;margin:8px 0 6px}.cl.duo .cl-lede{font-size:13.5px;margin-bottom:12px}.cl.duo .cl-facts{font-size:12px;margin-top:12px;padding-top:10px;gap:3px 12px}.cl.duo .cl-fine,.cl.duo .cl-alt{font-size:12px}.cl.duo .cl-art{aspect-ratio:16/8}.cl.duo .cl-go{min-height:44px;font-size:14.5px}.cl.duo .cl-top{padding-top:10px;padding-bottom:10px}
`;
export const CLAIM_JS = `
function R(s){return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296}}
var TW=22,TH=11,LW=TW*4,LH=TH*4,SW=224,SH=250,OX=112,OY=196;
var PAL=[['#C4693F','#9A4B2B','#D98A5F'],['#2F9A74','#1F7557','#49B58E'],['#3F6DB0','#2C4F86','#6190CF'],['#C9A23F','#9C7B26','#DDBB62'],['#5C6478','#434A5C','#7C859B']];
var SKY={day:{bg:['#8EC5EE','#D5EAF7'],tint:null,lights:0},dusk:{bg:['#2B2350','#8A5578'],tint:['#3A2A5C',.28],lights:.8},night:{bg:['#0D0F22','#1D1A3C'],tint:['#141833',.5],lights:1}};
/* F2 table: the unclaimed look per sky */
var FOG={day:{col:'#C9D3E0',mix:.38,keep:.22,alpha:.78,puff:'232,238,246',pa:.34,line:'rgba(40,52,74,.6)'},
 dusk:{col:'#6F6391',mix:.44,keep:.20,alpha:.74,puff:'150,136,186',pa:.30,line:'rgba(226,214,255,.55)'},
 night:{col:'#1E2440',mix:.56,keep:.16,alpha:.70,puff:'74,84,128',pa:.42,line:'rgba(190,204,240,.5)'}};
function mk(w,h){var c=document.createElement('canvas');c.width=w;c.height=h;return c}
function plan(seed){var r=R(seed),L=[];for(var i=0;i<4;i++)for(var j=0;j<4;j++){var d=Math.abs(i-1.5)+Math.abs(j-1.5),park=r()<.16;L.push({i:i,j:j,h:park?0:Math.round(14+r()*24+(3-d)*(8+20*r())),p:PAL[Math.floor(r()*PAL.length)],s:Math.floor(r()*1e6),d:d+r()*.5})}
 L.sort(function(a,b){return (a.i+a.j)-(b.i+b.j)});L.slice().sort(function(a,b){return a.d-b.d}).forEach(function(b,k){b.k=k});return L}
function poly(c,p,f){c.beginPath();c.moveTo(p[0],p[1]);for(var i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);c.closePath();c.fillStyle=f;c.fill()}
function drawLand(c,seed,mode,lit){var L=plan(seed),W=LW,H=LH;
 if(mode==='base'){poly(c,[-W-4,0,0,-H-2,W+4,0,0,H+2],'#3F7A4A');poly(c,[-W-4,0,0,H+2,0,H+9,-W-4,7],'#2C5A36');poly(c,[W+4,0,0,H+2,0,H+9,W+4,7],'#234A2C');
  c.strokeStyle='#59616E';c.lineWidth=5;c.beginPath();c.moveTo(-W/2,-H/2);c.lineTo(W/2,H/2);c.moveTo(W/2,-H/2);c.lineTo(-W/2,H/2);c.stroke()}
 L.forEach(function(b){var x=(b.i-b.j)*TW,y=(b.i+b.j)*TH-3*TH,w=TW*.8,hh=w/2,h=b.h,r=R(b.s);
  if(!h){if(mode==='base'){for(var t=0;t<3;t++){var tx=x+(r()-.5)*18,ty=y+(r()-.5)*8;c.fillStyle='#2E6B3C';c.beginPath();c.arc(tx,ty-7,6,0,7);c.fill();c.fillStyle='#3F8A4E';c.beginPath();c.arc(tx-1.5,ty-9,4,0,7);c.fill()}}return}
  if(mode==='base'){poly(c,[x-w,y,x,y+hh,x,y+hh-h,x-w,y-h],b.p[0]);poly(c,[x,y+hh,x+w,y,x+w,y-h,x,y+hh-h],b.p[1]);poly(c,[x-w,y-h,x,y-hh-h,x+w,y-h,x,y+hh-h],b.p[2])}
  var a=mode==='lights'?lit(b.k):1,cols=3,cw=w/cols,rows=Math.max(1,Math.floor((h-6)/7));
  for(var f=0;f<2;f++){c.save();if(f===0)c.transform(1,.5,0,1,x-w,y-h);else c.transform(1,-.5,0,1,x,y+hh-h);
   for(var q=0;q<cols;q++)for(var k=0;k<rows;k++){var on=r()<.62;if(mode==='base'){c.fillStyle=f?'rgba(16,22,40,.62)':'rgba(20,28,48,.5)';c.fillRect(q*cw+1.6,4+k*7,cw-3.2,4)}else if(on&&a>0){c.globalAlpha=a;c.fillStyle=f?'#F2B85A':'#FFD98A';c.fillRect(q*cw+1.6,4+k*7,cw-3.2,4)}}
   c.restore()}})}
function sprite(seed,mode,lit){var o=mk(SW*2,SH*2),x=o.getContext('2d');x.scale(2,2);x.translate(OX,OY);drawLand(x,seed,mode,lit||function(){return 1});return o}
function tinted(src,sky){var t=SKY[sky].tint;if(!t)return src;var o=mk(src.width,src.height),x=o.getContext('2d');x.drawImage(src,0,0);x.globalCompositeOperation='source-atop';x.globalAlpha=t[1];x.fillStyle=t[0];x.fillRect(0,0,o.width,o.height);return o}
/* F3: the fogged sprite. No ctx.filter (Safari), only blend modes. */
function fogged(src,sky){var F=FOG[sky],o=mk(src.width,src.height),x=o.getContext('2d');
 x.drawImage(src,0,0);
 x.globalCompositeOperation='saturation';x.fillStyle='#808080';x.fillRect(0,0,o.width,o.height);      /* 1 grey, same lightness */
 x.globalCompositeOperation='destination-in';x.drawImage(src,0,0);                                    /* 2 cut back to the sprite */
 x.globalCompositeOperation='source-over';x.globalAlpha=F.keep;x.drawImage(src,0,0);                   /* 3 keep a little colour */
 x.globalCompositeOperation='source-atop';x.globalAlpha=F.mix;x.fillStyle=F.col;x.fillRect(0,0,o.width,o.height);  /* 4 fog tint */
 return o}
function puff(c,x,y,rx,ry,rgb,a){c.save();c.translate(x,y);c.scale(1,ry/rx);var g=c.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,'rgba('+rgb+','+a+')');g.addColorStop(.55,'rgba('+rgb+','+(a*.55)+')');g.addColorStop(1,'rgba('+rgb+',0)');c.fillStyle=g;c.beginPath();c.arc(0,0,rx,0,7);c.fill();c.restore()}
function fogBand(c,x,y,sky,t,k){var F=FOG[sky],a=F.pa*(k==null?1:k),d=t?Math.sin(t*.00012):0;
 puff(c,x-40+d*6,y+8,62,26,F.puff,a);puff(c,x+34-d*5,y-2,56,24,F.puff,a*.9);puff(c,x+d*4,y+18,70,24,F.puff,a*.8)}
function diamond(c,x,y,W,H){c.beginPath();c.moveTo(x-W,y);c.lineTo(x,y-H);c.lineTo(x+W,y);c.lineTo(x,y+H);c.closePath()}
/* F5: the flag. col=null is the blank Unclaimed flag. */
function flag(c,x,y,col,drop,wave){var fy=y-24+(drop||0);c.fillStyle='#141824';c.fillRect(x-1.5,y-25,3,26);c.fillStyle='#C9D2E6';c.fillRect(x-.5,y-25,1,25);
 c.save();c.translate(x+1.5,fy);var w=13,h=8,s=wave?1:0;c.beginPath();c.moveTo(0,0);c.lineTo(w*.5,s);c.lineTo(w,0);c.lineTo(w,h);c.lineTo(w*.5,h+s);c.lineTo(0,h);c.closePath();
 if(col){c.fillStyle=col;c.fill();c.strokeStyle='rgba(10,12,20,.75)';c.lineWidth=1;c.stroke()}
 else{c.fillStyle='rgba(238,242,250,.94)';c.fill();c.strokeStyle='rgba(10,12,20,.8)';c.lineWidth=1;c.setLineDash([2,1.5]);c.stroke()}
 c.restore()}
function pillX(c,x,y,txt,un){c.font='600 10px "IBM Plex Mono",monospace';var w=c.measureText(txt).width+14;c.fillStyle=un?'rgba(15,16,22,.72)':'rgba(15,16,22,.92)';c.beginPath();c.roundRect(x-w/2,y-9,w,18,9);c.fill();
 if(un){c.setLineDash([3,2]);c.strokeStyle='rgba(201,210,230,.7)';c.lineWidth=1;c.stroke();c.setLineDash([])}
 c.fillStyle=un?'#D7DDEA':'#fff';c.textAlign='center';c.textBaseline='middle';c.fillText(txt,x,y+.5)}
var CACHE={};
function cached(seed,kind,sky){var k=seed+kind+sky;if(CACHE[k])return CACHE[k];var b=CACHE[seed+'base']||(CACHE[seed+'base']=sprite(seed,'base'));
 return CACHE[k]=kind==='fog'?fogged(b,sky):kind==='lit'?tinted(b,sky):(CACHE[seed+'lights']||(CACHE[seed+'lights']=sprite(seed,'lights')))}
function drawClaimed(c,L,sky){c.drawImage(cached(L.seed,'lit',sky),L.x-OX,L.y-OY,SW,SH);var l=SKY[sky].lights;if(l){var s=cached(L.seed,'lights',sky);c.globalAlpha=l;c.drawImage(s,L.x-OX,L.y-OY,SW,SH);c.globalCompositeOperation='lighter';c.globalAlpha=l*.4;c.drawImage(s,L.x-OX,L.y-OY,SW,SH);c.globalCompositeOperation='source-over';c.globalAlpha=1}
 flag(c,L.x,L.y+LH+2,L.col,0,0)}
function drawUnclaimed(c,L,sky,t){var F=FOG[sky];c.globalAlpha=F.alpha;c.drawImage(cached(L.seed,'fog',sky),L.x-OX,L.y-OY,SW,SH);c.globalAlpha=1;
 fogBand(c,L.x,L.y,sky,t+L.seed*97);
 c.setLineDash([6,5]);c.lineWidth=1.5;c.strokeStyle=F.line;diamond(c,L.x,L.y,LW+10,LH+5);c.stroke();c.setLineDash([]);
 flag(c,L.x,L.y+LH+2,null,0,t?Math.floor(t/600)%2:0)}

(function(){var A=window.CL||{},cv=document.getElementById('cl-cv');if(!cv)return;
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,SEED=A.seed||323,COL=A.col||'#8B6CF6',base=sprite(SEED,'base'),lit=tinted(base,'dusk'),fog=fogged(base,'dusk'),T0=A.state==='done'?-1:null,done=A.state==='done';
function ease(v){v=Math.max(0,Math.min(1,v));return 1-Math.pow(1-v,3)}
function frame(cv,p,t){var dpr=Math.min(2,devicePixelRatio||1),w=cv.clientWidth,h=cv.clientHeight;if(!w||!h)return;if(cv.width!==Math.round(w*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}var c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
 var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,SKY.dusk.bg[0]);g.addColorStop(1,SKY.dusk.bg[1]);c.fillStyle=g;c.fillRect(0,0,w,h);
 var z=Math.min(w/250,h/215);c.save();c.translate(w/2,h/2+52*z);c.scale(z,z);
 var on=p!=null,k=!on?0:reduce?ease(p/300):ease(p/900),F=FOG.dusk;
 if(k<1){c.globalAlpha=F.alpha*(1-k);c.drawImage(fog,-OX,-OY,SW,SH)}
 if(k>0){c.globalAlpha=k;c.drawImage(lit,-OX,-OY,SW,SH)}c.globalAlpha=1;
 if(k<1){c.save();c.translate(0,-24*k);fogBand(c,0,0,'dusk',reduce?0:t,1-k);c.restore()}
 if(on){var s=sprite(SEED,'lights',function(i){return reduce?k:ease((p-700-i*60)/180)});c.drawImage(s,-OX,-OY,SW,SH);c.globalCompositeOperation='lighter';c.globalAlpha=.4;c.drawImage(s,-OX,-OY,SW,SH);c.globalCompositeOperation='source-over';c.globalAlpha=1}
 var d=!on?1:reduce?1-k:1-ease((p-2100)/500);if(d>0){c.globalAlpha=d;c.setLineDash(on&&p>2100?[]:[6,5]);c.lineWidth=1.5;c.strokeStyle=F.line;diamond(c,0,0,LW+10,LH+5);c.stroke();c.setLineDash([]);c.globalAlpha=1}
 var fl=!on?0:reduce?(k>=1?2:0):p<1500?0:p<1800?(p-1500)/300:p<2100?1+(p-1800)/300:2;
 flag(c,0,LH+2,fl>=1?COL:null,fl<1?fl*8:(2-fl)*8,!on&&!reduce?Math.floor(t/600)%2:0);
 if(on&&!reduce&&p>1800&&p<2700){var q=(p-1800)/900;c.globalAlpha=.8*(1-q);c.strokeStyle=COL;c.lineWidth=2;c.beginPath();c.ellipse(0,LH*.2,ease(q)*LW*1.5,ease(q)*LH*1.5,0,0,7);c.stroke();c.globalAlpha=1}
 c.restore()}
function loop(t){if(T0===-1)T0=t;var p=done?(T0==null?1e6:t-T0):null;if(p!=null&&p>2700){p=1e6;T0=null}
 frame(cv,p,t);if(!reduce&&!done||(p!=null&&p<2800))requestAnimationFrame(loop);else setTimeout(function(){requestAnimationFrame(loop)},reduce?1000:400)}
requestAnimationFrame(loop);
if(done){var h=document.getElementById('cl-h');if(h)h.focus({preventScroll:true});var lv=document.getElementById('cl-live');if(lv)setTimeout(function(){lv.textContent='Claimed. Your city is lit.'},300)}
var again=document.getElementById('cl-again');if(again)again.addEventListener('click',function(){T0=-1;requestAnimationFrame(loop)});
addEventListener('resize',function(){frame(cv,done?1e6:null,performance.now())})})();
`;
export const GH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>`;
export const FLAG_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h12l-2.5 4 2.5 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 2.5"/></svg>`;

/** the World map's "Add a GitHub" box (frontier-design E1, mockup 05) */
export const WADD_CSS = String.raw`.w-add{display:grid;gap:6px;min-width:0;font:14px/1.45 var(--font-sans,'IBM Plex Sans',sans-serif);color:var(--text)}
.w-add-f{display:flex;gap:6px;min-width:0}
.w-add-in{position:relative;flex:1 1 auto;min-width:0}
.w-add-in>span{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text-muted);font:600 14px/1 var(--font-mono,'IBM Plex Mono',monospace);pointer-events:none}
.w-add-in input{box-sizing:border-box;width:100%;min-height:40px;padding:0 10px 0 27px;border-radius:999px;border:1px solid var(--line);background:var(--bg-raised);color:var(--text-strong);font:500 14px/1 var(--font-mono,'IBM Plex Mono',monospace)}
.w-add-in input::placeholder{color:var(--text-muted);font-family:var(--font-sans,'IBM Plex Sans',sans-serif)}
.w-add-in input:focus-visible,.w-add-b:focus-visible,.w-add a:focus-visible,.w-add-r button:focus-visible{outline:2px solid var(--accent-btn,var(--accent));outline-offset:2px}
.w-add-b{flex:none;min-height:40px;padding:0 16px;border-radius:999px;border:0;background:var(--accent-btn,var(--accent));color:var(--on-accent);font:600 14px/1 var(--font-sans,'IBM Plex Sans',sans-serif);cursor:pointer;white-space:nowrap}
.w-add-b[aria-busy="true"]{opacity:.7;cursor:progress}
.w-add-h{margin:0;font-size:12.5px;color:var(--text-muted)}
.w-add-r{margin:0;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg-raised);font-size:13px;color:var(--text);display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px}
.w-add-r b{color:var(--text-strong)}.w-add-r a,.w-add-r button{color:var(--accent-text);font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);background:none;border:0;padding:0;min-height:32px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.w-add-r[data-st="bad"]{border-color:var(--danger)}.w-add-r[data-st="limit"]{border-color:#E5A00D}
.w-add-r[data-st="ok"]{border-style:dashed}
@media (max-width:600px){.w-add-in input,.w-add-b{min-height:44px}.w-add-in input{font-size:16px}}
.w-head .w-add{flex:1 1 320px;max-width:440px;margin-left:auto;align-self:center;order:9}
@media (max-width:600px){.w-main .w-head .w-add{flex:none;width:100%;max-width:none;margin:6px 0 0;order:0}}
.w-add .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.w-add-url{width:100%;box-sizing:border-box;min-height:36px;border-radius:8px;border:1px solid var(--line);background:var(--bg-raised);color:var(--text-strong);font:12px var(--font-mono,'IBM Plex Mono',monospace);padding:0 8px}`;
export const WADD_HTML = String.raw`<form class="w-add" id="w-add" novalidate><div class="w-add-f"><div class="w-add-in"><span aria-hidden="true">@</span><label class="sr" for="w-add-u">GitHub username to add to the map</label><input id="w-add-u" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="39" placeholder="GitHub username" aria-describedby="w-add-h"></div><button type="submit" class="w-add-b">Add to the map</button></div><p class="w-add-h" id="w-add-h">Add a friend's GitHub. Their city appears on the frontier, unclaimed, until they claim it.</p></form>`;
export const WADD_JS = String.raw`(function(){var f=document.getElementById('w-add');if(!f)return;var u=f.querySelector('input'),b=f.querySelector('.w-add-b'),hint=f.querySelector('.w-add-h'),busy=false,
GHL=/^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function out(st,html){var r=f.querySelector('.w-add-r');if(!r){r=document.createElement('p');r.className='w-add-r';f.appendChild(r)}hint.hidden=true;r.setAttribute('data-st',st);r.setAttribute('role',st==='bad'||st==='limit'?'alert':'status');var k=html.search(/ ?<(a|button) /);r.innerHTML=k>0?'<span>'+html.slice(0,k)+'</span>'+html.slice(k):'<span>'+html+'</span>';wire(r)}
function view(l){return '<a href="/world?focus='+encodeURIComponent(l)+'">View the land</a>'}
function wire(r){var c=r.querySelector('[data-copy]');if(c)c.onclick=function(){var url=location.origin+'/claim/'+c.getAttribute('data-copy'),ok=function(){c.textContent='Copied';setTimeout(function(){c.textContent='Copy the claim link'},2000)},
  no=function(){var i=document.createElement('input');i.readOnly=true;i.value=url;i.className='w-add-url';i.setAttribute('aria-label','Claim link');c.replaceWith(i);i.focus();i.select()};try{navigator.clipboard.writeText(url).then(ok,no)}catch(x){no()}};
  var t=r.querySelector('[data-retry]');if(t)t.onclick=function(){go()}}
function done(){busy=false;b.removeAttribute('aria-busy');b.disabled=false;b.textContent='Add to the map'}
function go(){if(busy)return;var l=u.value.trim().replace(/^@/,'');if(!l){u.focus();return}
  if(!GHL.test(l)){out('bad','<b>No GitHub user named @'+e(l)+'.</b> Check the spelling. Use the username from github.com/username.');return}
  busy=true;b.disabled=true;b.setAttribute('aria-busy','true');b.textContent='Checking...';hint.hidden=false;hint.textContent='Checking GitHub for @'+l+'...';var r0=f.querySelector('.w-add-r');if(r0)r0.remove();
  fetch('/v1/frontier/add',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({login:l})}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}})}).then(function(x){done();var j=x.j||{},L=j.login||l;
    if(x.s===401){out('bad','<b>Sign in to add a GitHub.</b> The land shows who added it. <a href="/auth/github?back=%2Fworld">Sign in with GitHub</a>');return}
    if(x.s===200&&j.ok){out('ok',j.st==='land'?'<b>@'+e(L)+' is already on the frontier</b>'+(j.by?', added by '+e(j.by)+'.':'.')+' '+view(L)+' <button type="button" data-copy="'+e(L)+'">Copy the claim link</button>':'<b>@'+e(L)+' is on the frontier.</b> The land is unclaimed until they claim it. Caldera does not contact them. '+view(L)+' <button type="button" data-copy="'+e(L)+'">Copy the claim link</button>');u.value='';u.focus();return}
    if(j.st==='member'){out('ok','<b>@'+e(j.handle||L)+' is already on Caldera.</b> <a href="/world?focus='+encodeURIComponent(j.handle||L)+'">View their city</a>');return}
    if(x.s===429||j.st==='limit'){out('limit','<b>You added 20 GitHubs today.</b> That is the daily limit. You can add more after midnight Pacific.');return}
    if(j.st==='missing'){out('bad','<b>No GitHub user named @'+e(L)+'.</b> Check the spelling. Use the username from github.com/username.');return}
    if(j.st==='blocked'){out('bad','<b>That username can\'t be shown on the map.</b> It contains a word Caldera does not show.');return}
    if(j.st==='removed'){out('bad','<b>@'+e(L)+' can\'t be added.</b> This person asked not to be on Caldera.');return}
    if(j.st==='org'){out('bad','<b>@'+e(L)+' is an organization.</b> Only a person\'s GitHub can be a land.');return}
    out('bad','<b>Could not reach GitHub.</b> Nothing was added. <button type="button" data-retry>Try again</button>')}).catch(function(){done();out('bad','<b>Could not reach GitHub.</b> Nothing was added. <button type="button" data-retry>Try again</button>')})}
f.onsubmit=function(ev){ev.preventDefault();go()};if(location.hash==='#add'){try{f.scrollIntoView({block:'center'})}catch(x){}u.focus()}})();`;
