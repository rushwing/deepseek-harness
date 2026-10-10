import test from 'node:test'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {readFileSync} from 'node:fs'
import {liveConfig,pluginSettings} from '../android-shell/plugins/settings-compat.mjs'

const engine = process.env.DSH_SETTINGS_ENGINE
if (!engine) throw Error('DSH_SETTINGS_ENGINE must point at the source-built canonical @deepseek-ai packages')
const load = name => {
  const pkg=JSON.parse(readFileSync(resolve(engine,name,'package.json'),'utf8'))
  return import(pathToFileURL(resolve(engine,name,pkg.module ?? pkg.main)).href)
}
const {Context} = await load('cordis')
const {default:Schema} = await load('schemastery')
const {createVolatile,updateVolatile} = await load('cosmokit')

test('master Config references update in place and dispose settings watchers and validators',async()=>{
  const ctx = new Context()
  let policies=0,scope,owner,busy=false,changes=[]
  ctx.provide('settings',{configure(){policies++;return()=>policies--}})
  const Config=liveConfig(Schema.object({enabled:Schema.boolean().default(true)}))
  const plugin={inject:['settings'],Config,apply(child,config){
    owner=child
    scope=pluginSettings(child,'fixture',Config,{base:config,validate:value=>{
      if(!value.enabled&&busy)throw Error('busy')
    }})
    child.effect(()=>scope.watch(value=>changes.push(value.enabled)))
  }}
  let fiber=ctx.plugin(plugin);await fiber
  assert.equal(policies,1)
  assert.deepEqual(scope.get(),{enabled:true})
  const ref=fiber.config.enabled
  busy=true
  assert.match(Config['~standard'].validate({enabled:false}).issues[0].message,/busy/)
  assert.equal(ref.get(),true)
  busy=false
  const candidate=Config['~standard'].validate({enabled:false}).value
  updateVolatile(ref,candidate.enabled)
  owner.emit('loader/volatile-update',[['enabled']])
  assert.equal(fiber.config.enabled,ref)
  assert.deepEqual(scope.get(),{enabled:false})
  assert.deepEqual(changes,[false])
  await fiber.dispose()
  assert.equal(policies,0)
  assert.equal(Config.liveValidators.size,0)
  fiber=ctx.plugin(plugin,{enabled:false});await fiber
  assert.deepEqual(scope.get(),{enabled:false})
  assert.equal(policies,1)
  await fiber.dispose()
  assert.equal(policies,0)
})

test('volatile arrays remain single values and validation sees plain data',()=>{
  const Config=liveConfig(Schema.object({services:Schema.array(Schema.object({id:Schema.string()})).default([])}),value=>{
    if(value.services.length>1)throw Error('too many')
  })
  const first=Config['~standard'].validate({services:[{id:'a'}]})
  assert.deepEqual(first.value.services.get(),[{id:'a'}])
  assert.ok(Config['~standard'].validate({services:[{id:'a'},{id:'b'}]}).issues)
  assert.equal(Config.dict.services.meta.volatile,true)
  assert.equal(Config.dict.services.inner.dict.id.meta.volatile,undefined)
})
