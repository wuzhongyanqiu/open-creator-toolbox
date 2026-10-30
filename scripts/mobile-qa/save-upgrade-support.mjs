import { setTimeout as delay } from 'node:timers/promises';

async function bounded(operation, timeoutMs) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error('cleanup deadline')),timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
const exited = child => !!child && (child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined);
async function confirmExit(child, timeoutMs) {
  const deadline=Date.now()+timeoutMs;
  while(!exited(child)&&Date.now()<deadline)await delay(Math.min(25,Math.max(1,deadline-Date.now())));
  return exited(child);
}
/** Operates only on this invocation's launchServer and its captured child PID. */
export async function closeOwnedBrowser(browser, server, {timeoutMs=20_000,ownedPid}={}) {
  const evidence={timeoutMs,connection:'not-created',method:'not-started',confirmed:!server,ownedPid:ownedPid??null};
  if(browser){try{await bounded(()=>browser.close(),timeoutMs);evidence.connection='closed';}catch{evidence.connection='close-timeout-or-error';}}
  if(!server)return {evidence,failures:[]};
  let child;try{child=server.process?.();}catch{ /* Ownership must be observable before closing/killing a server. */ }
  const owned=Number.isInteger(ownedPid)&&ownedPid>0&&child?.pid===ownedPid;
  if(!owned){evidence.method='ownership-unconfirmed';return{evidence,failures:['Owned browser exit could not be confirmed']};}
  try{await bounded(()=>server.close(),timeoutMs);evidence.method='graceful';}catch{evidence.method='graceful-timeout-or-error';}
  if(await confirmExit(child,Math.min(timeoutMs,1000))){evidence.confirmed=true;return{evidence,failures:[]};}
  if(owned){
    try{await bounded(()=>server.kill(),timeoutMs);evidence.method='owned-server-kill';}catch{evidence.method='owned-server-kill-timeout-or-error';}
    if(await confirmExit(child,Math.min(timeoutMs,1000))){evidence.confirmed=true;return{evidence,failures:[]};}
    // Never use process.kill, broad process matching, or another browser's PID.
    try{child.kill('SIGKILL');evidence.method='owned-child-sigkill';}catch{evidence.method='owned-child-sigkill-error';}
    evidence.confirmed=await confirmExit(child,Math.min(timeoutMs,5000));
  }
  return {evidence,failures:evidence.confirmed?[]:['Owned browser exit could not be confirmed']};
}

export function validateOldNetworkExceptions(value=[]) {
  if(!Array.isArray(value)||value.length>5)throw new Error('oldSeedNetworkExceptions must be a small exact allowlist.');
  const seen=new Set();
  return value.map(e=>{
    if(!e||typeof e!=='object'||Object.keys(e).some(k=>!['oldBuildSha256','path','status','maxCount','reason'].includes(k))||!/^[a-f0-9]{64}$/.test(e.oldBuildSha256)||typeof e.path!=='string'||!/^\/[a-zA-Z0-9_./-]+$/.test(e.path)||e.path.includes('//')||e.path.split('/').includes('..')||e.status!==404||!Number.isInteger(e.maxCount)||e.maxCount<1||e.maxCount>10||typeof e.reason!=='string'||!e.reason.trim())throw new Error('Old network exceptions require an exact old tree SHA256, path, 404, bounded maxCount and reason.');
    const key=`${e.oldBuildSha256}|${e.path}|${e.status}`;if(seen.has(key))throw new Error('Duplicate old network exception.');seen.add(key);return{...e};
  });
}
/** Candidate/external failures are never eligible, even for a declared path. */
export function createOldNetworkPolicy(entries, {oldBuildSha256,origin}) {
  const rules=validateOldNetworkExceptions(entries),responseCounts=new Map(),consoleCounts=new Map();
  const match=(url,status,phase)=>{
    if(!['old-navigation','old-seed'].includes(phase))return -1;
    let parsed;try{parsed=new URL(url);}catch{return -1;}
    if(parsed.origin!==origin||parsed.search||parsed.hash)return -1;
    return rules.findIndex(r=>r.oldBuildSha256===oldBuildSha256&&r.path===parsed.pathname&&r.status===status);
  };
  return {
    allowResponse(url,status,phase){const i=match(url,status,phase);if(i<0)return false;const n=(responseCounts.get(i)??0)+1;responseCounts.set(i,n);return n<=rules[i].maxCount;},
    allowConsole({url,text,phase}){
      if(!/^Failed to load resource: the server responded with a status of 404(?:\b|\s|\()/.test(text))return false;
      const i=match(url,404,phase);if(i<0)return false;const n=(consoleCounts.get(i)??0)+1;consoleCounts.set(i,n);return n<=Math.min(responseCounts.get(i)??0,rules[i].maxCount);
    },
    evidence(hash){return rules.map((r,i)=>({oldBuildSha256:r.oldBuildSha256,pathSha256:hash(r.path),status:r.status,maxCount:r.maxCount,reasonSha256:hash(r.reason),observedResponses:responseCounts.get(i)??0,ignoredConsoleMessages:Math.min(consoleCounts.get(i)??0,responseCounts.get(i)??0,r.maxCount)}));},
  };
}
