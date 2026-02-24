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

/** Какие метрики мониторинга показывать в карточках модулей (localStorage). */
export type MonitorVisibleSettings = {
  cpu: boolean
  memory: boolean
  memory_mb: boolean
  disk_percent: boolean
  disk_gb: boolean
  uptime: boolean
  process_count: boolean
  download_speed: boolean
  upload_speed: boolean
  total_download: boolean
  total_upload: boolean
}

export const DEFAULT_MONITOR_VISIBLE: MonitorVisibleSettings = {
  cpu: true,
  memory: true,
  memory_mb: true,
  disk_percent: true,
  disk_gb: true,
  uptime: true,
  process_count: false,
  download_speed: true,
  upload_speed: true,
  total_download: true,
  total_upload: true,
}

/** Пресет: CPU + память (для мониторинга Eye). */
export const PRESET_STANDARD: MonitorVisibleSettings = {
  ...DEFAULT_MONITOR_VISIBLE,
  cpu: true,
  memory: true,
  memory_mb: true,
  disk_percent: false,
  disk_gb: false,
  uptime: false,
  process_count: false,
  download_speed: false,
  upload_speed: false,
  total_download: false,
  total_upload: false,
}

/** Пресет: стандарт + диск, аптайм, процессы. */
export const PRESET_EXTENDED: MonitorVisibleSettings = {
  ...DEFAULT_MONITOR_VISIBLE,
  cpu: true,
  memory: true,
  memory_mb: true,
  disk_percent: true,
  disk_gb: true,
  uptime: true,
  process_count: true,
  download_speed: false,
  upload_speed: false,
  total_download: false,
  total_upload: false,
}

/** Пресет: только сетевые метрики (для модуля Net). */
export const PRESET_NETWORK: MonitorVisibleSettings = {
  ...DEFAULT_MONITOR_VISIBLE,
  cpu: false,
  memory: false,
  memory_mb: false,
  disk_percent: false,
  disk_gb: false,
  uptime: false,
  process_count: false,
  download_speed: true,
  upload_speed: true,
  total_download: true,
  total_upload: true,
}
