#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checks,validateMetadata,parseArgs} from './save-upgrade.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const requiredArgs=['--project',ROOT,'--old-dir',path.join(ROOT,'output/old'),'--new-dir',path.join(ROOT,'output/new'),'--scenario',path.join(ROOT,'output/scenario.mjs'),'--out',path.join(ROOT,'output/evidence')];
test('channel is optional and bundled Chromium and WebKit defaults remain unchanged',()=>{
 const chromium=parseArgs(requiredArgs);assert.equal(chromium.engine,'chromium');assert.equal(chromium.channel,undefined);
 const webkit=parseArgs([...requiredArgs,'--engine','webkit']);assert.equal(webkit.engine,'webkit');assert.equal(webkit.channel,undefined);
});
test('installed Chrome channel is accepted only with Chromium, including its default engine',()=>{
 assert.equal(parseArgs([...requiredArgs,'--channel','chrome']).channel,'chrome');
 assert.equal(parseArgs([...requiredArgs,'--channel','chrome','--engine','chromium']).channel,'chrome');
 assert.throws(()=>parseArgs([...requiredArgs,'--engine','webkit','--channel','chrome']),/only accepts chrome with --engine chromium/);
 for(const channel of ['edge','chromium','chrome-beta','/tmp/browser'])assert.throws(()=>parseArgs([...requiredArgs,'--channel',channel]),/only accepts chrome/);
 assert.throws(()=>parseArgs([...requiredArgs,'--channel']),/Unknown or incomplete/);
});
const metadata={seedKind:'SANITIZED_FIXTURE',fixtureVersion:'fixture-v1',storageTypes:['localStorage']};
const values={progress:4,resources:85,unlocks:['boat-2'],records:117};
const checked=(overrides={})=>Object.entries({...values,...overrides}).map(([category,value])=>({storage:'localStorage',category,name:category+' preserved',expected:values[category],actual:value}));
test('scenario requires explicit seed identity and each applicable save category',()=>{
 assert.throws(()=>validateMetadata({...metadata,fixtureVersion:undefined}));
 assert.throws(()=>checks({checks:[{name:'trust me',category:'progress',passed:true}]},metadata));
 assert.throws(()=>checks({checks:checked().slice(0,3)},metadata));
 assert.throws(()=>checks({checks:checked()},{...metadata,storageTypes:['localStorage','indexedDB']}));
 assert.throws(()=>validateMetadata({...metadata,storageTypes:['cookies']}));
 assert.throws(()=>validateMetadata({...metadata,notApplicable:Object.fromEntries(Object.keys(values).map(k=>[k,'none']))}));
});
test('runner calculates comparisons instead of accepting a passed flag',()=>{
 const result=checks({checks:checked({resources:0}).map(c=>({...c,passed:true}))},metadata);
 assert.equal(result.find(c=>c.category==='resources').passed,false);
 assert.equal(JSON.stringify(result).includes('boat-2'),false);
 const relaxed=checks({checks:[...checked().filter(c=>c.category!=='resources'),{storage:'localStorage',category:'resources',name:'conversion compensation',comparison:'at-least',expected:85,actual:90}]},metadata);
 assert.equal(relaxed.every(c=>c.passed),true);
});

const project=process.env.MOBILE_QA_PLAYWRIGHT_PROJECT;
const engine=process.env.MOBILE_QA_BROWSER_ENGINE??'chromium';
const channel=process.env.MOBILE_QA_BROWSER_CHANNEL;
const integrationOptions={skip:project?false:'Set MOBILE_QA_PLAYWRIGHT_PROJECT to an existing game repo with Playwright/Chromium.'};
async function fixtures(mode){
 const parent=path.join(ROOT,'output/mobile-qa');await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'save-upgrade-regression-'));const old=path.join(dir,'old'),candidate=path.join(dir,'candidate');await mkdir(old);await mkdir(candidate);
 const html=script=>`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button id="seed">Seed old fixture</button><div id="ready">ready</div><script>${script}</script>`;
 await writeFile(path.join(old,'index.html'),html(`document.querySelector('#seed').onclick=()=>localStorage.setItem('fixture-save-v1',JSON.stringify({chapter:4,coins:85,unlocked:['boat-2'],best:117}));`));
 const migrate=`const legacy=JSON.parse(localStorage.getItem('fixture-save-v1'));if(!localStorage.getItem('fixture-save-v2')&&legacy)localStorage.setItem('fixture-save-v2',JSON.stringify({progress:legacy.chapter,resources:legacy.coins,unlocks:legacy.unlocked,records:legacy.best,migrationAwards:1}));`;
 const reset=`localStorage.clear();localStorage.setItem('fixture-save-v2',JSON.stringify({progress:0,resources:0,unlocks:[],records:0,migrationAwards:1}));`;
 const duplicate=`${migrate}const s=JSON.parse(localStorage.getItem('fixture-save-v2'));if(s){s.migrationAwards++;localStorage.setItem('fixture-save-v2',JSON.stringify(s));}`;
 await writeFile(path.join(candidate,'index.html'),html(mode==='reset'?reset:mode==='duplicate'?duplicate:migrate));
 const scenario=path.join(dir,'scenario.mjs');await writeFile(scenario,`
export const metadata=${JSON.stringify(metadata)};
const checks=s=>Object.entries(s).filter(([k])=>['progress','resources','unlocks','records'].includes(k)).map(([category,value])=>({storage:'localStorage',category,name:category+' fixture retained',expected:({progress:4,resources:85,unlocks:['boat-2'],records:117})[category],actual:value}));
export async function seedOld({page}){await page.click('#seed');const old=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-save-v1')));const before={progress:old.chapter,resources:old.coins,unlocks:old.unlocked,records:old.best};return {before,checks:checks(before)};}
export async function assertUpgraded({page,before}){const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-save-v2')));return {checks:[...checks(after),{storage:'localStorage',category:'resources',name:'migration award granted once',expected:${mode==='duplicate'?2:1},actual:after.migrationAwards}]};}
export async function assertReload({page,before,reloadIndex}){const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-save-v2')));return {checks:[...checks(after),{storage:'localStorage',category:'resources',name:'reload does not repeat migration award',expected:${mode==='duplicate'?2:1},actual:after.migrationAwards}]};}
`);
 return {dir,old,candidate,scenario,out:path.join(dir,'evidence')};
}
async function run(f){const argv=[path.join(ROOT,'scripts/mobile-qa/save-upgrade.mjs'),'--engine',engine,...(channel?['--channel',channel]:[]),'--project',path.resolve(project),'--old-dir',f.old,'--new-dir',f.candidate,'--scenario',f.scenario,'--out',f.out,'--timeout-ms','2000','--stage-timeout-ms','5000'];
 return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,argv,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Save regression watchdog expired'));},30000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});}
for(const mode of ['preserve','reset','duplicate'])test('same-origin real-browser '+mode,integrationOptions,async()=>{
 const f=await fixtures(mode);const result=await run(f);const report=JSON.parse(await readFile(path.join(f.out,'report.json'),'utf8'));
 if(mode==='preserve'){
  assert.equal(result.code,0,result.stderr);assert.equal(report.status,'SAVE_UPGRADE_PASS');assert.equal(report.stages.length,4);assert.equal(new Set(report.stages.map(s=>s.origin)).size,1);assert.equal(report.stages.every(s=>s.checks.every(c=>c.passed)),true);
  assert.equal(report.stages[0].storage.localStorage[0].keySha256,createHash('sha256').update('fixture-save-v1').digest('hex'));assert.equal(report.stages[1].storage.localStorage.length,2);
 }else {assert.equal(result.code,1,JSON.stringify(report.failures));assert.equal(report.status,'FAIL');if(mode==='reset')assert.ok(report.failures.some(x=>x.includes('Storage.clear')));if(mode==='duplicate')assert.ok(report.stages.find(s=>s.name==='candidate-reload-1').checks.some(c=>!c.passed));}
 assert.equal(report.browserEngine,engine);assert.equal(report.requestedBrowserChannel,channel??null);assert.equal(report.browser.channel,channel??'bundled-'+engine);assert.equal(report.releaseGate,'NOT_EVALUATED');const raw=await readFile(path.join(f.out,'report.json'),'utf8');assert.equal(raw.includes('boat-2'),false);assert.equal(raw.includes('"coins"'),false);
 process.stdout.write(`Saved ${mode} evidence: ${f.out}\n`);
});

test('IndexedDB ordinary values are fingerprinted without exposing save contents',integrationOptions,async()=>{
 const f=await fixtures('preserve');let scenario=await readFile(f.scenario,'utf8');
 scenario=scenario.replace('"storageTypes":["localStorage"]','"storageTypes":["localStorage","indexedDB"]');
 scenario=scenario.replace("await page.click('#seed');", "await page.click('#seed');await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fixture-history',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('fixture DB failed'));});await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({best:117,note:'private-fixture-note'},'best');tx.oncomplete=resolve;tx.onerror=reject;});db.close();});");
 scenario=scenario.replace(/return \{before,checks:checks\(before\)\};/g,`return {before,checks:[...checks(before),await idbCheck(page)]};`).replace(/return \{checks:\[\.\.\.checks\(after\),/g,`return {checks:[...checks(after),await idbCheck(page),`);scenario+=idbCheckSource('fixture-history','records');
 await writeFile(f.scenario,scenario);const result=await run(f);assert.equal(result.code,0,result.stderr);const raw=await readFile(path.join(f.out,'report.json'),'utf8');const report=JSON.parse(raw);assert.equal(raw.includes('private-fixture-note'),false);assert.equal(report.stages[0].storage.indexedDB[0].stores[0].rowCount,1);assert.equal(report.stages[0].storage.indexedDB[0].stores[0].sha256,report.stages[3].storage.indexedDB[0].stores[0].sha256);process.stdout.write(`Saved indexedDB evidence: ${f.out}\n`);
});

test('scenario errors, storage names and arbitrary protocol labels never disclose fake save secrets',integrationOptions,async()=>{
 const secret='unique-old-player-fake-secret-987654';
 for(const mode of ['labels','error']){
  const f=await fixtures('preserve');let scenario=await readFile(f.scenario,'utf8');
  scenario=scenario.replace('"fixtureVersion":"fixture-v1"',`"fixtureVersion":"${secret}","notApplicable":{"records":"${secret}"}`);
  scenario=scenario.replace("name:category+' fixture retained'",`name:'${secret}'`);
  scenario=scenario.replace("await page.click('#seed');",`await page.click('#seed');await page.evaluate(async(secret)=>{localStorage.setItem(secret,'fixture-value');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(secret,1);r.onupgradeneeded=()=>r.result.createObjectStore(secret);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});await new Promise((resolve,reject)=>{const tx=db.transaction(secret,'readwrite');tx.objectStore(secret).put({note:secret},'best');tx.oncomplete=resolve;tx.onerror=reject;});db.close();},'${secret}');`);
  scenario=scenario.replace('"storageTypes":["localStorage"]','"storageTypes":["localStorage","indexedDB"]');
  if(mode==='error')scenario=scenario.replace('const after=await page.evaluate',`JSON.parse('invalid ${secret}');const after=await page.evaluate`);
  scenario=scenario.replace(/return \{before,checks:checks\(before\)\};/g,`return {before,checks:[...checks(before),await idbCheck(page)]};`).replace(/return \{checks:\[\.\.\.checks\(after\),/g,`return {checks:[...checks(after),await idbCheck(page),`);scenario+=idbCheckSource(secret,secret,'note',secret);
  await writeFile(f.scenario,scenario);const result=await run(f);const raw=await readFile(path.join(f.out,'report.json'),'utf8');const report=JSON.parse(raw);
  assert.equal(result.code,mode==='error'?1:0);assert.equal((raw+result.stdout+result.stderr).includes(secret),false);
  assert.ok(report.metadata.fixtureVersionSha256);assert.ok(report.stages[0].storage.localStorage.every(x=>x.keySha256&&!Object.hasOwn(x,'key')));assert.ok(report.stages[0].storage.indexedDB.every(x=>x.nameSha256&&!Object.hasOwn(x,'name')));
  if(mode==='error'){assert.equal(report.error.type,'SyntaxError');assert.ok(report.error.messageSha256);assert.ok(!Object.hasOwn(report.error,'message'));}
  process.stdout.write(`Saved privacy ${mode} evidence: ${f.out}\n`);
 }
});

function idbCheckSource(dbName,storeName,field='best',expected=117){return `
async function idbCheck(page){const actual=await page.evaluate(async({dbName,storeName,field})=>{const db=await new Promise((resolve)=>{const r=indexedDB.open(dbName);r.onupgradeneeded=()=>{r.transaction.abort();resolve(null);};r.onerror=()=>resolve(null);r.onsuccess=()=>resolve(r.result);});if(!db)return null;try{if(!db.objectStoreNames.contains(storeName))return null;const value=await new Promise((resolve)=>{const tx=db.transaction(storeName,'readonly');const r=tx.objectStore(storeName).get('best');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);});return value?.[field]??null;}finally{db.close();}},${JSON.stringify({dbName,storeName,field})});return {storage:'indexedDB',category:'records',name:'DB save field retained',expected:${JSON.stringify(expected)},actual};}
`;}

test('nonempty IndexedDB cannot silently disappear even if scenario incorrectly reads localStorage',integrationOptions,async()=>{
 const f=await fixtures('preserve');let scenario=await readFile(f.scenario,'utf8');
 scenario=scenario.replace('"storageTypes":["localStorage"]','"storageTypes":["localStorage","indexedDB"]');
 scenario=scenario.replace("await page.click('#seed');", "await page.click('#seed');await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('fixture-delete-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(117,'best');tx.oncomplete=resolve;});db.close();});");
 scenario=scenario.replace(/checks:checks\(before\)/g,"checks:[...checks(before),{storage:'indexedDB',category:'records',name:'deliberately wrong source',expected:117,actual:before.records}]");
 scenario=scenario.replace(/checks:\[\.\.\.checks\(after\),/g,"checks:[...checks(after),{storage:'indexedDB',category:'records',name:'deliberately wrong source',expected:117,actual:after.records},");
 scenario=scenario.replace('export async function assertUpgraded({page,before}){', 'export async function assertUpgraded({page,before}){await page.evaluate(()=>globalThis.fixtureDeletion);');
 await writeFile(f.scenario,scenario);const candidate=path.join(f.candidate,'index.html');let html=await readFile(candidate,'utf8');html=html.replace('<script>',`<script>globalThis.fixtureDeletion=new Promise(resolve=>{const r=indexedDB.deleteDatabase('fixture-delete-db');r.onsuccess=resolve;r.onerror=resolve;});`);await writeFile(candidate,html);
 const result=await run(f),report=JSON.parse(await readFile(path.join(f.out,'report.json'),'utf8'));assert.equal(result.code,1);assert.equal(report.status,'FAIL');assert.ok(report.failures.some(x=>x==='Previously nonempty declared storage became empty: indexedDB'));assert.equal(report.stages[0].storageCounts.indexedDB,1);assert.equal(report.stages[1].storageCounts.indexedDB,0);assert.equal(report.stages[1].checks.every(x=>x.passed),true);process.stdout.write(`Saved storage-disappearance evidence: ${f.out}\n`);
});

test('undeclared IndexedDB assertions prevent a migration pass',integrationOptions,async()=>{
 const f=await fixtures('preserve');let scenario=await readFile(f.scenario,'utf8');scenario=scenario.replace('"storageTypes":["localStorage"]','"storageTypes":["localStorage","indexedDB"]');await writeFile(f.scenario,scenario);const result=await run(f);const report=JSON.parse(await readFile(path.join(f.out,'report.json'),'utf8'));assert.notEqual(result.code,0);assert.equal(report.status,'ERROR');assert.equal(report.error.stage,'old-seed');process.stdout.write(`Saved storage-coverage evidence: ${f.out}\n`);
});

test('configuration exception text is not echoed by top-level CLI',integrationOptions,async()=>{
 const f=await fixtures('preserve'),secret='unique-configuration-fake-secret-12345';await writeFile(f.scenario,`JSON.parse('invalid ${secret}');`);const result=await run(f);assert.equal(result.code,2);assert.equal((result.stdout+result.stderr).includes(secret),false);assert.match(result.stderr,/error SHA256: [a-f0-9]{64}/);
});

for(const mode of ['old-pass','candidate-fail','old-count-fail'])test('exact old optional 404 '+mode,integrationOptions,async()=>{
 const f=await fixtures('preserve'),optional='/optional-azure-manifest.json';
 const oldFile=path.join(f.old,'index.html');let old=await readFile(oldFile,'utf8');old=old.replace('<button id="seed">',`<img src="${optional}" alt="optional voice"><button id="seed">`);await writeFile(oldFile,old);
 const b=await readFile(oldFile),digest=createHash('sha256').update(JSON.stringify([{path:'index.html',bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}])).digest('hex');
 const meta={...metadata,oldSeedNetworkExceptions:[{oldBuildSha256:digest,path:optional,status:404,maxCount:1,reason:'optional old voice manifest known missing in this exact fixture'}]};
 let scenario=await readFile(f.scenario,'utf8');scenario=scenario.replace(`export const metadata=${JSON.stringify(metadata)};`,`export const metadata=${JSON.stringify(meta)};`);
 if(mode==='old-count-fail')scenario=scenario.replace("await page.click('#seed');","await page.reload({waitUntil:'load'});await page.click('#seed');");
 await writeFile(f.scenario,scenario);
 if(mode==='candidate-fail'){const file=path.join(f.candidate,'index.html'),html=await readFile(file,'utf8');await writeFile(file,html.replace('<script>',`<img src="${optional}" alt="unexpected candidate missing file"><script>`));}
 const result=await run(f),report=JSON.parse(await readFile(path.join(f.out,'report.json'),'utf8'));
 assert.equal(result.code,mode==='old-pass'?0:1,JSON.stringify({failures:report.failures,error:report.error,stderr:result.stderr}));
 assert.equal(report.status,mode==='old-pass'?'SAVE_UPGRADE_PASS':'FAIL');assert.equal(report.oldNetworkExceptions[0].status,404);assert.equal(report.oldNetworkExceptions[0].pathSha256,createHash('sha256').update(optional).digest('hex'));
 if(mode==='old-pass'){assert.equal(report.oldNetworkExceptions[0].observedResponses,1);assert.equal(report.cleanup.browser.confirmed,true);}else assert.ok(report.failures.some(x=>x==='HTTP 404 while serving build'));
});
