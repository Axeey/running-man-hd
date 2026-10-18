'use strict';
// Running Man ID compatibility fix, based on the numbering of original
// broadcast episodes (not specials). Do not alter video/source URLs.
const SERIES_ID = 'tt2185037';
const TMDB_SERIES_ID = 'tmdb:33238';
const LEGACY_SERIES_ID = 'rmhd:runningman';
const MAX_EPISODE = 1600;

// First globally numbered episode broadcast in each calendar year.
// Reference: year-by-year SBS Running Man episode lists (2010 onward).
const YEAR_START = Object.freeze({
  2010: 1, 2011: 24, 2012: 75, 2013: 127, 2014: 179,
  2015: 228, 2016: 280, 2017: 332, 2018: 384,
  2019: 433, 2020: 484, 2021: 536, 2022: 586,
  2023: 635, 2024: 686, 2025: 734, 2026: 784
});

function seriesId(id) {
  return id === SERIES_ID || id === TMDB_SERIES_ID || id === LEGACY_SERIES_ID ? id : null;
}

function episodeId(id) {
  if (typeof id !== 'string') return null;
  // Original private episode numbering.
  let match = /^rmhd:ep:(\d{1,4})$/.exec(id);
  if (match) return bounded(Number(match[1]));

  // Main Stremio format: season 1 contains globally numbered episodes.
  // Some metadata services instead use the broadcast year as the season,
  // e.g. tt2185037:2011:29 = overall Running Man episode 52.
  match = /^(?:tt2185037|tmdb:33238):(1|20\d{2}):(\d{1,4})$/.exec(id);
  if (!match) return null;
  const season = Number(match[1]);
  const number = Number(match[2]);
  if (season === 1) return bounded(number);
  if (!Object.hasOwn(YEAR_START, season)) return null;
  const nextYear = YEAR_START[season + 1];
  const overall = YEAR_START[season] + number - 1;
  // Reject made-up dates / numbers outside a completed year.
  if (nextYear && overall >= nextYear) return null;
  return bounded(overall);
}

function bounded(number) {
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_EPISODE ? number : null;
}

function videoId(series, episode) {
  if (series === LEGACY_SERIES_ID) return `rmhd:ep:${episode}`;
  if (series === TMDB_SERIES_ID) return `${TMDB_SERIES_ID}:1:${episode}`;
  return `${SERIES_ID}:1:${episode}`;
}

module.exports = {SERIES_ID,TMDB_SERIES_ID,LEGACY_SERIES_ID,seriesId,episodeId,videoId,YEAR_START};
