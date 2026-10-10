export function bindSettings(ctx: any, namespace: string): {
  getSnapshot(): any
  subscribe(callback: () => void): () => void
  set(key: string, value: unknown): Promise<void>
  mutate(ops: readonly unknown[], revision?: number): Promise<void>
}
export function settingsPage(ctx: any, namespace: string, label: string, order: number, component: any): unknown
