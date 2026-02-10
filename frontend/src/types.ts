export type WidgetConfig = {
  type?: string
  component?: string
  height?: number
  update_interval?: string
  supports_resize?: boolean
}

export type ModuleManifest = {
  id: string
  name?: string
  description?: string
  version?: string
  grpc_addr?: string
  widget?: WidgetConfig
}

export type ModuleSummary = {
  manifest: ModuleManifest
  widget_type?: string
  payload?: unknown
  error?: string
  running?: boolean
}
