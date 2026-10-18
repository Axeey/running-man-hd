'use strict';

// Small, deliberately read-only adapter for rights-cleared HLS sources.
// There is no extraction, DRM handling, credential forwarding, or proxying.
const fs = require('node:fs');
const path = require('node:path');
const EPISODE_LIMIT = 1600;
const CAPTIONS_DIR = path.join(__dirname, 'captions');
const BAD_HOSTS = new Set(['goplay.su', 'www.goplay.su', 'myrm.tv', 'www.myrm.tv']);
const ALLOWED_QUALITY = new Set(['auto','360p','480p','720p','1080p','1440p','2160p']);
const LANG_CODES = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch { return null; }
}
function allowedHls(value) {
  const u = httpsUrl(value);
  return !!u && !BAD_HOSTS.has(u.hostname.toLowerCase()) && /\.m3u8$/i.test(u.pathname);
}
function cleanCaption(value, origin) {
  if (typeof value !== 'string') return null;
  // Locally uploaded SRT files, only from the dedicated /captions folder.
  const m = /^\/captions\/(ep-\d{1,4}(?:-[a-z]{2,3})?\.srt)$/.exec(value);
  if (m) {
    if (!fs.existsSync(path.join(CAPTIONS_DIR,m[1]))) return null;
    return origin + value;
  }
  return httpsUrl(value)?.href || null;
}
function captionsFor(row, n, origin, streamIndex) {
  if (!Array.isArray(row)) return [];
  return row.slice(0,12).flatMap((sub, index) => {
    if (!sub || typeof sub !== 'object') return [];
    const url = cleanCaption(sub.url, origin);
    if (!url) return [];
    const lang = String(sub.lang || 'eng').toLowerCase();
    if (!LANG_CODES.test(lang)) return [];
    return [{ id:`rmhd-${n}-cc-${streamIndex}-${index}`, lang,
      name:String(sub.name || 'English').slice(0,45), url }];
  });
}
function normalize(n, raw, origin) {
  if (!Number.isSafeInteger(n) || n < 1 || n > EPISODE_LIMIT || !Array.isArray(raw)) return { streams:[], subtitles:[] };
  const streams=[];
  for (const [streamIndex,row] of raw.slice(0,12).entries()) {
    if (!row || typeof row !== 'object' || !allowedHls(row.url)) continue;
    const quality=ALLOWED_QUALITY.has(String(row.quality || '').toLowerCase()) ? String(row.quality).toLowerCase() : 'auto';
    const tracks=captionsFor(row.subtitles,n,origin,streamIndex);
    const stream={name:String(row.name || 'Authorized HLS').slice(0,64),
      description:`HLS ${quality} • authorized source`,
      url:row.url,
      ...(tracks.length?{subtitles:tracks}:{}),
      behaviorHints:{notWebReady:true}};
    streams.push(stream);
  }
  const seen=new Set();
  const subtitles=streams.flatMap(s=>s.subtitles || []).filter(sub=> {
    const key=sub.lang + '|' + sub.url;
    if(seen.has(key))return false;
    seen.add(key); return true;
  });
  return {streams,subtitles};
}
function loadConfig() {
  try {const parsed=JSON.parse(fs.readFileSync(path.join(__dirname,'streams.json'),'utf8'));
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : {};
  } catch(err) { console.warn('[sources] No usable streams.json:',err.message); return {}; }
}
function episodeSources(n,origin) { return normalize(n,loadConfig()[String(n)],origin); }
function status() {
  const raw=loadConfig();
  const episodes=[];
  for(const key of Object.keys(raw)) {
    const n=Number(key);
    if(!Number.isInteger(n)||n<1||n>EPISODE_LIMIT)continue;
    const result=normalize(n,raw[key],'https://example.invalid');
    if(result.streams.length)episodes.push({episode:n,hlsStreams:result.streams.length,subtitleTracks:result.subtitles.length});
  }
  episodes.sort((a,b)=>a.episode-b.episode);
  return {mode:'authorized HLS only',configuredEpisodes:episodes,configuredTotal:episodes.length};
}
module.exports={episodeSources,normalize,allowedHls,status};
