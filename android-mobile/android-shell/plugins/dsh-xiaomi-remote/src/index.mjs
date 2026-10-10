import {liveConfig,pluginSettings} from '../../settings-compat.mjs'
import Schema from '@deepseek-ai/schemastery'
export const name='dsh-xiaomi-remote'
export const inject=['settings']
const action=()=>Schema.union(['record','delete','send','none'])
export const Config=liveConfig(Schema.object({enabled:Schema.boolean().default(false),device:Schema.string().default(''),
 voiceKey:Schema.number().default(135),voiceAction:action().default('record'),
 backKey:Schema.number().default(4),backAction:action().default('delete'),
 confirmKey:Schema.number().default(66),confirmAction:action().default('send')}))
export function apply(ctx,config={}){pluginSettings(ctx,'xiaomi-remote',Config,{base:config,applies:'live'})}
