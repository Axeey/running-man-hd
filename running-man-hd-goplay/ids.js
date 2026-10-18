'use strict';
// Running Man only: avoid claiming support for unrelated shows on standard IDs.
const SERIES_ID = 'tt2185037';
const TMDB_SERIES_ID = 'tmdb:33238';
const LEGACY_SERIES_ID = 'rmhd:runningman';
const MAX_EPISODE = 1600;
function seriesId(id) {
  if(id === SERIES_ID || id === TMDB_SERIES_ID || id === LEGACY_SERIES_ID) return id;
  return null;
}
function episodeId(id) {
  if(typeof id !== 'string') return null;
  const m = /^(?:tt2185037:1:|tmdb:33238:1:|rmhd:ep:)(\d{1,4})$/.exec(id);
  if(!m) return null;
  const number = Number(m[1]);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_EPISODE ? number : null;
}
function videoId(series, episode) {
  if(series === LEGACY_SERIES_ID) return `rmhd:ep:${episode}`;
  if(series === TMDB_SERIES_ID) return `${TMDB_SERIES_ID}:1:${episode}`;
  return `${SERIES_ID}:1:${episode}`;
}
module.exports={SERIES_ID,TMDB_SERIES_ID,LEGACY_SERIES_ID,seriesId,episodeId,videoId};
