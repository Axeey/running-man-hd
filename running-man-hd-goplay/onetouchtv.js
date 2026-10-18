'use strict';
/**
 * Experimental OneTouchTV provider adapter, adapted from the architecture of
 * hoangtamthai/yastream (MIT). No episode files are copied or hosted here.
 * Disabled by default. Respect provider terms and use only where authorized.
 *
 * The upstream API may change or require access the user does not have.
 */
const crypto = require('node:crypto');
const { normalize } = require('./sources');

const API_BASE = 'https://api3.devcorp.me';
const ORIGIN = 'https://onetouchtv.xyz';
const MAX_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 6500;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
// The values below are decoded from the MIT-licensed Yastream client.
// They decode API response JSON; they do not decrypt DRM-protected media.
const KEY = Buffer.from('696d37326368617250617373776f72646f6664496e6974566563746f7253746d', 'hex');
const IV = Buffer.from('696d37326368617250617373776f7264', 'hex');

function decodePayload(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body !== 'string') throw new Error('Unexpected provider payload');
  const raw = body.trim();
  if (raw.startsWith('{') || raw.startsWith('[')) return JSON.parse(raw);
  const base64 = raw.replace(/-_\./g, '/').replace(/@/g, '+').replace(/\s+/g, '');
  const encrypted = Buffer.from(base64, 'base64');
  if (!encrypted.length || encrypted.length % 16 !== 0 || encrypted.length > MAX_BYTES) throw new Error('Invalid encrypted provider payload');
  const decoder = crypto.createDecipheriv('aes-256-cbc', KEY, IV);
  const plain = Buffer.concat([decoder.update(encrypted), decoder.final()]).toString('utf8');
  const json = JSON.parse(plain);
  return typeof json === 'string' ? JSON.parse(json) : json;
}

async function getApi(path, fetchImpl = globalThis.fetch) {
  if (!/^\/vod\/[a-zA-Z0-9/?=&%._-]+$/.test(path)) throw new Error('Invalid provider API path');
  const url = API_BASE + path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method:'GET', redirect:'manual', signal:controller.signal,
      headers:{'Accept':'*/*','Origin':ORIGIN,'Referer':ORIGIN+'/', 'User-Agent':'Mozilla/5.0 RunningManHD/2.0'}
    });
    if (!response.ok || response.status >= 300) throw new Error(`Provider HTTP ${response.status}`);
    const length = Number(response.headers?.get?.('content-length'));
    if (length > MAX_BYTES) throw new Error('Provider response too large');
    const raw = await response.text();
    if (Buffer.byteLength(raw,'utf8') > MAX_BYTES) throw new Error('Provider response too large');
    return decodePayload(raw);
  } finally { clearTimeout(timeout); }
}
function cacheLoad(key,fn) {
  const found = cache.get(key);
  if (found && found.expires > Date.now()) return found.promise;
  const promise = Promise.resolve().then(fn);
  cache.set(key,{expires:Date.now()+CACHE_MS,promise});
  promise.catch(()=>{if(cache.get(key)?.promise===promise)cache.delete(key);});
  if(cache.size>250) cache.delete(cache.keys().next().value);
  return promise;
}
function titleScore(item) {
  const title = String(item?.title||'').toLowerCase();
  if (!/(running[\s-]?man|런닝맨)/iu.test(title)) return -1;
  const year = parseInt(String(item.year||''),10);
  if (year && year !== 2010) return -1;
  return (year===2010?10:0) + (/^(running[\s-]?man|런닝맨)(\s*\(?(2010)?\)?)?$/iu.test(title)?8:0);
}
function chooseShow(search) {
  const results = Array.isArray(search?.result) ? search.result : [];
  return results.filter(x=>typeof x?.id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x.id))
    .sort((a,b)=>titleScore(b)-titleScore(a)).find(x=>titleScore(x)>=0) || null;
}
function language(track) {
  const name = String(track?.name||track?.label||'').toLowerCase();
  if(/(english|\beng\b)/.test(name)) return 'eng';
  if(/(bahasa melayu|malay|melayu)/.test(name)) return 'msa';
  if(/(indonesian|indonesia)/.test(name)) return 'ind';
  if(/(korean|한국어)/.test(name)) return 'kor';
  if(/(chinese|中文)/.test(name)) return 'zho';
  return 'und';
}
function adaptEpisodePayload(payload, episode, origin) {
  const sources = Array.isArray(payload?.result?.sources) ? payload.result.sources : [];
  const tracks = Array.isArray(payload?.result?.track) ? payload.result.track : [];
  const subtitles = tracks.filter(x=>typeof x?.file==='string' && /^https:\/\//i.test(x.file)).map(x=>({
    lang:language(x), name:String(x.label||x.name||'Subtitles').slice(0,45), url:x.file
  }));
  const rows = sources.map((source,index)=>({
    name:`OneTouchTV • ${String(source.name||source.quality||`Source ${index+1}`).slice(0,35)}`,
    url:source.url,
    quality:/^(auto|360p|480p|720p|1080p|1440p|2160p)$/i.test(String(source.quality||''))?String(source.quality).toLowerCase():'auto',
    subtitles
  }));
  return normalize(episode, rows, origin);
}
async function getEpisode(episode,origin,options={}) {
  const requester = options.getApi || getApi;
  if(!Number.isSafeInteger(episode) || episode < 1 || episode > 1600) return {streams:[],subtitles:[]};
  const id = await cacheLoad('runningman-id', async()=>{
    const s=await requester('/vod/search?page=1&keyword='+encodeURIComponent('Running Man'));
    return chooseShow(s)?.id || null;
  });
  if (!id) return {streams:[],subtitles:[]};
  const detail = await cacheLoad('detail:'+id,()=>requester(`/vod/${id}/detail`));
  const episodes = Array.isArray(detail?.result?.episodes) ? detail.result.episodes : [];
  const found = episodes.find(e=>Number(e.episode)===episode);
  if(!found) return {streams:[],subtitles:[]};
  const idParam = episodes[0]?.identifier || detail.result.id || id;
  const playParam = found.playId || String(episode);
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(String(idParam)) || !/^[a-zA-Z0-9_-]{1,100}$/.test(String(playParam))) return {streams:[],subtitles:[]};
  const payload = await cacheLoad(`ep:${idParam}:${playParam}`,()=>requester(`/vod/${idParam}/episode/${playParam}`));
  return adaptEpisodePayload(payload,episode,origin);
}
function enabled(){return process.env.RMHD_ONETOUCHTV_ENABLED === '1';}
function status(){return {onetouchTV:enabled()?'enabled (experimental)':'disabled',note:'Uses public Yastream provider architecture. Availability, provider terms, subtitles and playback must be checked separately.'};}
module.exports={decodePayload,getApi,chooseShow,language,adaptEpisodePayload,getEpisode,enabled,status};
