'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.json');
const {episodeSources, status:sourceStatus} = require('./sources');
const {loadRemoteSources,providerStatus} = require('./providers');
const episodeLinks = require('./episode-watch-links.json');
const { getEpisodes } = require('./metadata');
const PORT = Number(process.env.PORT) || 7000;
const SERIES_ID = 'tt2185037'; // Official IMDb series identifier, shared across compatible metadata/stream addons.
const LEGACY_SERIES_ID = 'rmhd:runningman'; // Keep v1.7 bookmarks working.
const SAMPLE_ID = 'rmhd:sample';
const SAMPLE_VIDEO_ID = 'rmhd:sample:1';
// Creative Commons Attribution 3.0: Blender Foundation (2008), Big Buck Bunny.
// Independently hosted demo links are provided as-is; provider uptime may vary.
const SAMPLE_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const SAMPLE = {
  id: SAMPLE_ID,
  type: 'series',
  name: 'Player Test — Big Buck Bunny (SAMPLE)',
  description: 'A separate open-licensed sample for testing in-app playback in Nuvio or Stremio. NOT a Running Man episode. Big Buck Bunny © 2008 Blender Foundation, CC BY 3.0.',
  releaseInfo: '2008',
  genres: ['Animation'],
  links: [{name:'License and attribution',category:'other',url:'https://peach.blender.org/about/'}]
};
const SERIES_URL = config.goplaySeriesPage;
const isHttps = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
const html = value => String(value ?? '').replace(/[&<>"']/g, v => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v]));
const epNumber = value => { const match = /^rmhd:ep:(\d{1,4})$/.exec(value); return match ? Number(match[1]) : null; };
const customWatch = (number) => {
  const link = episodeLinks[String(number)];
  return (isHttps(link) && /^https:\/\/goplay\.su\//i.test(link)) ? link : null;
};
const SERIES = {
  id: SERIES_ID, type: 'series', name: 'Running Man (2010)',
  description: 'A South Korean variety series. Browse every indexed episode; GoPlay is linked as an external website, not an in-app stream.',
  genres: ['Variety', 'Comedy'], releaseInfo: '2010–',
  links: [{name:'Episode guide',category:'other',url:'https://www.tvmaze.com/shows/3479/running-man'}]
};
const manifest = {
  id: 'org.community.runningman.goplay.browser',
  version: '1.9.0',
  name: 'Running Man HD | Dual Sources',
  description: 'Running Man episode guide, GoPlay browser links and opt-in licensed HLS feed or Stremio addon bridge. No scraped or protected videos included.',
  types: ['series'], idPrefixes: ['rmhd:', 'tt2185037'],
  resources: ['catalog','meta','stream','subtitles'],
  catalogs: [{type:'series', id:'rmhd-catalog', name:'Running Man', extra:[{name:'search',isRequired:false}]}],
  behaviorHints: {configurable:false, configurationRequired:false}
};
function seriesPreview(origin) {return {id:SERIES.id, type:SERIES.type, name:SERIES.name, poster:origin+'/poster.png', posterShape:'poster', description:SERIES.description, genres:SERIES.genres, releaseInfo:SERIES.releaseInfo};}
function samplePreview(origin) {
  return { ...SAMPLE, poster:origin+'/sample-poster.svg', posterShape:'poster' };
}
function sampleVideo() {
  return {id:SAMPLE_VIDEO_ID, title:'Player Test (not Running Man)', season:1, episode:1,
    released:'2008-04-10T00:00:00.000Z', overview:'Big Buck Bunny — an open-licensed HLS playback and English demonstration-caption test. These captions are a test signal, not dialogue or official subtitles. © 2008 Blender Foundation (CC BY 3.0).'};
}
// Diagnostic captions, not movie dialogue. SRT is the default because some Nuvio
// clients list WebVTT addon subtitles but fail to render them. We show short test
// markers throughout the movie, not just in the first 31 seconds.
function cueTime(seconds, srt=false) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}${srt ? ',000' : '.000'}`;
}
const TEST_CUES = Array.from({length:30}, (_,i) => {
  const start = 2 + i*20;
  return {start, end:start+9, text: i%2===0
    ? 'Running Man HD - ENGLISH SUBTITLE TEST (not movie dialogue)'
    : 'If you can read this, Nuvio is rendering external subtitles.'};
});
const SAMPLE_SRT = TEST_CUES.map((c,i) => `${i+1}\r\n${cueTime(c.start,true)} --> ${cueTime(c.end,true)}\r\n${c.text}\r\n`).join('\r\n');
const SAMPLE_VTT = 'WEBVTT\n\n' + TEST_CUES.map(c => `${cueTime(c.start)} --> ${cueTime(c.end)}\n${c.text}\n`).join('\n');
function sampleSubtitles(origin) {
  return [{id:'rmhd-sample-en-srt-v16',lang:'eng',name:'English (SRT test)',url:origin+'/sample-captions-v16.srt'}];
}
function sampleStreams(origin) {
  return [{
    name:'TEST ONLY • HLS + English captions',
    description:'Working HLS format • Big Buck Bunny • NOT Running Man • CC BY 3.0',
    url:SAMPLE_HLS,
    subtitles: sampleSubtitles(origin),
    behaviorHints:{notWebReady:true,filename:'BigBuckBunny.m3u8'}
  }];
}
function episodeVideo(e, legacy=false) {
  const v = { id: legacy ? `rmhd:ep:${e.number}` : `${SERIES_ID}:1:${e.number}`, title:e.title, season:1, episode:e.number,
    overview:e.description || `Running Man — Episode ${e.number}. Video links open in an external browser where supported.`};
  if (e.airDate) v.released = e.airDate + 'T00:00:00.000Z';
  if (e.thumbnail && isHttps(e.thumbnail)) v.thumbnail = e.thumbnail;
  return v;
}
async function resolvedSources(n, origin) {
  const local=episodeSources(n,origin);
  const remote=await loadRemoteSources(n,origin);
  const all=[...local.streams,...remote.feed.streams,...remote.bridge.streams];
  const used=new Set();
  const direct=all.filter(s=> {
    if(!s.url || used.has(s.url)) return false;
    used.add(s.url);return true;
  });
  const subs=direct.flatMap(s=>s.subtitles||[]);
  const seen=new Set();
  return {streams:direct,subtitles:subs.filter(s=> {
    const key=s.lang+'|'+s.url;
    if(seen.has(key))return false;
    seen.add(key); return true;
  })};
}
async function videoStreams(n, origin) {
  const direct=(await resolvedSources(n,origin)).streams;
  const page=customWatch(n) || SERIES_URL;
  const external=isHttps(page) ? [{
    name:'GoPlay — open website',
    description:customWatch(n)?'Open the specific episode webpage':'Open the series webpage and choose an episode',
    externalUrl:page
  }] : [];
  return [...direct,...external];
}
async function subtitleTracks(n, origin) {
  return (await resolvedSources(n,origin)).subtitles;
}
function reply(res,status,payload,contentType='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type':contentType,'Cache-Control':'public, max-age=180', 'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Range',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
  res.end(typeof payload==='string'?payload:JSON.stringify(payload));
}
function layout(body, title='Running Man HD') {
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#101526"><title>${html(title)}</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0d1220;color:#f4f7ff;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}a{color:#6de8e3;text-decoration:none}a:hover{text-decoration:underline}.wrap{width:min(1024px,calc(100% - 32px));margin:auto}header{position:sticky;top:0;background:#101627ec;backdrop-filter:blur(12px);border-bottom:1px solid #29344a;padding:14px 0;z-index:2}.brand{font-size:18px;font-weight:800;color:white}.pill{font-size:12px;color:#6de8e3;border:1px solid #275c67;border-radius:100px;padding:3px 9px;margin-left:8px}main{padding:28px 0 72px}.hero{border:1px solid #2b344b;background:linear-gradient(135deg,#1c2545,#131c2d);padding:26px;border-radius:20px;margin-bottom:18px}h1{font-size:clamp(27px,5vw,42px);line-height:1.16;margin:0 0 10px}h2{font-size:20px;margin:0 0 12px}.muted{color:#acbad1}.notice{color:#f0d5a3;border-left:3px solid #efba60;padding:7px 11px;background:#352a1d;margin:15px 0;border-radius:0 8px 8px 0}.buttons{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.btn{display:inline-block;background:#61ddd8;color:#071b22;padding:10px 14px;border-radius:10px;font-weight:800;border:0;cursor:pointer;font:inherit}.btn.alt{background:#253148;color:white}.btn:focus-visible,input:focus-visible{outline:3px solid #f5bf6e;outline-offset:2px}input{width:100%;background:#151e30;border:1px solid #415170;border-radius:12px;color:white;padding:12px 14px;font:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-top:18px}.tile{background:#151e30;border:1px solid #29354d;border-radius:14px;padding:14px;min-height:109px;display:block;color:white}.tile:hover{border-color:#68dcd8;text-decoration:none}.tile b{display:block;margin-bottom:6px;font-size:17px}.tile small{display:block;color:#aebcd2}.card{background:#151e30;border:1px solid #2b354e;border-radius:14px;padding:20px;margin-top:18px}.stats{color:#8aefce;font-weight:700}.links{overflow-wrap:anywhere}.kbd{background:#26334b;padding:2px 6px;border-radius:6px}footer{font-size:13px;color:#93a3bd;margin-top:36px}select{background:#151e30;color:white;padding:10px;border:1px solid #40516c;border-radius:10px}form{display:flex;gap:8px;flex-wrap:wrap}form input{flex:1;min-width:180px}#pages{margin:16px 0;color:#aabbce}
</style></head><body><header><div class="wrap"><a class="brand" href="/">🏃 Running Man HD</a><span class="pill">Mobile companion</span></div></header><main class="wrap">${body}<footer>Unofficial episode guide. Not affiliated with SBS or GoPlay. This server never downloads or rehosts their videos. Optional HLS sources require explicit permission for third-party use; addon integration alone does not grant video rights.</footer></main></body></html>`;
}
function watchHome(episodes, search='') {
  const count = episodes.length;
  const safeQuery = search.trim().toLowerCase();
  const results = safeQuery ? episodes.filter(e=>String(e.number).includes(safeQuery)||e.title.toLowerCase().includes(safeQuery)||String(e.airDate||'').includes(safeQuery)) : episodes;
  // Default to 30, make paging functional without JS.
  const currentPage = Math.max(1,Math.floor(Number(search ? 1 : 1)));
  const welcome = `<section class="hero"><h1>Running Man, episode by episode.</h1><p class="muted">Browse ${count} indexed episodes, from 2010 onwards, and open the GoPlay website for watching in your Android browser.</p><p class="notice">GoPlay's website may offer 1080p and English CC, but those playback options are controlled by GoPlay. This addon does <strong>not</strong> contain GoPlay video streams.</p><div class="buttons"><a class="btn" href="/episode/1">Start at Episode 1</a><a class="btn alt" href="/episode/${count}">Latest indexed episode</a><a class="btn alt" href="/player-test">Test Nuvio playback</a></div></section>`;
  const finder = `<form action="/" method="get"><input aria-label="Search episodes" name="q" placeholder="Episode number, title, or air date" value="${html(search)}"><button type="submit" class="btn">Search</button></form>`;
  return { welcome, finder, results, count };
}
function homepage(episodes, url) {
  const query = url.searchParams.get('q') || '';
  const {welcome,finder,results,count} = watchHome(episodes,query);
  const page = Math.min(10000,Math.max(1,parseInt(url.searchParams.get('page')||'1',10)||1));
  const pageSize=36, totalPages=Math.max(1,Math.ceil(results.length/pageSize));
  const current=Math.min(page,totalPages);
  const chunk=results.slice((current-1)*pageSize,current*pageSize);
  const tiles=chunk.map(e=>`<a class="tile" href="/episode/${e.number}"><b>Episode ${e.number}</b><small>${html(e.title !== `Episode ${e.number}` ? e.title : 'Running Man')}</small><small>${html(e.airDate || 'Air date unavailable')}</small></a>`).join('');
  const params=(n)=>`/?page=${n}${query?'&q='+encodeURIComponent(query):''}`;
  const pagination=`<div class="buttons">${current>1?`<a class="btn alt" href="${params(current-1)}">← Previous</a>`:''}${current<totalPages?`<a class="btn alt" href="${params(current+1)}">Next →</a>`:''}</div>`;
  return layout(welcome+finder+`<p id="pages">${results.length} results · Page ${current} of ${totalPages}</p><div class="grid">${tiles||'<p>No matching episodes.</p>'}</div>${pagination}<div class="card"><h2>Install addon</h2><p>Use the addon URL ending in <span class="kbd">/manifest.json</span> in Stremio or Nuvio. Nuvio may not open browser-only streams correctly; this website is the reliable browser-link fallback. Authorized HLS stream integration is available when configured.</p><p class="links"><a href="/manifest.json">See addon manifest</a></p></div>`, 'Running Man HD — Episode Guide');
}
function episodePage(episodes,n,origin) {
  const configured=episodeSources(n,origin).streams.length;
  const e=episodes[n-1], directLink=customWatch(n);
  const target=directLink || SERIES_URL;
  const previous=n>1?`<a class="btn alt" href="/episode/${n-1}">← Episode ${n-1}</a>`:'';
  const next=n<episodes.length?`<a class="btn alt" href="/episode/${n+1}">Episode ${n+1} →</a>`:'';
  const note=directLink?'This is an episode-specific GoPlay page configured by you.':'This is the Running Man Classics series page, <strong>not an Episode '+n+' video link</strong>. Select Episode '+n+' on the site.';
  return layout(`<section class="hero"><p class="stats">RUNNING MAN · EPISODE ${n}</p><h1>${html(e.title)}</h1><p class="muted">${html(e.airDate||'Air date not listed')}</p><p>${html(e.description||'Episode details and the watch site are available below.')}</p><div class="buttons">${previous}${next}</div></section><div class="card"><h2>Watch in browser</h2><p class="notice">${note} Quality and subtitles are controlled by the destination website; external playback is not guaranteed.</p><div class="buttons"><a class="btn" href="${html(target)}" rel="noopener noreferrer" target="_blank">Open GoPlay website ↗</a><a class="btn alt" href="/">Browse episodes</a></div></div><div class="card"><h2>In-app playback status</h2><p>${configured ? `${configured} authorized HLS source(s) configured. Open this episode in Nuvio to choose them.` : `No local direct HLS source is configured. Optional remote sources may be available if you have configured an authorized feed or bridge.`}</p><p><a href="/sources/status.json">View source integration status</a></p></div><div class="card"><h2>About Stremio &amp; Nuvio</h2><p>Stremio may show a website-opening entry. Some versions of Nuvio do not honor browser-only stream links. If playback fails in Nuvio, open this companion page in your phone's browser.</p></div>`, `Running Man Episode ${n}`);
}
async function handle(req,res) {
  if(req.method==='OPTIONS') return reply(res,204,'');
  if(!['GET','HEAD'].includes(req.method)) return reply(res,405,{error:'Method not allowed'});
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname=decodeURIComponent(url.pathname);
  const origin = `${(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).toString().split(',')[0]}://${req.headers.host || 'localhost'}`;
  if(pathname==='/manifest.json') return reply(res,200,manifest);
  if(pathname==='/sample-poster.svg') {
    const artwork=fs.readFileSync(path.join(__dirname,'sample-poster.svg'));
    res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Content-Length':artwork.length,
      'Cache-Control':'public, max-age=86400','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
    return res.end(req.method==='HEAD' ? undefined : artwork);
  }
  const captionPath = /^\/captions\/(ep-\d{1,4}(?:-[a-z]{2,3})?\.srt)$/.exec(pathname);
  if(captionPath) {
    const f=path.join(__dirname,'captions',captionPath[1]);
    if(!fs.existsSync(f))return reply(res,404,{error:'Caption file not found'});
    const file=fs.readFileSync(f);
    res.writeHead(200,{'Content-Type':'application/x-subrip; charset=utf-8',
      'Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*',
      'Content-Length':file.length,'X-Content-Type-Options':'nosniff'});
    return res.end(req.method==='HEAD'?undefined:file);
  }
  if(pathname==='/poster.png') {
    const poster=fs.readFileSync(path.join(__dirname,'poster.png'));
    res.writeHead(200,{'Content-Type':'image/png','Content-Length':poster.length,'Cache-Control':'public, max-age=86400','Access-Control-Allow-Origin':'*'});
    return res.end(req.method==='HEAD' ? undefined : poster);
  }
  if(pathname==='/health') return reply(res,200,{status:'ok',version:manifest.version,mode:'GoPlay browser guide + authorized HLS adapter + proven independent HLS/SRT sample'});
  if(pathname==='/sources/status.json') return reply(res,200,{...sourceStatus(),remote:providerStatus()});
  if(pathname==='/favicon.ico') return reply(res,204,'');
  if(pathname==='/sample-captions.vtt') return reply(res,200,SAMPLE_VTT,'text/vtt; charset=utf-8');
  if(pathname==='/sample-captions-v16.srt') return reply(res,200,SAMPLE_SRT,'application/x-subrip; charset=utf-8');
  if(pathname==='/catalog/series/rmhd-catalog.json' || /^\/catalog\/series\/rmhd-catalog\/.+\.json$/.test(pathname)) {
    const query=url.searchParams.get('search') || (pathname.match(/search=([^/]+)\.json$/)?.[1] || '');
    const q=decodeURIComponent(query).trim().toLowerCase();
    const matching=!q || ('running man variety 런닝맨').includes(q);
    const testMatching=!q || ('player test big buck bunny sample').includes(q);
    const metas=[];
    if(matching) metas.push(seriesPreview(origin));
    if(testMatching) metas.push(samplePreview(origin));
    return reply(res,200,{metas});
  }
  if(pathname===`/meta/series/${SAMPLE_ID}.json`) {
    return reply(res,200,{meta:{...samplePreview(origin),videos:[sampleVideo()]}});
  }
  if(pathname===`/meta/series/${SERIES_ID}.json` || pathname===`/meta/series/${LEGACY_SERIES_ID}.json`) {
    const episodes=await getEpisodes();
    const legacy = pathname === `/meta/series/${LEGACY_SERIES_ID}.json`;
    return reply(res,200,{meta:{...SERIES, id:legacy?LEGACY_SERIES_ID:SERIES_ID, poster:origin+'/poster.png', posterShape:'poster', videos:episodes.map(e=>episodeVideo(e,legacy))}});
  }
  if(pathname===`/stream/series/${SAMPLE_VIDEO_ID}.json`) return reply(res,200,{streams:sampleStreams(origin)});
  const streamMatch=/^\/stream\/series\/(rmhd:ep:\d{1,4}|tt2185037:1:\d{1,4})\.json$/.exec(pathname);
  if(streamMatch){const episodes=await getEpisodes();const n=epNumber(streamMatch[1]) ?? Number(streamMatch[1].split(':')[2]);return reply(res,200,{streams:n && n<=episodes.length?await videoStreams(n,origin):[]});}
  if(pathname===`/subtitles/series/${SAMPLE_VIDEO_ID}.json`) return reply(res,200,{subtitles:sampleSubtitles(origin)});
  const subtitleMatch=/^\/subtitles\/series\/(rmhd:ep:\d{1,4}|tt2185037:1:\d{1,4})\.json$/.exec(pathname);
  if(subtitleMatch){const episodes=await getEpisodes();const n=epNumber(subtitleMatch[1]) ?? Number(subtitleMatch[1].split(':')[2]);return reply(res,200,{subtitles:n && n<=episodes.length?await subtitleTracks(n,origin):[]});}
  if(pathname==='/player-test') return reply(res,200,layout(`<section class="hero"><p class="stats">IN-APP HLS + SRT CAPTIONS TEST</p><h1>Big Buck Bunny — sample video</h1><p>This is <strong>not</strong> a Running Man episode. Big Buck Bunny © 2008 Blender Foundation, licensed under CC BY 3.0.</p><p class="notice">In Nuvio: Discover → Running Man catalog → Player Test — Big Buck Bunny → Episode 1 → choose <strong>TEST ONLY • HLS + English captions</strong>. The MP4 test remains removed because it did not play on the tested device.</p><p>To test captions, open the player subtitle/CC menu and select the English track. Choose English (SRT test); diagnostic captions should repeat every 20 seconds during the first 10 minutes. If no captions render, verify the SRT URL in your phone browser and test a different player. These are <strong>demonstration captions, not official film dialogue</strong>. If captions do not appear, try Nuvio Settings → Player → Addon Subtitle Startup → All subtitles, then reopen the test (menu names can vary).</p><div class="buttons"><a class="btn alt" href="/">Back to Running Man</a><a class="btn alt" href="/sample-captions-v16.srt">Inspect SRT captions</a><a class="btn alt" href="/sample-captions.vtt">VTT fallback (browser only)</a><a class="btn alt" href="https://peach.blender.org/about/" target="_blank" rel="noopener noreferrer">License and attribution ↗</a></div></section>`, 'Nuvio HLS + Captions Test — Big Buck Bunny'),'text/html; charset=utf-8');
  const directEpisode=/^\/episode\/(\d{1,4})\/?$/.exec(pathname);
  if(directEpisode){const episodes=await getEpisodes();const n=Number(directEpisode[1]); if(n<1||n>episodes.length)return reply(res,404,layout('<h1>Episode not indexed</h1><p><a href="/">Go back</a></p>'),'text/html; charset=utf-8');return reply(res,200,episodePage(episodes,n,origin),'text/html; charset=utf-8');}
  if(pathname==='/' || pathname==='/browse'){const episodes=await getEpisodes();return reply(res,200,homepage(episodes,url),'text/html; charset=utf-8');}
  return reply(res,404,{error:'Route not found'});
}
function makeServer() {return http.createServer((req,res)=>handle(req,res).catch(err=>{console.error(err);if(!res.headersSent)reply(res,500,{error:'Server error'});else res.end();}));}
if(require.main===module) {
 const server = makeServer(); server.listen(PORT,'0.0.0.0',()=>console.log(`Running Man HD v1.9 running on http://localhost:${PORT}`));
}
module.exports = { makeServer, manifest, videoStreams, episodeVideo, epNumber, isHttps, sampleStreams, sampleSubtitles, SAMPLE_ID, SAMPLE_VIDEO_ID, SERIES_ID, LEGACY_SERIES_ID };
