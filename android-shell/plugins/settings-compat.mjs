// Shared adapter for the legacy namespace API and Harness profile Config forms.
// Each plugin keeps its own schema, validators and lifecycle; no host service is replaced.
export function plainConfig(value) {
  if (value && typeof value.get === 'function') return plainConfig(value.get())
  if (Array.isArray(value)) return value.map(plainConfig)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plainConfig(v)]))
  return value
}

export function liveConfig(schema, validate) {
  for (const [key, field] of Object.entries(schema.dict ?? {})) schema.dict[key] = field.extra('volatile', true)
  const standard = schema['~standard']
  const validators = new Set(validate ? [validate] : [])
  Object.defineProperty(schema, 'liveValidators', {value: validators})
  Object.defineProperty(schema, '~standard', {value: {...standard, validate(raw) {
    const result = standard.validate(raw)
    if (result.issues) return result
    try { for (const check of validators) check(plainConfig(result.value)) }
    catch (error) { return {issues:[{message:error.message}]} }
    return result
  }}})
  return schema
}

export function pluginSettings(ctx, namespace, schema, options = {}) {
  if (typeof ctx.settings.register === 'function') return ctx.settings.register(namespace, schema, options)
  if (typeof ctx.settings.configure !== 'function') throw Error('Unsupported Harness settings service')
  // Profile entry ids are the new namespace ids; the Loader owns Config refs.
  const get = () => plainConfig(ctx.fiber.config)
  if (options.validate) {
    schema.liveValidators.add(options.validate)
    ctx.effect(()=>()=>schema.liveValidators.delete(options.validate), 'plugin settings validation')
    options.validate(get())
  }
  ctx.effect(()=>ctx.settings.configure({auto:false}), 'plugin settings presentation')
  return {get, watch(callback) {return ctx.on('loader/volatile-update', ()=>callback(get()))}}
}
