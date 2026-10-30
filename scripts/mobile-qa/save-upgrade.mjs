#!/usr/bin/env node
import { closeOwnedBrowser, validateOldNetworkExceptions, createOldNetworkPolicy } from './save-upgrade-support.mjs';
/** Same-origin, old-build-to-candidate save regression. Never approves a release. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const CATEGORIES = ['progress', 'resources', 'unlocks', 'records'];
const STORAGE = ['localStorage', 'indexedDB'];
const HELP = `Same-origin save upgrade regression (browser evidence only)
Usage: node save-upgrade.mjs --project /absolute/game --old-dir /absolute/old/dist --new-dir /absolute/candidate/dist --scenario /absolute/scenario.mjs --out /absolute/new-output
Options: --engine chromium|webkit (default chromium), --timeout-ms N (default 20000), --stage-timeout-ms N (default 120000), --cleanup-timeout-ms N (default 20000), --help
Optional --channel chrome uses already-installed system Google Chrome with the
chromium engine only. Other channels and WebKit plus channel are rejected.
Omitting --channel preserves the bundled-engine default. No browser is installed
or substituted; the report records requested and successfully launched channels.
No production URL is accepted. A new loopback-only server serves old then new files
at the same origin in one fresh browser context. Network is restricted to this origin.
The scenario exports metadata, seedOld, assertUpgraded and assertReload:
metadata = { seedKind: 'OLD_UI' | 'SANITIZED_FIXTURE', fixtureVersion?: string,
  storageTypes: ['localStorage' | 'indexedDB'], notApplicable?: { category: reason } }
seedOld({page}) returns { before: <in-memory baseline>, checks: [...] }.
assertUpgraded({page,before}) / assertReload({page,before,reloadIndex}) return {checks:[...]}.
Each check: { storage: 'localStorage'|'indexedDB', category: 'progress'|'resources'|'unlocks'|'records', name,
  expected, actual, comparison?: 'equal'|'at-least'|'includes' }.
The runner calculates pass/fail. Every applicable category and every declared storage type need a check at every stage.
Baseline, storage names, scenario labels and expected/actual values stay in memory; reports store only hashes and outcomes.
Errors expose only fixed stage/type labels and a message digest, never exception text.
Two candidate reloads verify stable saves and migration idempotence. Storage.clear is a failure.
A previously nonempty declared storage type must remain nonempty at upgrade and reload.
Whole-storage migration between localStorage and IndexedDB is not supported by this protocol.
localStorage and ordinary JSON-compatible IndexedDB keys/values are fingerprinted;
unsupported storage values or incomplete IndexedDB reads cannot pass.
Exit: 0 SAVE_UPGRADE_PASS, 1 observed failure, 2 configuration/dependency error.
Every report has releaseGate=NOT_EVALUATED; native/platform save migration is separate.
WebKit is browser-engine H5 evidence, not an iOS Simulator or the iOS TapTap host.
Cleanup uses its own configurable deadline and records graceful/owned-kill confirmation.
Known optional old-only 404s require metadata.oldSeedNetworkExceptions entries with
oldBuildSha256 (old tree hash), exact path, status:404, maxCount and reason.
No candidate or external failure can use that declaration.
`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
function errorInfo(error, stage) {
  // Exception messages may embed an entire old save (for example JSON.parse).
  // Keep only an allowlisted type and a digest; never echo scenario error text.
  let type='UnknownError', message='';
  try { if(['Error','TypeError','SyntaxError','RangeError','TimeoutError','ReferenceError'].includes(error?.name))type=error.name;message=String(error?.message??''); } catch {}
  return {stage,type,messageSha256:hash(message)};
}
function metadataEvidence(metadata) {
  return {seedKind:metadata.seedKind,fixtureVersionSha256:metadata.fixtureVersion===null?null:hash(metadata.fixtureVersion),storageTypes:metadata.storageTypes,oldSeedNetworkExceptions:metadata.oldSeedNetworkExceptions.map(e=>({oldBuildSha256:e.oldBuildSha256,pathSha256:hash(e.path),status:e.status,maxCount:e.maxCount,reasonSha256:hash(e.reason)})),
    notApplicable:Object.fromEntries(Object.entries(metadata.notApplicable).map(([category,reason])=>[category,{reasonSha256:hash(reason)}]))};
}
async function json(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {mode:0o600}); }
async function bounded(operation, ms, name) { let timer; try { return await Promise.race([operation, new Promise((_, reject) => {timer=setTimeout(()=>reject(new Error(`${name} timed out after ${ms}ms`)),ms);})]); } finally { clearTimeout(timer); } }
function args(argv) {
  const o={timeoutMs:20000,stageTimeoutMs:120000,cleanupTimeoutMs:20000,engine:'chromium'};
  const map={'--engine':'engine','--channel':'channel','--project':'project','--old-dir':'oldDir','--new-dir':'newDir','--scenario':'scenario','--out':'out','--timeout-ms':'timeoutMs','--stage-timeout-ms':'stageTimeoutMs','--cleanup-timeout-ms':'cleanupTimeoutMs'};
  for(let i=0;i<argv.length;i++){ if(argv[i]==='--help'){o.help=true;continue;} const key=map[argv[i]]; if(!key||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Unknown or incomplete option; use --help.');o[key]=argv[++i]; }
  if(o.help)return o;if(!['chromium','webkit'].includes(o.engine))throw new Error('--engine must be chromium or webkit.');
  if(o.channel!==undefined&&(o.channel!=='chrome'||o.engine!=='chromium'))throw new Error('--channel only accepts chrome with --engine chromium; omit it for bundled engines.');
  for(const k of ['project','oldDir','newDir','scenario','out']){if(!o[k]||!path.isAbsolute(o[k]))throw new Error(`--${Object.entries(map).find(([,v])=>v===k)[0].slice(2)} requires an absolute path.`);o[k]=path.resolve(o[k]);}
  for(const k of ['timeoutMs','stageTimeoutMs','cleanupTimeoutMs']){o[k]=Number(o[k]);if(!Number.isInteger(o[k])||o[k]<100||o[k]>900000)throw new Error(`${k} must be 100..900000.`);}
  if(o.cleanupTimeoutMs>120000)throw new Error('cleanupTimeoutMs must be 100..120000.');
  if(path.extname(o.scenario)!=='.mjs')throw new Error('Scenario must be a local .mjs module.');for(const root of [o.oldDir,o.newDir])if(o.out===root||o.out.startsWith(root+path.sep))throw new Error('--out must be outside both immutable build roots.');return o;
}
async function treeIdentity(root) {
  const files=[];root=await realpath(root);
  async function walk(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Build roots cannot contain symlinks.');if(e.isDirectory())await walk(p);else if(e.isFile()){const b=await readFile(p);files.push({path:path.relative(root,p),bytes:b.length,sha256:hash(b)});}}}
  await walk(root);if(!files.some(f=>f.path==='index.html'))throw new Error('Each build root must contain index.html.');return {root,fileCount:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),sha256:hash(JSON.stringify(files))};
}
function validateMetadata(m) {
  if(!m||!['OLD_UI','SANITIZED_FIXTURE'].includes(m.seedKind)||!Array.isArray(m.storageTypes)||!m.storageTypes.length||m.storageTypes.some(x=>!STORAGE.includes(x))||new Set(m.storageTypes).size!==m.storageTypes.length)throw new Error('Scenario metadata must declare seedKind and supported storageTypes.');
  if(m.seedKind==='SANITIZED_FIXTURE'&&(!m.fixtureVersion||typeof m.fixtureVersion!=='string'))throw new Error('SANITIZED_FIXTURE requires fixtureVersion.');
  const na=m.notApplicable??{};if(Object.entries(na).some(([k,v])=>!CATEGORIES.includes(k)||typeof v!=='string'||!v.trim()))throw new Error('notApplicable requires known categories and nonempty reasons.');
  if(CATEGORIES.every(k=>na[k]))throw new Error('At least one save category must be applicable.');return {seedKind:m.seedKind,fixtureVersion:m.fixtureVersion??null,storageTypes:m.storageTypes,notApplicable:na,oldSeedNetworkExceptions:validateOldNetworkExceptions(m.oldSeedNetworkExceptions)};
}
function checks(result, metadata) {
  if(!Array.isArray(result?.checks)||!result.checks.length)throw new Error('Every stage must return explicit save checks.');
  const covered=new Set(),storageCovered=new Set();const out=result.checks.map(c=>{
    if(!c||!STORAGE.includes(c.storage)||!metadata.storageTypes.includes(c.storage)||!CATEGORIES.includes(c.category)||typeof c.name!=='string'||!c.name.trim()||!Object.hasOwn(c,'expected')||!Object.hasOwn(c,'actual'))throw new Error('Checks require declared storage, category, name, expected and actual.');
    if(c.expected===undefined)throw new Error('Expected baseline values must be explicit, not undefined.');const comparison=c.comparison??'equal';let passed;
    if(comparison==='equal')passed=isDeepStrictEqual(c.expected,c.actual);
    else if(comparison==='at-least'){if(!Number.isFinite(c.expected)||!Number.isFinite(c.actual))throw new Error('at-least requires finite numbers.');passed=c.actual>=c.expected;}
    else if(comparison==='includes'){if(!Array.isArray(c.expected)||!Array.isArray(c.actual))throw new Error('includes requires arrays.');passed=c.expected.every(e=>c.actual.some(a=>isDeepStrictEqual(e,a)));}
    else throw new Error('Unsupported comparison.');
    covered.add(c.category);storageCovered.add(c.storage);return {storage:c.storage,category:c.category,nameSha256:hash(c.name),comparison,passed,expectedSha256:hash(JSON.stringify(c.expected)??'undefined'),actualSha256:hash(JSON.stringify(c.actual)??'undefined')};
  });
  for(const category of CATEGORIES)if(!(metadata.notApplicable??{})[category]&&!covered.has(category))throw new Error(`Stage missing ${category} assertion.`);for(const storage of metadata.storageTypes)if(!storageCovered.has(storage))throw new Error('Stage missing declared storage assertions.');return out;
}
async function loadPlaywright(project,engine){const req=createRequire(path.join(project,'package.json'));for(const spec of ['playwright','@playwright/test']){try{const mod=await import(pathToFileURL(req.resolve(spec)).href);const api=mod.chromium?mod:mod.default;if(api?.[engine]?.launchServer&&api?.[engine]?.connect)return api[engine];}catch{}}
  throw new Error('No usable Playwright in --project; restore its existing dependencies and matching requested browser engine. This runner installs nothing.');}
function mime(file){return ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.glb':'model/gltf-binary'})[path.extname(file)]??'application/octet-stream';}
async function hostBuilds(oldRoot,newRoot){let root=oldRoot;const sockets=new Set();const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1');let rel=decodeURIComponent(u.pathname).replace(/^\/+/, '');if(!rel)rel='index.html';const target=path.resolve(root,rel);if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const resolved=await realpath(target);if(!resolved.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const info=await stat(resolved);if(!info.isFile()){res.writeHead(404);res.end();return;}const b=await readFile(resolved);res.writeHead(200,{'content-type':mime(resolved),'cache-control':'no-store'});res.end(b);}catch{res.writeHead(404);res.end();}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return {origin:`http://127.0.0.1:${server.address().port}`,candidate(){root=newRoot;},async close(){for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};}
async function storageFingerprint(page, storageTypes, timeout){
 const data=await bounded(page.evaluate(async(types)=>{
   const result={localStorage:[],indexedDB:[],unsupported:[]};
   if(types.includes('localStorage'))result.localStorage=Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]);
   const encode=(value)=>{if(value===null||['string','boolean','number'].includes(typeof value)){if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Nonfinite value');return value;}if(Array.isArray(value))return value.map(encode);if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).sort().map(k=>[k,encode(value[k])]));throw new Error('Unsupported structured value');};
   if(!indexedDB.databases){if(types.includes('indexedDB'))result.unsupported.push('IndexedDB enumeration is unavailable');return result;}
   const databases=await indexedDB.databases();
   if(!types.includes('indexedDB')){if(databases.length)result.unsupported.push('IndexedDB exists but is not declared covered');return result;}
   for(const description of databases){if(!description.name)continue;const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(description.name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('IndexedDB open failed'));request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('Unexpected IndexedDB schema creation'));};});
    try{const stores=[];for(const name of [...db.objectStoreNames].sort()){const rows=await new Promise((resolve,reject)=>{const tx=db.transaction(name,'readonly');const rows=[];const req=tx.objectStore(name).openCursor();req.onerror=()=>reject(new Error('IndexedDB cursor failed'));tx.onerror=()=>reject(new Error('IndexedDB read failed'));req.onsuccess=()=>{const c=req.result;if(!c){resolve(rows);return;}if(rows.length>=10000){reject(new Error('IndexedDB fingerprint exceeds 10000 rows'));return;}try{rows.push([encode(c.key),encode(c.value)]);}catch{reject(new Error('IndexedDB has unsupported structured values'));return;}c.continue();};});stores.push({name,rows});}result.indexedDB.push({name:db.name,version:db.version,stores});}finally{db.close();}}
   return result;
 },storageTypes),timeout,'Storage fingerprint');
 return {localStorage:data.localStorage.map(([key,value])=>({keySha256:hash(key),bytes:Buffer.byteLength(value??''),sha256:hash(value??'')})),indexedDB:data.indexedDB.map(db=>({nameSha256:hash(db.name),version:db.version,stores:db.stores.map(s=>({nameSha256:hash(s.name),rowCount:s.rows.length,sha256:hash(JSON.stringify(s.rows))}))})),unsupported:data.unsupported};
}
async function main(){const o=args(process.argv.slice(2));if(o.help){process.stdout.write(HELP);return;}const metaModule=await import(pathToFileURL(o.scenario).href);const metadata=validateMetadata(metaModule.metadata);for(const key of ['seedOld','assertUpgraded','assertReload'])if(typeof metaModule[key]!=='function')throw new Error(`Scenario missing ${key}.`);
 if(await stat(o.out).then(()=>true,()=>false))throw new Error('--out must not exist; previous evidence is preserved.');await mkdir(o.out,{recursive:true,mode:0o700});
 const report={schemaVersion:1,status:'ERROR',startedAt:new Date().toISOString(),finishedAt:null,evidenceType:'BROWSER_SAME_ORIGIN_SAVE_UPGRADE',browserEngine:o.engine,requestedBrowserChannel:o.channel??null,releaseGate:'NOT_EVALUATED',metadata:metadataEvidence(metadata),scenario:{path:o.scenario,sha256:hash(await readFile(o.scenario))},stages:[],failures:[],limitations:['Only declared browser storage and explicit scenario assertions are covered.','TapTap native storage/cloud/account migration, origin changes, physical devices and prior already-lost data are not verified.','Synthetic fixtures do not prove every historical player save migrates.','Raw baseline, values, cookies and database rows are never written to this report.','WebKit browser evidence does not verify iOS Simulator, iOS TapTap host or physical iPhone behavior.']};
 let browserServer,browser,context,host,ownedPid,networkPolicy;const consoleErrors=[];let phase='build-identification';
 try{report.builds={old:await treeIdentity(o.oldDir),candidate:await treeIdentity(o.newDir)};let sourceCommit=null;try{sourceCommit=execFileSync('git',['-C',o.project,'rev-parse','HEAD'],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();}catch{}report.source={project:o.project,checkoutCommit:sourceCommit,buildAssociation:'Build tree hashes are recorded; association with release commits remains a separate check.'};
 if(metadata.oldSeedNetworkExceptions.some(e=>e.oldBuildSha256!==report.builds.old.sha256))throw new Error('Old network exception build identity does not match.');
 phase='browser-setup';const browserType=await loadPlaywright(o.project,o.engine);host=await hostBuilds(report.builds.old.root,report.builds.candidate.root);report.origin=host.origin;networkPolicy=createOldNetworkPolicy(metadata.oldSeedNetworkExceptions,{oldBuildSha256:report.builds.old.sha256,origin:host.origin});
 browserServer=await browserType.launchServer({headless:true,host:'127.0.0.1',timeout:o.timeoutMs,...(o.channel?{channel:o.channel}:{})});ownedPid=browserServer.process()?.pid;browser=await browserType.connect(browserServer.wsEndpoint(),{timeout:o.timeoutMs});report.browser={engine:o.engine,channel:o.channel??'bundled-'+o.engine,version:browser.version()};context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block',acceptDownloads:false});
 if(typeof context.routeWebSocket!=='function')throw new Error('Playwright must support routeWebSocket to enforce complete external-network isolation.');await context.routeWebSocket(/.*/,socket=>{report.failures.push('WebSocket request blocked during isolated migration test');socket.close();});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==host.origin){report.failures.push('External request blocked during isolated migration test');await route.abort('blockedbyclient');}else await route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(o.timeoutMs);page.setDefaultNavigationTimeout(o.timeoutMs);page.on('pageerror',()=>report.failures.push('Uncaught page error'));const requestPhases=new WeakMap();page.on('request',r=>requestPhases.set(r,phase));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url,phase});});page.on('response',r=>{if(r.status()>=400&&!networkPolicy.allowResponse(r.url(),r.status(),requestPhases.get(r.request())??phase))report.failures.push(`HTTP ${r.status()} while serving build`);});
 await page.exposeFunction('__creatorQaStorageClear',()=>{report.failures.push('Storage.clear invoked; migration cannot pass by wiping storage');});await context.addInitScript(()=>{const original=Storage.prototype.clear;Storage.prototype.clear=function(){void globalThis.__creatorQaStorageClear();return original.apply(this,arguments);};});
 let before,oldStorageCounts;
 const storageCounts=fingerprint=>({localStorage:fingerprint.localStorage.length,indexedDB:fingerprint.indexedDB.reduce((total,db)=>total+db.stores.reduce((n,store)=>n+store.rowCount,0),0)});
 const stage=async(name,operation)=>{phase=name;const result=await bounded(operation(),o.stageTimeoutMs,name);if(new URL(page.url()).origin!==host.origin)throw new Error('Save test changed origin.');const asserted=checks(result,metadata);const fingerprint=await storageFingerprint(page,metadata.storageTypes,o.timeoutMs);if(fingerprint.unsupported.length)throw new Error('Storage coverage is incomplete: '+fingerprint.unsupported.join('; '));const counts=storageCounts(fingerprint);report.stages.push({name,origin:host.origin,checks:asserted,storage:fingerprint,storageCounts:counts});if(name==='old-seed')oldStorageCounts=counts;else for(const storage of metadata.storageTypes)if(oldStorageCounts[storage]>0&&counts[storage]===0){report.failures.push('Previously nonempty declared storage became empty: '+storage);throw new Error('Declared persistent storage disappeared');}if(asserted.some(c=>!c.passed))throw new Error(name+' save assertions failed');return result;};
 phase='old-navigation';await page.goto(host.origin,{waitUntil:'domcontentloaded'});const seeded=await stage('old-seed',()=>metaModule.seedOld({page}));if(!Object.hasOwn(seeded,'before'))throw new Error('seedOld must return an in-memory before baseline.');const seededStorage=report.stages.at(-1).storage;if(!seededStorage.localStorage.length&&!seededStorage.indexedDB.some(db=>db.stores.some(store=>store.rowCount>0)))throw new Error('Old build did not establish any declared persistent save data.');before=structuredClone(seeded.before);
 host.candidate();phase='candidate-navigation';await page.reload({waitUntil:'domcontentloaded'});await stage('candidate-upgrade',()=>metaModule.assertUpgraded({page,before:structuredClone(before)}));
 for(let reloadIndex=1;reloadIndex<=2;reloadIndex++){phase='candidate-reload-navigation-'+reloadIndex;await page.reload({waitUntil:'domcontentloaded'});await stage('candidate-reload-'+reloadIndex,()=>metaModule.assertReload({page,before:structuredClone(before),reloadIndex}));}
 report.status=report.failures.length?'FAIL':'SAVE_UPGRADE_PASS';process.exitCode=report.failures.length?1:0;
 phase='final-build-identification';const finalOld=await treeIdentity(o.oldDir),finalCandidate=await treeIdentity(o.newDir);if(finalOld.sha256!==report.builds.old.sha256||finalCandidate.sha256!==report.builds.candidate.sha256)throw new Error('Build files changed during save regression; evidence invalidated');report.builds.unchangedDuringRun=true;
 }catch(error){report.error=errorInfo(error,phase);report.failures.push('Operation failed during '+phase);report.status=report.stages.length?'FAIL':'ERROR';process.exitCode=report.status==='FAIL'?1:2;}finally{const timeout=o.cleanupTimeoutMs;report.cleanup={timeoutMs:timeout,context:'not-created'};if(context){try{await bounded(context.close(),timeout,'Context close');report.cleanup.context='closed';}catch{report.cleanup.context='close-timeout-or-error';}}
 const cleanup=await closeOwnedBrowser(browser,browserServer,{timeoutMs:timeout,ownedPid});report.cleanup.browser=cleanup.evidence;report.failures.push(...cleanup.failures);if(host){try{await bounded(host.close(),timeout,'Loopback server close');report.cleanup.host='closed';}catch{report.cleanup.host='unconfirmed';report.failures.push('Loopback server close failed');}}for(const message of consoleErrors)if(!networkPolicy?.allowConsole(message))report.failures.push('Browser console error');if(networkPolicy)report.oldNetworkExceptions=networkPolicy.evidence(hash);if(report.failures.length&&report.status==='SAVE_UPGRADE_PASS'){report.status='FAIL';process.exitCode=1;}report.finishedAt=new Date().toISOString();await json(path.join(o.out,'report.json'),report);process.stdout.write(`${report.status}; releaseGate=NOT_EVALUATED\nReport: ${path.join(o.out,'report.json')}\n`);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{const info=errorInfo(error,'configuration');process.stderr.write(`Save upgrade configuration failed (${info.type}); error SHA256: ${info.messageSha256}\n`);process.exitCode=2;});
export { checks, validateMetadata, args as parseArgs, closeOwnedBrowser, createOldNetworkPolicy };
