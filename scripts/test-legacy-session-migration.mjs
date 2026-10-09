/** Use the exact staged engine, including its current-format reader and Session. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectTranscripts} from '../android-shell/plugins/dsh-codex-live/src/history.mjs';
const root=process.env.DSH_MIGRATION_ENGINE;
if(!root)throw Error('Set DSH_MIGRATION_ENGINE to staged @deepseek-ai package directory');
const load=async n=>import(pathToFileURL(resolve(root,n,'lib/index.js')));
const catalog=await load('dsh-session-format-catalog');
// These fixtures have no children; supply that fact explicitly on V4.
const c=catalog.createSessionFormatCatalogWithChildren?.([])??catalog.sessionFormatCatalog;
const {Session,SessionId,SessionLogOffset,SESSION_FORMAT_VERSION}=await load('dsh-session');
const {freezeMessage}=await load('dsh-llm');
const header={type:'session',version:0,id:'session-migration-fixture',createdAt:1,cwd:'/work',delegationDepth:0,agentPreset:'standard'};
const liveId='gpt-live:00000000-0000-0000-0000-000000000001:00000000-0000-0000-0000-000000000002';
const user=(id=liveId)=>({id,role:'user',source:{kind:'user'},content:[{type:'text',text:'fixture request'}]});
const msg=(content,id='reply')=>({id,role:'assistant',source:{kind:'model',provider:'relay-codex',model:'fixture'},content});
function rows(entries){return entries.map(([type,data,extra={}],seq)=>({type,data,seq,time:seq+1,...(['user/message','assistant/message','tool/result'].includes(type)?{surfaceOp:'append'}:{}),...extra}));}
function restore(events,h=header){const r=c.createRestore(h,{validation:'current'});for(const e of events)r.decodeRow(e);return r.finish();}
function reopen(out){return restore(out.events.map(e=>c.encodeCurrentEvent(e)),c.encodeCurrentHeader(out.header,out.inheritedEventCount));}
const live=()=>rows([
 ['model/selection',{provider:'relay-codex',model:'fixture'}],
 ['turn/start',{turn:1}],['user/message',user()],['turn/end',{turn:1,reason:{kind:'completed'}}],
 ['turn/start',{turn:2}],['step/start',{turn:2,step:1}],
 ['assistant/message',{turn:2,step:1,message:msg([{type:'text',text:'reply'}])}],
 ['step/end',{turn:2,step:1}],['turn/end',{turn:2,reason:{kind:'completed'}}],
]);
test('legacy Live keeps messages and chronology; format frame is empty, marked and reopenable',()=>{
 const input=live(),out=reopen(restore(input));
 for(const type of ['user/message','assistant/message','turn/start','turn/end'])assert.deepEqual(out.events.filter(e=>e.type===type).map(e=>({time:e.time,data:{...e.data,...(e.type==='assistant/message'?{stream:undefined}:{})}})),input.filter(e=>e.type===type).map(e=>({time:e.time,data:{...e.data,...(e.type==='assistant/message'?{stream:undefined}:{})}})));
 const head=out.events.find(e=>e.type==='system/message');assert.deepEqual(head.data.message.content,[]);
 assert.deepEqual(head.data.message.source,SESSION_FORMAT_VERSION>=4?{kind:'system-prompt',producer:'deepcode-legacy-live-migration'}:{kind:'plugin',plugin:'deepcode-legacy-live-migration'});
 assert.equal(out.events.filter(e=>e.type==='step/start').length,2);
});
for(const [name,mutate] of [
 ['ordinary user',es=>{es[2].data.id='ordinary'}],
 ['other provider',es=>{es[0].data.provider='other'}],
 ['incomplete turn',es=>es.splice(3)],
 ['wrong closing turn',es=>{es[3].data.turn=2}],
 ['interleaved event',es=>{es[3]={...es[3],type:'session/title',data:{title:'x',messageSeqs:[],source:{kind:'fallback'}}}}],
])test('refuses '+name,()=>{const es=live();mutate(es);assert.throws(()=>restore(es));});
function activityRows(){return rows([
 ['turn/start',{turn:1}],['step/start',{turn:1,step:1}],
 ['assistant/chunk',{turn:1,step:1,chunk:{type:'block-start',index:0,blockType:'text'}}],
 ['assistant/chunk',{turn:1,step:1,chunk:{type:'text-delta',index:0,text:'hello'}}],
 ['assistant/message',{turn:1,step:1,message:msg([{type:'tool-call',id:'relay-codex:fixture',name:'relay_codex_activity',arguments:'{}'}],'activity')}],
 ['tool/call',{turn:1,step:1,callId:'relay-codex:fixture',name:'relay_codex_activity',arguments:'{}'}],
 ['tool/result',{turn:1,step:1,message:{id:'result',role:'user',source:{kind:'tool',callId:'relay-codex:fixture'},content:[{type:'tool-result',toolCallId:'relay-codex:fixture',isError:false,content:[{type:'text',text:'done'}]}]}}],
 ['assistant/chunk',{turn:1,step:1,chunk:{type:'block-end',index:0,block:{type:'text',text:'hello'}}}],
 ['assistant/chunk',{turn:1,step:1,chunk:{type:'finish',reason:{kind:'stop'}}}],
 ['assistant/message',{turn:1,step:1,message:msg([{type:'text',text:'hello'}])},{sourceEventSeqs:[2,3,7,8]}],
 ['step/end',{turn:1,step:1}],['turn/end',{turn:1,reason:{kind:'completed'}}]
]);}
test('activity stays independent while original stream settles once',()=>{
 const out=reopen(restore(activityRows())),ms=out.events.filter(e=>e.type==='assistant/message');assert.equal(ms.length,2);assert.deepEqual(ms[0].data.stream,[]);assert.ok(ms[1].data.stream.length);assert.equal(out.events.filter(e=>e.type==='assistant/attempt').length,0);
});
for(const [name,mutate] of [
 ['different tool',es=>{es[4].data.message.content[0].name='other'}],
 ['different provider activity',es=>{es[4].data.message.source.provider='other'}],
 ['incomplete chunk provenance',es=>{es[9].sourceEventSeqs=[2,3,7]}],
 ['ordinary text during stream',es=>{es[4].data.message.content=[{type:'text',text:'unexpected'}]}],
])test('rejects '+name,()=>{const es=activityRows();mutate(es);assert.throws(()=>restore(es));});
function newSession(){const h=c.readHeader(header).header;return Session.fromRestore(SessionId(header.id),[],h,SessionLogOffset(0),'detached');}
function validateSession(s){const out={header:s.header,events:s.snapshotEvents(),inheritedEventCount:0};return reopen(out);}
for(const role of ['user','assistant'])test('native Live '+role+' first survives current reader and replay',()=>{
 const s=newSession(),records=[{id:liveId,role,text:'fixture'},{id:liveId+'-next',role:role==='user'?'assistant':'user',text:'next'}];
 assert.equal(projectTranscripts(s,records).projectedMessages,2);validateSession(s);assert.equal(projectTranscripts(s,records).projectedMessages,0);validateSession(s);
});
const host=readFileSync('android-shell/vendor/relay-dsh-plugin-codex/lib/host-plugin.js','utf8');
const compat=readFileSync('android-shell/vendor/relay-dsh-plugin-codex/dsh-compat.mjs','utf8');
const currentMessage=vm.runInNewContext(compat.slice(compat.indexOf('export function currentMessage('),compat.indexOf('// Keep namespace access:')).replace('export function','function')+';currentMessage');
const project=vm.runInNewContext(host.slice(host.indexOf('function appendProjectedTurn('),host.indexOf('function projectionMessageIds('))+';appendProjectedTurn',{MessageId:id=>id,toolCallId:id=>id,freezeMessage:m=>freezeMessage(currentMessage(m,SESSION_FORMAT_VERSION)),CODEX_PROVIDER:'relay-codex',SESSION_FORMAT_VERSION});
test('Codex imported user-first history has a valid protected system head',()=>{
 const s=newSession();project((type,data,surfaceOp)=>s.append(type,data,surfaceOp?{surfaceOp}:undefined),{timeline:[{kind:'message',role:'user',id:'u',text:'question'},{kind:'message',role:'assistant',id:'a',text:'answer'}],endReason:{kind:'completed'}},1,true);validateSession(s);
});
test('Codex imported activity preserves tool identity, content, errors and replay',()=>{
 const s=newSession();
 project((type,data,surfaceOp)=>s.append(type,data,surfaceOp?{surfaceOp}:undefined),{timeline:[
  {kind:'activity',requestId:'request',resultId:'result',callId:'call',toolName:'relay_codex_activity',arguments:'{}',resultContent:[{type:'text',text:'command output'}],isError:true}
 ],endReason:{kind:'completed'}},1,true);
 const out=validateSession(s),message=out.events.find(e=>e.type==='tool/result').data.message;
 assert.equal(message.source.callId,'call');
 if(SESSION_FORMAT_VERSION>=4){assert.equal(message.role,'tool');assert.equal(message.toolCallId,'call');assert.equal(message.isError,true);assert.equal(message.content[0].text,'command output');}
 else {assert.equal(message.role,'user');assert.equal(message.content[0].toolCallId,'call');}
 assert.equal(JSON.stringify(reopen(out).events),JSON.stringify(out.events));
});
if(SESSION_FORMAT_VERSION>=4){
 const v3Head=plugin=>rows([
  ['turn/start',{turn:1}],['step/start',{turn:1,step:1}],
  ['system/message',{turn:1,step:1,message:{id:'saved-empty-head',role:'system',source:{kind:'plugin',plugin},content:[]}},{surfaceOp:'append'}],
  ['step/end',{turn:1,step:1}],['user/message',user('saved-user')],['turn/end',{turn:1,reason:{kind:'completed'}}]
 ]);
 for(const plugin of ['deepcode-legacy-live-migration','@dsh-android/dsh-codex-live','relay-dsh-plugin-codex'])test('saved V3 '+plugin+' head migrates without changing history',()=>{
  const input=v3Head(plugin),before=JSON.stringify(input),out=reopen(restore(input,{...header,version:3,isSeeded:false}));
  assert.equal(JSON.stringify(input),before);
  const head=out.events.find(e=>e.type==='system/message');
  assert.equal(head.time,input[2].time);assert.equal(head.data.message.id,'saved-empty-head');
  assert.deepEqual(head.data.message.content,[]);assert.deepEqual(head.data.message.source,{kind:'system-prompt',producer:plugin});
  const actual=out.events.find(e=>e.type==='user/message');assert.deepEqual(actual.data,input[4].data);assert.equal(actual.time,input[4].time);
 });
 for(const [name,mutate] of [
  ['unknown producer',es=>{es[2].data.message.source.plugin='unknown-producer'}],
  ['nonempty Android head',es=>{es[2].data.message.content=[{type:'text',text:'unexpected prompt'}]}]
 ])test('V3 head migration refuses '+name,()=>{const input=v3Head('relay-dsh-plugin-codex');mutate(input);assert.throws(()=>restore(input,{...header,version:3,isSeeded:false}));});
}
