import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'

test('Termux commands preserve environment, failure status and sandbox facts', {
 skip:process.platform!=='linux',
},async()=>{
 const modulePath=process.env.DSH_TERMUX_MODULE??fileURLToPath(new URL('../lib/index.js',import.meta.url))
 const require=createRequire(modulePath)
 const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
 const {default:Subprocess}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-subprocess-local')).href)
 const {TermuxBashExecutor}=await import(pathToFileURL(modulePath).href)
 const ctx=new Context()
 let subprocessFiber,shellFiber
 try{
  subprocessFiber=await ctx.plugin(Subprocess)
  shellFiber=await ctx.plugin(TermuxBashExecutor,{
   bashPath:'/bin/bash',prefix:'/usr',home:'/tmp',extraPath:['/usr/bin','/bin'],
   writeMode:'workspace-write',workspaceRoot:'/tmp',sharedDirs:[],graceMs:200,
  })
  const shell=ctx.shell
  const spec=shell.resolve({command:'printf "%s:%s:%s" "$PREFIX" "$HOME" "$DSH_WRITE_MODE"; printf error >&2; exit 7'})
  let result
  if(typeof Reflect.get(Object.getPrototypeOf(TermuxBashExecutor.prototype),'executeArgv')==='function'){
   const process=await shell.execute(spec)
   assert.equal(process.sandbox.enforcement,'partial')
   const first=process.result()
   assert.equal(process.result(),first)
   result=await first
   await process.done
  }else result=await shell.run(spec)
  assert.equal(result.exitCode,7)
  assert.equal(result.stdout.text,'/usr:/tmp:workspace-write')
  assert.equal(result.stderr.text,'error')
  assert.deepEqual(result.sandbox,{mode:'workspace-write',denied:false,enforcement:'partial'})
 }finally{await shellFiber?.dispose();await subprocessFiber?.dispose()}
})
