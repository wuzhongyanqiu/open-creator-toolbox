import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { CloudSaveController, createDesktopShortcut, nativeCall, recoverCloudJournal, cloudJournalKey, hasCloudJournal } from './cloud-save.ts';
const keys = [{key:'profile',required:true},{key:'run'}];
const good = n => JSON.stringify({v:1,coins:n,owned:['one']});
const validate = raw => { const p=JSON.parse(raw.profile); return p.v===1 && Number.isFinite(p.coins) && (raw.run===null || JSON.parse(raw.run).v===1); };
class Memory {
  map = new Map([['profile',good(10)],['run',null]]);
  get length(){return this.map.size;}
  key(i){return [...this.map.keys()][i]??null;}
  readError = false;
  writeHook = null;
  getItem(k){ if(this.readError)throw Error('denied');return this.map.get(k)??null; }
  setItem(k,v){this.writeHook?.(k,v);this.map.set(k,v);}
  removeItem(k){this.writeHook?.(k,null);this.map.delete(k);}
}
class Host {
  env={USER_DATA_PATH:'tapfile://usr'};
  files=new Map(); archives=new Map(); calls=[]; seq=0; hooks={};
  invoke(name,o,defaultAction){this.calls.push(name);if(this.hooks[name])return this.hooks[name](o,defaultAction);return defaultAction();}
  getFileSystemManager(){return {
    writeFile:o=>this.invoke('write',o,()=>{this.files.set(o.filePath,o.data);o.success({});}),
    readFile:o=>this.invoke('read',o,()=>o.success({data:this.files.get(o.filePath)})),
  };}
  getCloudSaveManager(){return {
    getArchiveList:o=>this.invoke('list',o,()=>o.success({saves:[...this.archives.values()].map(a=>({uuid:a.uuid,fileId:a.fileId,name:a.name,summary:a.summary}))})),
    createArchive:o=>this.invoke('create',o,()=>{const uuid='uuid'+ ++this.seq;this.archives.set(uuid,{uuid,fileId:'file'+this.seq,...o.archiveMetaData,data:this.files.get(o.archiveFilePath)});o.success({uuid});}),
    getArchiveData:o=>this.invoke('download',o,()=>{const a=this.archives.get(o.archiveUUID);if(!a)return o.fail({});this.files.set(o.targetFilePath,a.data);o.success({filePath:o.targetFilePath});}),
    deleteArchive:o=>this.invoke('delete',o,()=>{this.archives.delete(o.archiveUUID);o.success({});}),
  };}
}
function harness(overrides={}){
 const storage=new Memory(),host=new Host();let time=1_000_000,account='account-a',locked=false,reloads=0,locks=0;
 const config={appId:'123456',schema:1,keys,storage,validate,describe:()=> '合成测试存档',crypto:webcrypto,timeoutMs:20,runtime:()=>host,accountToken:()=>account,now:()=>time,lockWrites:()=>{locked=true;locks++;return()=>{locked=false;};},reload:()=>{reloads++;},...overrides};
 const ctrl=new CloudSaveController(config);
 return{storage,host,config,ctrl,advance:n=>{time+=n;},account:x=>{account=x;},get locked(){return locked;},get reloads(){return reloads;},get locks(){return locks;}};
}
const dispose=h=>h.ctrl.destroy();
async function saved(h){const r=await h.ctrl.backup();assert.equal(r.ok,true,JSON.stringify(r));return r.uuid;}
async function select(h){assert.equal((await h.ctrl.listBackups()).ok,true);}

test('native callbacks settle once; timeout ignores a late callback and a following request',async()=>{
 let late;
 assert.equal(await nativeCall(o=>{o.success(7);o.success(8);o.fail({});throw Error('late');},{},20),7);
 await assert.rejects(nativeCall(o=>{late=o.success;},{},5),e=>e.code==='SDK_TIMEOUT');
 const second=nativeCall(o=>o.success(9),{},20);late(10);assert.equal(await second,9);
 await assert.rejects(nativeCall(()=>{throw Error('sync');},{},20),e=>e.code==='SDK_THROW');
});
test('backup is immutable, validates readback, and never creates before FS write success',async()=>{
 const h=harness();try{const id=await saved(h);const a=h.host.archives.get(id),e=JSON.parse(a.data);assert.equal(e.appId,'123456');assert.equal(e.format,'taptap-raw-save/1');assert.equal(e.payload.profile,good(10));assert.equal(e.payload.run,null);assert.match(e.payloadSha256,/^[a-f0-9]{64}$/);assert.ok(h.host.calls.indexOf('write')<h.host.calls.indexOf('create'));assert.ok(h.host.calls.indexOf('create')<h.host.calls.indexOf('download'));assert.equal(h.ctrl.getState().lastCloudSavedAt,1_000_000);}finally{dispose(h);}
});
test('duplicate SDK success/failure callbacks cannot create or confirm twice',async()=>{
 const h=harness();h.host.hooks.create=(o,next)=>{next();o.success({uuid:'wrong'});o.fail({});};try{assert.ok(await saved(h));assert.equal(h.host.archives.size,1);assert.equal(h.host.calls.filter(x=>x==='create').length,1);}finally{dispose(h);}
});
test('concurrent backup clicks coalesce and 75s throttle persists across controllers',async()=>{
 const h=harness();try{let ready;h.host.hooks.write=(o,next)=>{ready=next;};const one=h.ctrl.backup(),two=h.ctrl.backup();assert.strictEqual(one,two);for(let i=0;i<10&&!ready;i++)await new Promise(r=>setTimeout(r,1));ready();assert.equal((await one).ok,true);delete h.host.hooks.write;assert.equal((await h.ctrl.backup()).code,'RATE_LIMIT');const next=new CloudSaveController(h.config);assert.equal((await next.backup()).code,'RATE_LIMIT');next.destroy();h.advance(75_000);assert.equal((await h.ctrl.backup()).ok,true);}finally{dispose(h);}
});
test('local read failure, blocked load, primary absence, bad JSON, future schema and no hash cannot upload',async()=>{
 for(const kind of ['read','blocked','missing','json','schema','hash']){const h=harness(kind==='blocked'?{readBlocked:()=>true}:kind==='hash'?{crypto:{}}:{});try{if(kind==='read')h.storage.readError=true;if(kind==='missing')h.storage.map.delete('profile');if(kind==='json')h.storage.map.set('profile','{bad');if(kind==='schema')h.storage.map.set('profile',JSON.stringify({v:99,coins:88}));const before=h.storage.map.get('profile');assert.equal((await h.ctrl.backup()).ok,false,kind);assert.equal(h.host.calls.filter(x=>x==='create').length,0,kind);assert.equal(h.storage.map.get('profile'),before,kind);}finally{dispose(h);}}
});
test('write failure and FS failure leave local data; no create without acknowledged local file',async()=>{
 for(const kind of ['meta','file']){const h=harness();try{if(kind==='meta')h.storage.writeHook=()=>{throw Error('quota');};else h.host.hooks.write=o=>o.fail({});const result=await h.ctrl.backup();assert.equal(result.ok,false);assert.equal(h.storage.getItem('profile'),good(10));assert.equal(h.host.archives.size,0);}finally{dispose(h);}}
});
test('timed-out FS callback does not advance the old operation after a new backup',async()=>{
 const h=harness();try{let late;h.host.hooks.write=(o,next)=>{late=next;};assert.equal((await h.ctrl.backup()).code,'SDK_TIMEOUT');delete h.host.hooks.write;h.advance(75_000);const id=await saved(h);late();await new Promise(r=>setTimeout(r,1));assert.equal(h.host.archives.size,1);assert.ok(h.host.archives.has(id));}finally{dispose(h);}
});
test('wrong app, unknown envelope schema, payload checksum and bad game schema never restore',async()=>{
 for(const mode of ['app','schema','checksum','game']){const h=harness();try{const id=await saved(h),a=h.host.archives.get(id),e=JSON.parse(a.data);if(mode==='app')e.appId='999';if(mode==='schema')e.schema=99;if(mode==='checksum')e.payload.profile=good(777);if(mode==='game')e.payload.profile=JSON.stringify({v:99,coins:5});a.data=JSON.stringify(e);await select(h);const before=h.storage.getItem('profile');const result=await h.ctrl.restore(id,{confirm:true});assert.equal(result.ok,false,mode);assert.equal(h.storage.getItem('profile'),before);assert.equal(h.locks,0);}finally{dispose(h);}}
});
test('restore requires list + explicit confirmation and rejects local changes since listing',async()=>{
 const h=harness();try{const id=await saved(h);assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'LIST_REQUIRED');await select(h);assert.equal((await h.ctrl.restore(id,{})).code,'CONFIRM_REQUIRED');await select(h);h.storage.setItem('profile',good(23));assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'LOCAL_CHANGED');assert.equal(h.storage.getItem('profile'),good(23));assert.equal(h.locks,0);}finally{dispose(h);}
});
test('successful multi-key restore is journalled, preserves null, and keeps old app writes locked until reload',async()=>{
 const h=harness();try{h.storage.setItem('run',JSON.stringify({v:1,step:2}));const id=await saved(h);h.storage.setItem('profile',good(88));h.storage.removeItem('run');await select(h);assert.equal((await h.ctrl.restore(id,{confirm:true})).ok,true);assert.equal(h.storage.getItem('profile'),good(10));assert.equal(h.storage.getItem('run'),JSON.stringify({v:1,step:2}));assert.equal(h.reloads,1);assert.equal(h.locked,true);assert.equal(hasCloudJournal(h.storage,'123456'),false);}finally{dispose(h);}
});
test('a partial write failure rolls every key back and releases barrier only after rollback verifies',async()=>{
 const h=harness();try{h.storage.setItem('run',JSON.stringify({v:1,step:2}));const id=await saved(h);h.storage.setItem('profile',good(88));h.storage.setItem('run',JSON.stringify({v:1,step:9}));await select(h);let failed=false;h.storage.writeHook=(key,value)=>{if(key==='run'&&value===JSON.stringify({v:1,step:2})&&!failed){failed=true;throw Error('disk');}};const r=await h.ctrl.restore(id,{confirm:true});assert.equal(r.ok,false);assert.equal(h.storage.getItem('profile'),good(88));assert.equal(h.storage.getItem('run'),JSON.stringify({v:1,step:9}));assert.equal(h.locked,false);assert.equal(h.reloads,0);assert.equal(hasCloudJournal(h.storage,'123456'),false);}finally{dispose(h);}
});
test('failed rollback retains journal and barrier; next startup recovers before store load',async()=>{
 const h=harness();try{h.storage.setItem('run',JSON.stringify({v:1,step:2}));const id=await saved(h);h.storage.setItem('profile',good(88));h.storage.setItem('run',JSON.stringify({v:1,step:9}));await select(h);h.storage.writeHook=key=>{if(key==='run')throw Error('persistent disk');};assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'ROLLBACK_BLOCKED');assert.equal(h.locked,true);assert.ok(h.storage.getItem(cloudJournalKey('123456')));h.storage.writeHook=null;assert.equal(recoverCloudJournal(h.config).status,'recovered');assert.equal(h.storage.getItem('profile'),good(88));assert.equal(h.storage.getItem('run'),JSON.stringify({v:1,step:9}));}finally{dispose(h);}
});
test('startup recovers interrupted opaque before bytes, never defaults; unknown journal stays blocked',()=>{
 const storage=new Memory(),before={profile:'corrupt original bytes',run:null},after={profile:good(200),run:JSON.stringify({v:1})};storage.setItem('profile',after.profile);storage.setItem(cloudJournalKey('123456'),JSON.stringify({format:'taptap-save-journal/1',appId:'123456',schema:1,phase:'applying',before,after}));assert.equal(recoverCloudJournal({appId:'123456',schema:1,keys,storage,validate}).status,'recovered');assert.equal(storage.getItem('profile'),before.profile);assert.equal(storage.getItem('run'),null);storage.setItem(cloudJournalKey('123456'),'{bad');assert.equal(recoverCloudJournal({appId:'123456',keys,storage}).status,'blocked');assert.equal(storage.getItem(cloudJournalKey('123456')),'{bad');
});
test('committed journal verifies after bytes; unknown schema and invalid committed data cannot unblock writes',()=>{
 const storage=new Memory(),before={profile:good(1),run:null},after={profile:good(2),run:null},j={format:'taptap-save-journal/1',appId:'123456',schema:1,phase:'committed',before,after};storage.setItem('profile',after.profile);storage.setItem(cloudJournalKey('123456'),JSON.stringify(j));assert.equal(recoverCloudJournal({appId:'123456',schema:1,keys,storage,validate}).status,'committed');storage.setItem(cloudJournalKey('123456'),JSON.stringify({...j,schema:99}));assert.equal(recoverCloudJournal({appId:'123456',schema:1,keys,storage,validate}).status,'blocked');assert.equal(storage.getItem('profile'),after.profile);
});
test('account switch before/during backup and after listing never confirms or restores a foreign session',async()=>{
 const h=harness();try{const id=await saved(h);await select(h);h.account('account-b');assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'ACCOUNT_CHANGED');h.advance(75_000);h.host.hooks.write=(o,next)=>{h.account('account-c');next();};const n=h.host.archives.size;assert.equal((await h.ctrl.backup()).code,'ACCOUNT_CHANGED');assert.equal(h.host.archives.size,n);assert.equal(h.storage.getItem('profile'),good(10));}finally{dispose(h);}
});
test('auto requires a current anchor; missing anchor and other-device new head stop auto without changing local',async()=>{
 for(const kind of ['missing','other']){const h=harness();try{const id=await saved(h);assert.equal((await h.ctrl.setAutoEnabled(true)).ok,true);if(kind==='missing')h.host.archives.delete(id);else{const a=structuredClone(h.host.archives.get(id));a.uuid='other';a.name=a.name.replace(/_[a-f0-9]{16}_r/,'_ffffffffffffffff_r');h.host.archives.set(a.uuid,a);}h.advance(75_000);h.storage.setItem('profile',good(33));const result=await h.ctrl.backup();assert.equal(result.code,kind==='missing'?'ACCOUNT_CHANGED':'CLOUD_CONFLICT');assert.equal(h.ctrl.getState().auto,false);assert.equal(h.storage.getItem('profile'),good(33));}finally{dispose(h);}}
 const h=harness();try{assert.equal((await h.ctrl.setAutoEnabled(true)).ok,false);}finally{dispose(h);}
});
test('retention keeps three verified own snapshots and never deletes another device or corrupt/unknown format',async()=>{
 const h=harness();try{const first=await saved(h),base=structuredClone(h.host.archives.get(first));const foreign={...base,uuid:'foreign',name:base.name.replace(/_[a-f0-9]{16}_r/,'_ffffffffffffffff_r')};h.host.archives.set('foreign',foreign);h.host.archives.set('unknown',{...base,uuid:'unknown',name:'player_unrelated_slot'});h.host.archives.set('corrupt',{...base,uuid:'corrupt',data:'{bad'});
 for(let i=0;i<4;i++){h.advance(75_000);h.storage.setItem('profile',good(20+i));await saved(h);}const own=[...h.host.archives.values()].filter(a=>!['foreign','unknown','corrupt'].includes(a.uuid));assert.equal(own.length,3);assert.deepEqual(own.map(a=>JSON.parse(a.data).revision).sort((a,b)=>a-b),[3,4,5]);for(const id of ['foreign','unknown','corrupt'])assert.ok(h.host.archives.has(id));}finally{dispose(h);}
});
test('quota failure preserves cloud history and local progress; nothing is pre-deleted to make space',async()=>{
 const h=harness();try{const id=await saved(h);h.advance(75_000);h.storage.setItem('profile',good(99));h.host.hooks.create=o=>o.fail({errno:400003});assert.equal((await h.ctrl.backup()).ok,false);assert.ok(h.host.archives.has(id));assert.equal(h.storage.getItem('profile'),good(99));assert.equal(h.host.calls.filter(x=>x==='delete').length,0);}finally{dispose(h);}
});
test('notifications coalesce dirty state and upload the latest raw bytes; boot never starts auto',async()=>{
 const h=harness();try{await saved(h);assert.equal((await h.ctrl.setAutoEnabled(true)).ok,true);h.storage.setItem('profile',good(21));h.ctrl.notifyLocalSaved();h.storage.setItem('profile',good(22));h.ctrl.notifyLocalSaved();assert.equal(h.host.archives.size,1);h.advance(75_000);const id=await saved(h);assert.equal(JSON.parse(h.host.archives.get(id).data).payload.profile,good(22));const boot=new CloudSaveController(h.config);assert.equal(boot.getState().auto,false);boot.destroy();}finally{dispose(h);}
});

test('unsaved in-memory changes since list are protected by the adapter revision token',async()=>{
 let revision=1;const h=harness({localRevision:()=>revision});try{const id=await saved(h);await select(h);revision++;assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'LOCAL_CHANGED');assert.equal(h.locks,0);assert.equal(h.storage.getItem('profile'),good(10));}finally{dispose(h);}
});

test('unchanged local saves do not generate repeated automatic uploads or SDK lists',async()=>{
 const h=harness();try{await saved(h);assert.equal((await h.ctrl.setAutoEnabled(true)).ok,true);const count=h.host.calls.length;for(let i=0;i<20;i++)h.ctrl.notifyLocalSaved();assert.equal(h.host.calls.length,count);assert.equal(h.host.archives.size,1);assert.equal(h.ctrl.getState().auto,true);}finally{dispose(h);}
});

test('duplicate list records cannot make retention count one UUID as several backups',async()=>{
 const h=harness();h.host.hooks.list=o=>o.success({saves:[...h.host.archives.values()].flatMap(a=>[a,a])});try{for(let i=0;i<5;i++){if(i)h.advance(75_000);h.storage.setItem('profile',good(i));await saved(h);}assert.equal(h.host.archives.size,3);assert.deepEqual([...h.host.archives.values()].map(a=>JSON.parse(a.data).revision).sort((a,b)=>a-b),[3,4,5]);}finally{dispose(h);}
});

test('a committed journal with newer current bytes blocks instead of rolling back another page progress',()=>{
 const storage=new Memory(),before={profile:good(1),run:null},after={profile:good(2),run:null};storage.setItem('profile',good(999));const text=JSON.stringify({format:'taptap-save-journal/1',appId:'123456',schema:1,phase:'committed',before,after});storage.setItem(cloudJournalKey('123456'),text);const result=recoverCloudJournal({appId:'123456',schema:1,keys,storage,validate});assert.equal(result.status,'blocked');assert.equal(result.code,'JOURNAL_COMMITTED_CHANGED');assert.equal(storage.getItem('profile'),good(999));assert.equal(storage.getItem(cloudJournalKey('123456')),text);
});
test('successful restore durably keeps corrupt/future original bytes and permits offline export after journal removal',async()=>{
 for(const original of ['{truncated-original',JSON.stringify({v:99,coins:987654})]){const h=harness();try{const id=await saved(h);h.storage.setItem('profile',original);await select(h);assert.equal((await h.ctrl.restore(id,{confirm:true})).ok,true);assert.equal(h.storage.getItem('profile'),good(10));assert.equal(hasCloudJournal(h.storage,'123456'),false);const data=JSON.parse(h.ctrl.exportLocalRecovery());assert.equal(JSON.parse(data.records[0].raw).payload.profile,original);assert.match(JSON.parse(data.records[0].raw).payloadSha256,/^[a-f0-9]{64}$/);const offline=new CloudSaveController({...h.config,runtime:()=>undefined,accountToken:()=>null,crypto:{}});assert.equal(offline.getState().localRecoveryCount,1);assert.equal(JSON.parse(JSON.parse(offline.exportLocalRecovery()).records[0].raw).payload.profile,original);offline.destroy();}finally{dispose(h);}}
});
test('before-restore record/index write failure cannot replace even one main key',async()=>{
 for(const indexFailure of [false,true]){const h=harness();try{const id=await saved(h);h.storage.setItem('profile',good(88));await select(h);h.storage.writeHook=key=>{if(indexFailure?key.endsWith(':before-restore-index'):key.includes(':before-restore:'))throw Error('local quota');};assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'LOCAL_BACKUP_WRITE');assert.equal(h.storage.getItem('profile'),good(88));assert.equal(h.storage.getItem('run'),null);assert.equal(h.reloads,0);assert.equal(h.locked,false);assert.equal(hasCloudJournal(h.storage,'123456'),false);}finally{dispose(h);}}
});
test('later restores append immutable local before copies instead of discarding the first original',async()=>{
 const h=harness();let second;try{const id=await saved(h);h.storage.setItem('profile',good(88));await select(h);assert.equal((await h.ctrl.restore(id,{confirm:true})).ok,true);const first=JSON.parse(h.ctrl.exportLocalRecovery()).records[0];dispose(h);second=new CloudSaveController(h.config);h.storage.setItem('profile',good(99));assert.equal((await second.listBackups()).ok,true);assert.equal((await second.restore(id,{confirm:true})).ok,true);const records=JSON.parse(second.exportLocalRecovery()).records;assert.equal(records.length,2);assert.equal(h.storage.getItem(first.id),first.raw);assert.deepEqual(records.map(x=>JSON.parse(x.raw).payload.profile).sort(),[good(88),good(99)].sort());}finally{second?.destroy();dispose(h);}
});
test('list snapshot revision is captured before its first SDK await, including unsaved changes during network latency',async()=>{
 let revision=1;const h=harness({localRevision:()=>revision});try{const id=await saved(h);let pending;h.host.hooks.list=o=>{pending=o;};const listed=h.ctrl.listBackups();for(let i=0;i<10&&!pending;i++)await new Promise(r=>setTimeout(r,1));revision++;pending.success({saves:[...h.host.archives.values()]});assert.equal((await listed).ok,true);delete h.host.hooks.list;assert.equal((await h.ctrl.restore(id,{confirm:true})).code,'LOCAL_CHANGED');assert.equal(h.locks,0);assert.equal(h.storage.getItem('profile'),good(10));}finally{dispose(h);}
});
test('archive name byte length is checked before file or cloud create',async()=>{
 const h=harness({appId:'a'.repeat(32)});try{assert.equal((await h.ctrl.backup()).code,'ARCHIVE_NAME_TOO_LONG');assert.equal(h.host.calls.filter(x=>x==='write'||x==='create').length,0);assert.equal(h.storage.getItem('profile'),good(10));}finally{dispose(h);}
});
test('failed local notification metadata stops auto and cancels its scheduled retry',async()=>{
 const h=harness();try{await saved(h);await h.ctrl.setAutoEnabled(true);h.storage.setItem('profile',good(21));h.ctrl.notifyLocalSaved();const calls=h.host.calls.length;h.storage.writeHook=key=>{if(key.endsWith(':meta'))throw Error('quota');};h.ctrl.notifyLocalSaved();assert.equal(h.ctrl.getState().auto,false);assert.equal(h.ctrl.getState().code,'LOCAL_WRITE');h.advance(75_000);h.ctrl.notifyLocalSaved();await new Promise(r=>setTimeout(r,2));assert.equal(h.host.calls.length,calls);}finally{dispose(h);}
});
test('SDK fail retains only allowlisted numeric errno and never errMsg or arbitrary fields',async()=>{
 const secret='fake-token-must-not-leak';for(const errno of [400003,42,'400003'])await assert.rejects(nativeCall(o=>o.fail({errno,errMsg:secret,token:secret}),{},20),e=>{assert.equal(e.code,'SDK_FAILURE');assert.equal(e.errno,errno===400003?400003:undefined);assert.equal(e.message,'SDK_FAILURE');assert.equal(JSON.stringify(e).includes(secret),false);return true;});
});

test('transient first journal read failure is LOCAL_READ while hasCloudJournal conservatively blocks writes',()=>{
 const storage=new Memory();storage.readError=true;assert.deepEqual(recoverCloudJournal({appId:'123456',schema:1,keys,storage,validate}),{status:'blocked',code:'LOCAL_READ'});assert.equal(hasCloudJournal(storage,'123456'),true);storage.readError=false;assert.deepEqual(recoverCloudJournal({appId:'123456',schema:1,keys,storage,validate}),{status:'none'});assert.equal(storage.getItem('profile'),good(10));
});

test('desktop creation requires callback and classifies user choice without affecting saves', async()=>{
 assert.equal(await createDesktopShortcut(undefined,1),'unavailable');
 assert.equal(await createDesktopShortcut({createHomeScreenWidget:o=>{o.success();o.fail({errno:1518003});}},1),'added');
 assert.equal(await createDesktopShortcut({createHomeScreenWidget:o=>o.fail({errno:1518002})},1),'already-added');
 assert.equal(await createDesktopShortcut({createHomeScreenWidget:o=>o.fail({errno:1518003})},1),'cancelled');
 assert.equal(await createDesktopShortcut({createHomeScreenWidget:()=>Promise.resolve()},1),'timeout');
 assert.equal(await createDesktopShortcut({createHomeScreenWidget:()=>{throw Error('bridge');}},1),'failed');
});
