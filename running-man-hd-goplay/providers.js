'use strict';
// Opt-in adapters for providers that explicitly allow third-party playback.
// Reads Stremio-compatible stream JSON or licensed JSON episode feeds.
// Does not extract streaming websites, forward credentials, download video, or bypass DRM.
const { normalize } = require('./sources');
const onetouch = require('./onetouchtv');
const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 4000;
const CACHE_MS = 90000;
const feedCache = new Map();
const bridgeCache = new Map();

function publicHttps(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443') return null;
    if (!host.includes('.') || /(^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$)/i.test(host)) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') || host === '169.254.169.254') return null;
    return u;
  } catch { return null; }
}
function config() {
  const feed = publicHttps(process.env.RMHD_LICENSED_FEED_URL);
  const bridge = publicHttps(process.env.RMHD_BRIDGE_MANIFEST_URL);
  return {
    feedUrl: feed?.href || null,
    bridgeManifest: bridge && bridge.pathname.endsWith('/manifest.json') && !bridge.search && !bridge.hash ? bridge.href : null,
  };
}
async function fetchJson(url, fetchImpl = globalThis.fetch) {
  const target = publicHttps(url);
  if (!target) throw new Error('Provider must use a public HTTPS URL');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(target.href, {signal:ctrl.signal, redirect:'manual', headers:{'Accept':'application/json'}, method:'GET'});
    if (response.status !== 200) throw new Error(`Provider returned HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) throw new Error('Provider response too large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Provider has no response body');
    let total = 0;
    const chunks=[];
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {await reader.cancel(); throw new Error('Provider response too large');}
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {clearTimeout(timeout);}
}
function cached(cache,key,load) {
  const existing=cache.get(key);
  if(existing && Date.now()<existing.expires) return existing.promise;
  const promise=Promise.resolve().then(load);
  cache.set(key,{expires:Date.now()+CACHE_MS,promise});
  promise.catch(()=>{if(cache.get(key)?.promise===promise)cache.delete(key);});
  return promise;
}
function feedRows(document,episode) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return [];
  const episodes = document.episodes && typeof document.episodes==='object' ? document.episodes : document;
  const row = episodes[String(episode)];
  return Array.isArray(row) ? row : Array.isArray(row?.streams) ? row.streams : [];
}
function normalizeBridgeResponse(episode, payload, origin) {
  if (!payload || typeof payload!=='object' || !Array.isArray(payload.streams)) return {streams:[], subtitles:[]};
  // Only direct HTTPS HLS links are accepted. externalUrl, torrent hashes, headers,
  // cookies, custom auth and DRM fields are intentionally ignored.
  const rows = payload.streams.map(s=> ({name:`Bridge: ${String(s?.name || 'HLS').slice(0,48)}`,
    url:s?.url,
    quality: s?.quality || 'auto',
    subtitles: s?.subtitles
  }));
  return normalize(episode,rows,origin);
}
function providerStatus() {
  const cfg=config();
  return {independentFeed:cfg.feedUrl?'configured':'not configured',
    addonBridge:cfg.bridgeManifest?'configured':'not configured',
    ...onetouch.status(),
    note:'Provider URLs are set through Render environment variables. Only explicitly permitted HLS streams may be supplied.'};
}
async function loadRemoteSources(episode, origin, options={}) {
  const cfg = options.config || config();
  const requester = options.fetchJson || fetchJson;
  const empty = {streams:[],subtitles:[]};
  let feed = empty, bridge = empty, onetouchData = empty;
  if(options.onetouchEnabled ?? onetouch.enabled()) {
    try {
      onetouchData=await onetouch.getEpisode(episode,origin,{getApi:options.onetouchGetApi});
    } catch(err) {console.warn('[onetouchtv]',String(err?.message||err));}
  }
  if (cfg.feedUrl) {
    try {
      const data=await cached(feedCache,cfg.feedUrl,()=>requester(cfg.feedUrl));
      const rows=feedRows(data,episode).map(row=>({ ...row, name:`Feed: ${String(row?.name||'Licensed HLS').slice(0,48)}`}));
      feed=normalize(episode,rows,origin);
    } catch (err) { console.warn('[independent feed]', String(err?.message||err)); }
  }
  if (cfg.bridgeManifest) {
    const base=cfg.bridgeManifest.slice(0,-'manifest.json'.length);
    const videoId=`tt2185037:1:${episode}`;
    const route = new URL(`stream/series/${videoId}.json`,base).href;
    try {
      // Check the remote addon actually declares compatible stream functionality.
      const manifest = await cached(bridgeCache,cfg.bridgeManifest,()=>requester(cfg.bridgeManifest));
      const canStream = Array.isArray(manifest?.resources) && manifest.resources.some(r => r==='stream' || (r && r.name==='stream'));
      if(canStream) {
        const payload=await cached(bridgeCache,route,()=>requester(route));
        bridge=normalizeBridgeResponse(episode,payload,origin);
        // Running Man has a verified TMDB identifier as well as an IMDb ID.
        // A cooperating addon may index only one of those IDs.
        if (!bridge.streams.length) {
          const tmdbRoute=new URL(`stream/series/tmdb:33238:1:${episode}.json`,base).href;
          const other=await cached(bridgeCache,tmdbRoute,()=>requester(tmdbRoute));
          bridge=normalizeBridgeResponse(episode,other,origin);
        }
      }
    } catch (err) { console.warn('[addon bridge]', String(err?.message||err)); }
  }
  return {feed,bridge,onetouch:onetouchData};
}
module.exports={publicHttps,config,fetchJson,feedRows,normalizeBridgeResponse,providerStatus,loadRemoteSources};
