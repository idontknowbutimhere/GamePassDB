const fs = require('fs');
const path = require('path');
const CATALOG = 'steam/games.json';
const HISTORY_DIR = 'steam/rankings/history';
const OUTPUT = 'steam/rankings.json';
const TOP_HISTORY = 500;
function dayKey(date = new Date()) { return date.toISOString().slice(0,10); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return null; } }
function write(file,data) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data)); }
const catalog=readJson(CATALOG);
if(!catalog||!Array.isArray(catalog.games)) throw new Error('Steam catalog missing or invalid.');
const games=catalog.games.map(g=>({id:Number(g.id),title:g.title,score:Number(g.popularityScore)||0})).filter(g=>Number.isInteger(g.id)&&g.id>0&&g.title);
games.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
games.forEach((g,i)=>g.rank=i+1);
const today=dayKey();
write(`${HISTORY_DIR}/${today}.json`,{date:today,games:games.slice(0,TOP_HISTORY).map(g=>({id:g.id,score:g.score,rank:g.rank}))});
const files=fs.existsSync(HISTORY_DIR)?fs.readdirSync(HISTORY_DIR).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort():[];
const history=files.map(f=>readJson(path.join(HISTORY_DIR,f))).filter(Boolean);
function since(days){const cutoff=new Date();cutoff.setUTCDate(cutoff.getUTCDate()-(days-1));return history.filter(x=>x.date>=dayKey(cutoff));}
function periodTop(snaps,limit){const map=new Map();for(const s of snaps)for(const g of s.games||[]){const x=map.get(g.id)||{id:g.id,n:0,sum:0,best:Infinity};x.n++;x.sum+=g.score;x.best=Math.min(x.best,g.rank);map.set(g.id,x);}return [...map.values()].map(x=>{const g=games.find(y=>y.id===x.id);return g?{id:g.id,title:g.title,score:Math.round(x.sum/x.n),appearances:x.n,bestRank:x.best}:null;}).filter(Boolean).sort((a,b)=>b.score-a.score||a.bestRank-b.bestRank).slice(0,limit).map((g,i)=>({...g,rank:i+1}));}
const daily=periodTop(since(1),10);
const weekly=periodTop(since(7),10);
const allTime=games.slice(0,100).map((g,i)=>({id:g.id,title:g.title,score:g.score,rank:i+1}));
write(OUTPUT,{updatedAt:new Date().toISOString(),daily,weekly,allTime});
console.log(`Rankings generated: daily ${daily.length}, weekly ${weekly.length}, all-time ${allTime.length}.`);
