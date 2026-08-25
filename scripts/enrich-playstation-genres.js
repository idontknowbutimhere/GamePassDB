const fs=require('fs');
const path=require('path');
const file=path.join(process.cwd(),'playstation','games.json');
const games=JSON.parse(fs.readFileSync(file,'utf8'));
const ENDPOINT='https://web.np.playstation.com/api/graphql/v1/op';
const HASH='a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a';
const KNOWN=['Action','Adventure','Arcade','Casual','Family','Fighting','Horror','Music','Puzzle','Racing','Role Playing Games','Shooter','Simulation','Sport','Strategy','Unique','RPG','FPS'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function productId(g){
  const h=String(g.href||'');
  try{
    const u=new URL(h);
    const parts=u.pathname.split('/').filter(Boolean);
    const i=parts.indexOf('product');
    if(i>=0&&parts[i+1])return decodeURIComponent(parts[i+1]);
    const last=parts.at(-1);
    if(last&&last.includes('_00-'))return decodeURIComponent(last);
  }catch{}
  const id=String(g.id||'');
  return id.includes('-')?id:'';
}
function findGenres(value,out=new Set(),depth=0){
  if(depth>12||value==null)return out;
  if(Array.isArray(value)){for(const v of value)findGenres(v,out,depth+1);return out}
  if(typeof value!=='object'){
    const s=String(value).trim();
    for(const g of KNOWN){if(s.toLowerCase()===g.toLowerCase())out.add(g)}
    return out;
  }
  for(const [k,v] of Object.entries(value)){
    const key=k.toLowerCase();
    if(key.includes('genre')||key.includes('category')){
      if(Array.isArray(v))for(const x of v){if(typeof x==='string')out.add(x.trim());else if(x&&typeof x==='object'){for(const q of ['name','label','value','displayName','localizedName'])if(typeof x[q]==='string')out.add(x[q].trim())}}
      else if(typeof v==='string')out.add(v.trim());
    }
    findGenres(v,out,depth+1);
  }
  return out;
}
async function request(id){
  const variables=JSON.stringify({productId:id});
  const extensions=JSON.stringify({persistedQuery:{version:1,sha256Hash:HASH}});
  const url=ENDPOINT+'?operationName=metGetProductById&variables='+encodeURIComponent(variables)+'&extensions='+encodeURIComponent(extensions);
  const r=await fetch(url,{headers:{'x-psn-store-locale-override':'en-ca','content-type':'application/json','accept':'application/json'},redirect:'follow'});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchOne(g){
  if(Array.isArray(g.genres)&&g.genres.length)return false;
  const id=productId(g);if(!id)return false;
  try{
    const data=await request(id);
    const found=[...findGenres(data)].filter(Boolean);
    if(found.length){g.genres=[...new Set(found)];return true;}
  }catch(e){if(Math.random()<0.01)console.log('genre lookup failed:',e.message)}
  return false;
}
async function main(){
  let done=0,next=0,attempted=0;
  const workers=Array.from({length:8},async()=>{
    while(true){const i=next++;if(i>=games.length)break;attempted++;if(await fetchOne(games[i])){done++;if(done%100===0)console.log('Enriched',done)}await sleep(75)}
  });
  await Promise.all(workers);
  fs.writeFileSync(file,JSON.stringify(games));
  const withGenres=games.filter(g=>Array.isArray(g.genres)&&g.genres.length).length;
  console.log(`Genre enrichment complete: ${done} newly enriched; ${withGenres}/${games.length} total with genres; ${attempted} attempted`);
  if(withGenres<Math.max(100,Math.floor(games.length*0.01)))throw new Error(`Genre enrichment safety check failed: only ${withGenres} games have genres`);
}
main().catch(e=>{console.error(e);process.exit(1)});