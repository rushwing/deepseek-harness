import {liveConfig,pluginSettings} from '../../settings-compat.mjs'
import Schema from '@deepseek-ai/schemastery'
export const name = 'dsh-startup-appearance'
export const inject = ['settings']
export const Config = liveConfig(Schema.object({enabled: Schema.boolean().default(true)}))
export function apply(ctx, config = {}) {
  pluginSettings(ctx,'startup-appearance', Config, {base: config, applies: 'live'})
}
