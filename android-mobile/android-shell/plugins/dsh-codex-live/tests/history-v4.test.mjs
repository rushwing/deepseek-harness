import test from 'node:test'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {projectTranscripts} from '../src/history.mjs'

test('v4 Live transcripts survive restore without duplicate messages', {
 skip:!process.env.DSH_V4_SESSION_MODULE,
},async()=>{
 const {Session,SessionId,SESSION_FORMAT_VERSION}=await import(pathToFileURL(process.env.DSH_V4_SESSION_MODULE).href)
 assert.equal(SESSION_FORMAT_VERSION,4)
 const id=SessionId('session-live-v4-test'),session=Session.create(id)
 const records=[
  {id:'gpt-live:thread:user',role:'user',text:'hello'},
  {id:'gpt-live:thread:assistant',role:'assistant',text:'hello back'},
 ]
 assert.equal(projectTranscripts(session,records).projectedMessages,2)
 const seed=session.snapshotEvents()
 const head=seed.find(event=>event.type==='system/message')
 assert.deepEqual(head.data.message.source,{kind:'system-prompt'})
 assert.deepEqual(head.data.message.content,[])
 const restored=Session.create(id,seed,session.header)
 assert.deepEqual(restored.deriveMessages(),session.deriveMessages())
 const restoredSeed=restored.snapshotEvents()
 assert.deepEqual(restoredSeed.slice(0,seed.length),seed)
 assert.equal(projectTranscripts(restored,records).projectedMessages,0)
 assert.deepEqual(restored.snapshotEvents(),restoredSeed)
})
