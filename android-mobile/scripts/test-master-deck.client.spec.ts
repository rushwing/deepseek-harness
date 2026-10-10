// @vitest-environment jsdom
/** Run inside the fixed Harness workspace's Vitest configuration (see integration docs). */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import * as cordis from '@deepseek-ai/cordis'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as store from '@deepseek-ai/dsh-client-store'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as jsx from 'react/jsx-runtime'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { ClientRoster, createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
// This template is copied into api/session-controller/tests for execution.
import { FOLLOW, followScript } from './remote/session.client.ts'

const root = process.env.DSH_ANDROID_ROOT
if (!root) throw Error('Set DSH_ANDROID_ROOT to the Android repository')
const patchDir = resolve(root, '.local/upstream-master-migration/deck-patches')
const dependencies: Record<string, unknown> = {
  '@deepseek-ai/cordis': cordis,
  '@deepseek-ai/dsh-api-gateway/client': gateway,
  '@deepseek-ai/dsh-client-store': store,
  '@deepseek-ai/dsh-client-ui-slots': slots,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
  react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react/jsx-runtime': jsx,
}
function bundle(path: string): any {
  const windowWithLoader = window as unknown as { __ModuleLoader__?: { load(value: any): void } }
  const previous = windowWithLoader.__ModuleLoader__
  let result: unknown
  windowWithLoader.__ModuleLoader__ = { load: value => {
    result = value.factory((name: string) => {
      if (!(name in dependencies)) throw Error('Unmapped client dependency: ' + name)
      return dependencies[name]
    })
  } }
  try { new Function(readFileSync(path, 'utf8'))() }
  finally { windowWithLoader.__ModuleLoader__ = previous }
  return result
}
const names = ['dsh-api-session-controller', 'dsh-client-ui-session', 'dsh-client-ui-renderer',
  'dsh-client-ui-conversation', 'dsh-client-ui-workspace']
const provide = Object.fromEntries(names.map(name => ['@deepseek-ai/' + name, bundle(resolve(patchDir, name + '.js'))]))
dependencies['@deepseek-ai/dsh-client-ui-renderer'] = provide['@deepseek-ai/dsh-client-ui-renderer']
const deckName = '@deepseek-ai/dsh-client-ui-voice-deck'
provide[deckName] = bundle(resolve(root, 'android-shell/plugins/dsh-client-ui-voice-deck/lib/client.js'))
const base = webApp.closure(names.map(name => '@deepseek-ai/' + name))
const roster = ClientRoster.of([...base.rows, {name: deckName, inject: names.map(name => '@deepseek-ai/' + name), immediately: false}])
const it = createClientTest({roster, provide}, {mount: true})

it('renders two retained lanes, isolates drafts and releases references when unloaded', async ({mock, start}) => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({matches:false, addEventListener(){}, removeEventListener(){}}))
  HTMLElement.prototype.scrollIntoView = () => {}
  localStorage.setItem('dsh.voice-deck.controller.v2', JSON.stringify({enabled:true, lanes:['first','second',null,null],active:0}))
  mock.remote.session.list.mockResolvedValue(ok({items:['first','second'].map(sessionId => ({sessionId,updatedAt:1,running:false,blank:true,agentAvailable:true}))}))
  mock.stream(FOLLOW, followScript(ok({records:[],hasMore:false})))
  const client = await start()
  const ctx = client.ctx as any
  await act(async () => {ctx.sessions.open('first')})
  await waitFor(() => expect(ctx.sessions.scope('first')).toBeDefined())
  await act(async () => {
    const entry = ctx.slots.entries('conversation.session')[0]
    const binding = ctx.uiSession.adapter.resolve('first')
    ctx.slots.resolveStore(entry.store,binding).actions.setView('voice-deck')
  })
  await waitFor(() => expect(client.container?.querySelectorAll('[data-deck-lane]').length).toBe(2))
  expect(ctx.sessions.retainInfo('first').getSnapshot().retainedBy.androidWorkbench).toBe(1)
  expect(ctx.sessions.retainInfo('second').getSnapshot().retainedBy.androidWorkbench).toBe(1)
  const first = ctx.conversation.input.for(ctx.sessions.scope('first'))
  const second = ctx.conversation.input.for(ctx.sessions.scope('second'))
  await act(async () => {first.actions.setDraft('first draft'); second.actions.setDraft('second draft')})
  expect(first.state.getSnapshot().draft).toBe('first draft')
  expect(second.state.getSnapshot().draft).toBe('second draft')
  await act(async () => {
    await client.unload(deckName)
  })
  await waitFor(() => expect(ctx.sessions.retainInfo('second').getSnapshot().referenceCount).toBe(0))
  expect(ctx.sessions.retainInfo('first').getSnapshot().retainedBy.androidWorkbench).toBeUndefined()
  expect(localStorage.getItem('dsh.conversation.first')).not.toBeNull()
})
