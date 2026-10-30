import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeOwnedBrowser,createOldNetworkPolicy,validateOldNetworkExceptions} from './save-upgrade-support.mjs';
import {parseArgs,validateMetadata} from './save-upgrade.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const sha='a'.repeat(64),origin='http://127.0.0.1:1234';
const rule={oldBuildSha256:sha,path:'/optional-azure-manifest.json',status:404,maxCount:1,reason:'verified optional voice manifest absent in the exact published old tree'};
const url=origin+rule.path;
const fake=()=>{const child={pid:12345,exitCode:null,signalCode:null,killCalls:[],kill(signal){this.killCalls.push(signal);this.signalCode=signal;return true;}};return{child,server:{process:()=>child,close:async()=>{child.exitCode=0;},kill:async()=>{child.signalCode='SIGKILL';}}};};
test('cleanup has a configurable independent deadline, default 20s and bounded arguments',()=>{
 const args=['--project','/tmp/game','--old-dir','/tmp/old','--new-dir','/tmp/new','--scenario','/tmp/scenario.mjs','--out','/tmp/out'];
 assert.equal(parseArgs(args).cleanupTimeoutMs,20_000);assert.equal(parseArgs([...args,'--cleanup-timeout-ms','30000']).cleanupTimeoutMs,30_000);
 for(const n of ['99','120001','Infinity'])assert.throws(()=>parseArgs([...args,'--cleanup-timeout-ms',n]));
});
test('a slow but bounded owned graceful close passes without killing and records its method',async()=>{
 const f=fake();f.server.close=async()=>{await new Promise(r=>setTimeout(r,20));f.child.exitCode=0;};
 const r=await closeOwnedBrowser({close:async()=>{}},f.server,{timeoutMs:60,ownedPid:f.child.pid});assert.deepEqual(r.failures,[]);assert.equal(r.evidence.method,'graceful');assert.equal(r.evidence.confirmed,true);assert.deepEqual(f.child.killCalls,[]);
});
test('failed connection/close can pass only after the captured owned server kill confirms exit',async()=>{
 const f=fake();f.server.close=()=>new Promise(()=>{});const r=await closeOwnedBrowser({close:async()=>{throw Error('disconnect');}},f.server,{timeoutMs:5,ownedPid:f.child.pid});assert.deepEqual(r.failures,[]);assert.equal(r.evidence.connection,'close-timeout-or-error');assert.equal(r.evidence.method,'owned-server-kill');assert.equal(r.evidence.confirmed,true);
});
test('fallback SIGKILL targets only this exact owned child, and unconfirmed exit remains failure',async()=>{
 const f=fake();f.server.close=async()=>{throw Error('close');};f.server.kill=async()=>{throw Error('kill');};let r=await closeOwnedBrowser(undefined,f.server,{timeoutMs:5,ownedPid:f.child.pid});assert.equal(r.evidence.method,'owned-child-sigkill');assert.deepEqual(f.child.killCalls,['SIGKILL']);assert.deepEqual(r.failures,[]);
 const g=fake();g.server.close=async()=>{};g.server.kill=async()=>{};g.child.kill=()=>true;r=await closeOwnedBrowser(undefined,g.server,{timeoutMs:5,ownedPid:g.child.pid});assert.equal(r.evidence.confirmed,false);assert.ok(r.failures.length);
});
test('missing or mismatched launch ownership never closes or kills a server',async()=>{
 for(const pid of [undefined,999]){const f=fake();let called=0;f.server.close=async()=>{called++;};f.server.kill=async()=>{called++;};const r=await closeOwnedBrowser(undefined,f.server,{timeoutMs:5,ownedPid:pid});assert.equal(called,0);assert.deepEqual(f.child.killCalls,[]);assert.ok(r.failures.length);}
 const r=await closeOwnedBrowser(undefined,{process(){throw Error('unknown');}},{timeoutMs:5,ownedPid:1});assert.equal(r.evidence.method,'ownership-unconfirmed');assert.ok(r.failures.length);
});
test('old exception requires exact digest/path/404/count/reason and rejects bypass syntax',()=>{
 assert.equal(validateOldNetworkExceptions([rule]).length,1);
 for(const x of [{...rule,path:'/*'},{...rule,path:'/a?x=1'},{...rule,path:'/a/../b'},{...rule,path:'https://evil/a'},{...rule,path:'//a'},{...rule,status:500},{...rule,maxCount:0},{...rule,maxCount:100},{...rule,oldBuildSha256:'a'},{...rule,reason:''},{...rule,ignoreAll:true}])assert.throws(()=>validateOldNetworkExceptions([x]));
 assert.throws(()=>validateOldNetworkExceptions([rule,rule]));assert.throws(()=>validateMetadata({seedKind:'OLD_UI',storageTypes:['localStorage'],oldSeedNetworkExceptions:[{...rule,path:'/*'}]}));
});
test('only exact old boot/seed failures are eligible; candidate, external, query and wrong hash all fail',()=>{
 for(const [u,s,phase]of [[url,404,'candidate-navigation'],[url,404,'candidate-upgrade'],[url,404,'candidate-reload-1'],['https://elsewhere.invalid'+rule.path,404,'old-seed'],[url+'?x=1',404,'old-seed'],[url,500,'old-seed'],[origin+'/other.json',404,'old-seed']]){const p=createOldNetworkPolicy([rule],{oldBuildSha256:sha,origin});assert.equal(p.allowResponse(u,s,phase),false);}
 assert.equal(createOldNetworkPolicy([rule],{oldBuildSha256:'b'.repeat(64),origin}).allowResponse(url,404,'old-seed'),false);
 const p=createOldNetworkPolicy([rule],{oldBuildSha256:sha,origin});assert.equal(p.allowResponse(url,404,'old-navigation'),true);assert.equal(p.allowResponse(url,404,'old-seed'),false,'maxCount cannot be exceeded by an old reload');
});
test('404 console suppression requires a paired approved response, exact origin/path and bounded count',()=>{
 const text='Failed to load resource: the server responded with a status of 404 (Not Found)';const p=createOldNetworkPolicy([rule],{oldBuildSha256:sha,origin});assert.equal(p.allowConsole({url,text,phase:'old-seed'}),false);assert.equal(p.allowResponse(url,404,'old-seed'),true);
 const q=createOldNetworkPolicy([rule],{oldBuildSha256:sha,origin});q.allowResponse(url,404,'old-seed');assert.equal(q.allowConsole({url,text:'game error',phase:'old-seed'}),false);assert.equal(q.allowConsole({url,text,phase:'candidate-upgrade'}),false);assert.equal(q.allowConsole({url,text,phase:'old-seed'}),true);assert.equal(q.allowConsole({url,text,phase:'old-seed'}),false);assert.ok(!JSON.stringify(q.evidence(hash)).includes(rule.path));assert.ok(!JSON.stringify(q.evidence(hash)).includes(rule.reason));
});
