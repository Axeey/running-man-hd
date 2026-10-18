'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeServer } = require('../server');
const { normalize } = require('../metadata');
let server, base;
test.before(async()=>{server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));});
async function json(route) {const r=await fetch(base+route);assert.equal(r.status,200,route);return r.json();}
test('manifest exposes Stremio catalog, meta, streams, subtitles', async()=>{
 const m=await json('/manifest.json');assert.equal(m.version,'1.3.0');assert.deepEqual(m.types,['series']);assert.ok(m.resources.includes('stream'));
});
test('Running Man series visible in catalog',async()=>{let r=await json('/catalog/series/rmhd-catalog.json');assert.equal(r.metas[0].id,'rmhd:runningman');});
test('episode metadata covers 1 and known 823 without inventing stream',async()=>{
 const r=await json('/meta/series/rmhd:runningman.json');assert.ok(r.meta.videos.length>=823);assert.equal(r.meta.videos[0].id,'rmhd:ep:1');assert.equal(r.meta.videos[822].id,'rmhd:ep:823');
});
test('GoPlay is an external webpage link, never a fake direct media stream',async()=>{const r=await json('/stream/series/rmhd:ep:1.json');assert.ok(r.streams.length>0);assert.match(r.streams[0].externalUrl,/^https:\/\/goplay\.su\//);assert.equal(r.streams[0].url,undefined);});
test('no fake subtitles; mobile web page has explicit watch warning',async()=>{
 const r=await json('/subtitles/series/rmhd:ep:1.json');assert.deepEqual(r.subtitles,[]);
 const page=await fetch(base+'/episode/1');const h=await page.text();assert.match(h,/not an Episode 1 video link/);assert.match(h,/Open GoPlay website/);
});
test('metadata sorting excludes future and season 0',()=>{
 const out=normalize([{airdate:'2010-07-18',name:'2',id:2,season:2010},{airdate:'2010-07-11',name:'First',id:1,season:2010},{airdate:'2010-07-01',name:'Special',id:9,season:0},{airdate:'2099-01-01',name:'Future',id:10,season:2099}]);
 assert.equal(out.length,2);assert.equal(out[0].title,'First');
});
