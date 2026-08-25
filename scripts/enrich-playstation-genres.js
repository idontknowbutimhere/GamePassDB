const fs=require('fs');
const path=require('path');
const file=path.join(process.cwd(),'playstation','games.json');
const games=JSON.parse(fs.readFileSync(file,'utf8'));
const known=['Action','Adventure','Arcade','Casual','Family','Fighting','Horror','Music','Puzzle','Racing','Role Playing Games','Shooter','Simulation','Sport','Strategy','Unique'];
const delay=ms=>new Promise(r=>setTimeout(r,ms));

function extract(html){
  const found=new Set();
  const patterns=[
    /"genre"\s*:\s*"([^"]+)"/gi,
    /"genres"\s*:\s*\[([^\]]+)\]/gi,
    /Genres?\s*[:=]\s*([^<]{1,180})/gi
  ];
  for(const re of patterns){
    let m;
    while((m=re.exec(html))){
      const raw=m[1];
      const candidates=raw.replace(/[\[\]"']/g,'').split(/[,|]/).map(x=>x.trim()).filter(Boolean);
      for(const c of candidates){
        const hit=known.find(g=>c.toLowerCase()===g.toLowerCase()||c.toLowerCase().includes(g.toLowerCase()));
        if(hit)found.add(hit);
      }
    }
  }
  return [...found];
}

async function fetchOne(g){
  if(Array.isArray(g.genres)&&g.genres.length)return false;
  if(!g.href)return false;
  try{
    const r=await fetch(g.href,{headers:{'User-Agent':'GameDB-PlayStationDB/1.0','Accept':'text/html,application/xhtml+xml'}});
    if(!r.ok)return false;
    const genres=extract(await r.text());
    if(genres.length){g.genres=genres;return true;}
  }catch{}
  return false;
}

async function main(){
  let done=0,next=0;
  const workers=Array.from({length:10},async()=>{
    while(true){
      const i=next++;
      if(i>=games.length)break;
      if(await fetchOne(games[i])){
        done++;
        if(done%100===0)console.log('Enriched',done);
      }
      await delay(40);
    }
  });
  await Promise.all(workers);
  fs.writeFileSync(file,JSON.stringify(games));
  console.log(`Genre enrichment complete: ${done}/${games.length}`);
}
main().catch(e=>{console.error(e);process.exit(1)});