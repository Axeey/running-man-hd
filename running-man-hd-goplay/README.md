# Running Man HD v1.3 — GoPlay browser-link addon (Stremio + Nuvio)

An **unofficial Running Man episode guide**, Stremio-protocol addon, and Android-friendly episode browser. This is a working server, **not a video scraper and not an APK**. It does not extract, decrypt, copy, proxy, or rehost GoPlay streams.

## What this version DOES

- Shows Running Man with Episode 1 onward in the Stremio/Nuvio addon catalog.
- Includes Episode 1 through **Episode 823 (October 18, 2026)** as a baseline based on a public episode listing; when TVmaze is reachable it fills in episode titles, release dates and optional images. The TVmaze guide can be incomplete or lag behind, so you can update the baseline via `LAST_KNOWN_EPISODE`.
- Has a GoPlay **external webpage** option for each episode. Until an episode-specific link is configured, it opens the general Running Man Classics series page where you must pick an episode yourself.
- Includes a separate **mobile-friendly website** (`/`) with a search bar, episode navigation, and a clearly labeled GoPlay link. This is useful when an app doesn't support webpage-only streams.
- Accepts direct licensed HTTPS media URLs and caption files in `streams.json`, if you legitimately have them.
- Works without third-party Node dependencies (Node.js 20+).

## What it DOES NOT do

- No built-in HD media playback: **GoPlay 1080p and English CC are available in GoPlay's own browser player**, not embedded in this addon. The browser experience might differ by device.
- No GoPlay stream extraction, automated episode links, DRM circumvention, or login bypass.
- **Nuvio caveat:** Some Nuvio versions do not implement Stremio's `externalUrl` correctly and may try to play the HTML webpage as a video. If so, use the mobile companion webpage (`https://YOUR-HOST/episode/1`) in your phone's browser instead.
- Doesn't auto-deploy itself; you must host the addon server online before installing it on a phone.

## Quick start on a computer (no `npm install` necessary)

1. Install Node.js 20 or newer from https://nodejs.org.
2. Open this folder in a terminal and run `npm start` (equivalently `node server.js`).
3. Open http://localhost:7000/ to browse the episodes.
4. Test http://localhost:7000/manifest.json, http://localhost:7000/meta/series/rmhd:runningman.json, http://localhost:7000/stream/series/rmhd:ep:1.json.
5. Run `npm test` for the automated tests.

## Host online for Android

1. Create a GitHub repository and upload **the files inside this folder** to its root. Do **not** upload account passwords, cookies, authentication tokens, or personal streaming links.
2. At https://render.com choose New → Blueprint → connect your GitHub repository. `render.yaml` is included. Review your plan and the provider's current pricing before creating a service. Other Node.js hosts or a container host also work.
3. Open the deployed URL once it is online: `https://YOUR-SERVICE.onrender.com/` (episode browser) and `https://YOUR-SERVICE.onrender.com/manifest.json` (addon URL).
4. In **Stremio**, add the HTTPS `/manifest.json` URL in its addons interface, or add it via Stremio Web on the same account and sync to Android.
5. In **Nuvio**, use Settings → Content & Discovery → Addons (exact menu may vary) and add the same manifest URL.
6. If **Nuvio can't open GoPlay links**, bookmark the deployed website in Chrome/your mobile browser, or use the /episode/number page.

### Example installation URL

`https://YOUR-SERVICE.onrender.com/manifest.json`

This is a **template**, not an already-running URL. I cannot supply a live install URL until the project is deployed to a hosting account.

## Episode metadata and new episodes

- Metadata guide: https://www.tvmaze.com/shows/3479/running-man/episodeguide (public episode descriptions). The project uses TVmaze's official public API, not GoPlay HTML.
- Source series page: https://goplay.su/4b2d3238383331303537/Running-Man-Classics/
- Update `config.json` → `lastKnownEpisode` (or set environment variable `LAST_KNOWN_EPISODE=824`) when a newer Running Man episode airs if the public API hasn't caught up. A later API update can expand the catalog automatically.
- `episode-overrides.json` stores trusted titles/dates you explicitly specify. Entries not in the public metadata are labeled by episode number instead of inventing summaries.
- `episode-watch-links.json` can contain manually verified individual GoPlay **webpage links**; by default it is empty, because we couldn't confirm individual episode URLs. Example: `{ "1": "https://goplay.su/YOUR-REAL-EPISODE-PAGE" }` — replace with a genuine publicly accessible episode page, not an invented address. The example is not a working link.

## Optional authorized direct video streams

`streams.json` starts as `{}`. If you have permission to use a direct HTTPS media URL, add it like this:

```json
{
  "1": [{
    "name": "Authorized HD source",
    "description": "1080p / captions",
    "url": "https://licensed-provider.example/videos/episode-1.m3u8",
    "subtitles": [{
      "id": "rm-1-en", "lang": "eng",
      "url": "https://licensed-provider.example/subtitles/episode-1.vtt"
    }]
  }]
}
```

Those `.example` URLs are placeholders; they do not play. Do not add GoPlay HTML pages to `streams.json` or call them direct media URLs. The addon explicitly rejects `goplay.su` URLs as direct stream media entries.

## Why we use a browser link

The Stremio addon protocol supports `externalUrl` for opening a webpage rather than playing a media file: https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html . Nuvio compatibility is not guaranteed for this feature: https://github.com/NuvioMedia/NuvioMobile/issues/1466 .

This project is not endorsed by GoPlay, SBS, TVmaze, Stremio, or Nuvio. Streaming availability, copyright permissions, regional restrictions, and website behavior are controlled by the respective providers.
