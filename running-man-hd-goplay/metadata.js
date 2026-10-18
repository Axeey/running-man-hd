'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.json');
const overrides = require('./episode-overrides.json');
const TVMAZE_URL = 'https://api.tvmaze.com/shows/3479/episodes';
const MAX_EPISODES = 1600;
const TTL_MS = Math.max(1, Number(config.metadataCacheHours) || 12) * 3600000;
let cache = null;
let refreshedAt = 0;
let inFlight = null;
function stripTags(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000); }
function isAirDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && !Number.isNaN(Date.parse(date + 'T00:00:00Z')); }
function baselineCount() { return Math.min(MAX_EPISODES, Math.max(1, Math.floor(Number(process.env.LAST_KNOWN_EPISODE || config.lastKnownEpisode) || 823))); }
function isHttpsImage(url) { return typeof url === 'string' && /^https:\/\//.test(url); }
function normalize(input) {
  const currentDate = new Date().toISOString().slice(0, 10);
  if (!Array.isArray(input)) throw new Error('Metadata source returned non-array');
  const dated = input.filter(e => e && isAirDate(e.airdate) && e.airdate <= currentDate && Number(e.season) !== 0);
  dated.sort((a,b) => a.airdate.localeCompare(b.airdate) || Number(a.id) - Number(b.id));
  const result = dated.slice(0, MAX_EPISODES).map((e,idx) => ({
    number: idx + 1,
    title: e.name && !/^episode\s*\d+$/i.test(e.name) ? stripTags(e.name) : `Episode ${idx + 1}`,
    airDate: e.airdate,
    description: stripTags(e.summary),
    thumbnail: isHttpsImage(e.image?.medium) ? e.image.medium : undefined
  }));
  return result;
}
async function update() {
  if (!config.metadataAutoUpdate) return cache;
  if (Date.now() - refreshedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch(TVMAZE_URL, { headers: { 'User-Agent': 'RunningManHD/1.3 (+metadata only)', 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('TVmaze status ' + response.status);
      const episodes = normalize(await response.json());
      if (episodes.length < 50) throw new Error('Suspiciously incomplete episode metadata');
      cache = episodes;
    } catch (err) {
      console.warn('[metadata] TVmaze unavailable, using saved catalog:', err.message);
      if (!cache) {
        try {
          const saved = JSON.parse(fs.readFileSync(path.join(__dirname, 'tvmaze-cache.json'), 'utf8'));
          if (Array.isArray(saved) && saved.length > 50) cache = saved;
        } catch { /* optional cache */ }
      }
    } finally {
      refreshedAt = Date.now();
      inFlight = null;
    }
    return cache;
  })();
  return inFlight;
}
async function getEpisodes() {
  const known = await update();
  const n = Math.min(MAX_EPISODES, Math.max(baselineCount(), known?.length || 0));
  return Array.from({length:n}, (_,i) => {
    const num = i + 1;
    const row = known?.[i] || {};
    const custom = overrides[String(num)] || {};
    return {
      number:num, title:custom.title || row.title || `Episode ${num}`,
      airDate:custom.airDate || row.airDate,
      description:custom.description || row.description || '',
      thumbnail:custom.thumbnail || row.thumbnail
    };
  });
}
module.exports = { getEpisodes, normalize, baselineCount };
