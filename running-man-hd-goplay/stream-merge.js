'use strict';
const crypto=require('node:crypto');
/** Merge duplicate HLS streams without discarding subtitles from a second provider.
 * Every supplied URL has already been checked by sources.normalize().
 * Stable unique subtitle IDs improve compatibility with Nuvio's subtitle chooser.
 */
function mergeSources(episode, groups) {
  const streamByUrl=new Map();
  const providerCounts={};
  for(const [provider,block] of Object.entries(groups)) {
    const list=Array.isArray(block?.streams)?block.streams:[];
    providerCounts[provider]=list.length;
    for(const candidate of list) {
      if(!candidate?.url)continue;
      const existing=streamByUrl.get(candidate.url);
      if(existing) existing.subtitles=[...(existing.subtitles||[]),...(candidate.subtitles||[])];
      else streamByUrl.set(candidate.url,{...candidate,subtitles:[...(candidate.subtitles||[])]});
    }
  }
  const streams=[...streamByUrl.values()];
  const unique=new Map();
  for(const stream of streams) {
    const tracks=[];
    for(const subtitle of stream.subtitles||[]) {
      if(!subtitle?.url || !subtitle?.lang)continue;
      const key=subtitle.lang.toLowerCase()+'|'+subtitle.url;
      if(!unique.has(key)) {
        const hash=crypto.createHash('sha256').update(key).digest('hex').slice(0,12);
        unique.set(key,{...subtitle,id:`rmhd-${episode}-${hash}`});
      }
      if(!tracks.some(s=>s.id===unique.get(key).id)) tracks.push(unique.get(key));
    }
    if(tracks.length)stream.subtitles=tracks;
    else delete stream.subtitles;
  }
  const subtitles=[...unique.values()];
  return {streams,subtitles,providerCounts};
}
function diagnose(episode,result,episodeSpecificFallback=false) {
  return {
    episode,
    directHlsStreams:result.streams.length,
    byProvider:result.providerCounts,
    subtitleTracks:result.subtitles.length,
    subtitleLanguages:[...new Set(result.subtitles.map(s=>s.lang))].sort(),
    englishSubtitleTracks:result.subtitles.filter(s=>s.lang==='eng').length,
    inAppPlaybackCandidate:result.streams.length>0,
    externalFallback:episodeSpecificFallback?'episode webpage':'series webpage',
    note:'This checks whether the addon returned direct HLS URLs and caption links, not whether the player can decode them or the CDN will permit playback. No media URLs or tokens are exposed here.'
  };
}
module.exports={mergeSources,diagnose};
