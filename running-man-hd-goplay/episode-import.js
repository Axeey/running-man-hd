'use strict';
/**
 * Import provider-owned, licensed episode feeds into Running Man HD.
 * Supports both Stremio-style streams and Loklok-shaped episode metadata.
 * Schema compatibility does not imply access to Loklok/GoPlay servers.
 * This module never requests private playback APIs, forwards cookies, or decrypts DRM.
 */
const MAX_EPISODES = 1600;
const MAX_STREAMS = 12;
const MAX_CAPTIONS = 12;
const EN = /(?:^|\W)(english|eng|en|en-us|en-gb)(?:$|\W)/i;

function number(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,4}$/.test(value.trim())) return Number(value.trim());
  return null;
}
function episodeNumber(record) {
  if (!record || typeof record !== 'object') return null;
  for (const key of ['episodeNumber', 'episodeNo', 'epNumber', 'episode', 'number', 'ep']) {
    const n = number(record[key]);
    if (n !== null) return n;
  }
  // Named episodes can be used when there is no numbered episode field.
  const label = String(record.title || record.name || '').trim();
  const match = /^(?:running\s*man\s*[-:]?\s*)?(?:episode|ep)\s*#?\s*(\d{1,4})(?:\b|$)/i.exec(label);
  return match ? Number(match[1]) : null;
}
function matches(row, n) {return episodeNumber(row) === n;}
function lookup(document,n) {
  if (!document || typeof document !== 'object' || n<1 || n>MAX_EPISODES) return null;
  const wrappers = [document, document.data, document.result, document.result?.data];
  for (const base of wrappers) {
    if (!base || typeof base !== 'object') continue;
    if (Array.isArray(base)) {
      const found=base.find(row=>matches(row,n));
      if(found) return found;
    }
    for (const key of ['episodeVo','episodes','items','results']) {
      const episodes=base[key];
      if (Array.isArray(episodes)) {
        const found=episodes.find(row=>matches(row,n));
        if(found) return found;
      } else if (episodes && typeof episodes==='object') {
        if(Object.hasOwn(episodes,String(n))) return episodes[String(n)];
      }
    }
    // Some independent feed producers use {"1": [...], "2": [...]}.
    if (Object.hasOwn(base,String(n))) return base[String(n)];
  }
  return null;
}
function lang(row) {
  const value=String(row?.lang || row?.language || row?.languageName || row?.name || row?.label || '').trim();
  if(EN.test(value)) return 'eng';
  const code=value.toLowerCase().replace('_','-');
  if(code==='zh' || code.startsWith('zh-') || code==='chinese') return 'zho';
  if(code==='ko'||code==='korean') return 'kor';
  if(code==='ms'||code==='malay'||code==='melayu') return 'msa';
  if(code==='id'||code==='indonesian') return 'ind';
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(code)?code:'und';
}
function subtitles(items) {
  if(!Array.isArray(items)) return [];
  return items.slice(0,MAX_CAPTIONS).flatMap(entry=>{
    if(!entry || typeof entry!=='object') return [];
    const url=entry.url || entry.file || entry.src || entry.subtitleUrl;
    if(typeof url!=='string')return [];
    return [{name:String(entry.name||entry.label||entry.language||'Subtitles').slice(0,45),lang:lang(entry),url}];
  });
}
function quality(s) {
  const label=String(s?.quality || s?.name || s?.code || s?.definition || '').trim().toLowerCase();
  const sized=/(?:^|\D)(360|480|720|1080|1440|2160)(?:p|\D|$)/.exec(label);
  if(sized) return sized[1]+'p';
  if(label==='fhd'||label==='full hd')return '1080p';
  if(label==='hd')return '720p';
  if(label==='sd')return '480p';
  return 'auto';
}
function feedRows(document,episode) {
  const row=lookup(document,episode);
  if(!row)return [];
  // Existing feed format: {episodes:{"1":[{url,subtitles}]}}
  const episodeStreams=Array.isArray(row) ? row :
    (Array.isArray(row.streams) ? row.streams :
     Array.isArray(row.sources) ? row.sources :
     Array.isArray(row.definitionList) ? row.definitionList :
     (row.mediaUrl || row.url ? [row] : []));
  const commonCaptions=subtitles(row.subtitlingList || row.subtitles || row.tracks || []);
  return episodeStreams.slice(0,MAX_STREAMS).flatMap((stream,index)=>{
    if(!stream || typeof stream!=='object')return [];
    // Only URLs already provided by an authorized publisher are accepted.
    // A definition with only a quality code or episode ID is not a stream.
    const url=stream.url || stream.mediaUrl || stream.link_m3u8 || null;
    if(typeof url!=='string')return [];
    const individual=subtitles(stream.subtitlingList || stream.subtitles || stream.tracks || []);
    return [{
      name:String(stream.name || stream.label || `Episode ${episode} • ${quality(stream)}`).slice(0,64),
      url,quality:quality(stream),subtitles:individual.length?individual:commonCaptions,
    }];
  });
}
module.exports={number,episodeNumber,lookup,lang,subtitles,quality,feedRows};
