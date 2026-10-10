import {createElement} from 'react'

export function bindSettings(ctx, namespace) {
  if (ctx.configForms) {
    const form = ctx.configForms.get(namespace)
    return {
      getSnapshot:()=>form.getSnapshot(), subscribe:callback=>form.subscribe(callback),
      async set(key,value) {
        if (!await form.set(key,value)) throw Error('设置未保存，请刷新后重试')
      },
      async mutate(ops,revision) {
        if (!await form.mutate(ops,revision)) throw Error('设置已变化，请刷新后重试')
      },
    }
  }
  return ctx.settingsScope.bind({namespace})
}

export function settingsPage(ctx, namespace, label, order, Component) {
  const current = !!ctx.configForms
  const name = current ? 'plugins.item' : 'settings.plugin.item'
  return ctx.slots.inject(name,()=>ctx.slots.register(current
    ? {name,id:namespace,label:()=>label,order}
    : {name,key:namespace,order},
  props=>current && props?.view==='summary' ? label : createElement(Component,props)))
}
