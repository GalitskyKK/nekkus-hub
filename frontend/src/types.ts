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

const STORAGE_KEY_BY_MODULE = "hub_monitor_visible_by_module";

export function loadMonitorVisibleByModule(): Record<string, MonitorVisibleSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BY_MODULE);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, MonitorVisibleSettings>;
  } catch {
    return {};
  }
}

export function saveMonitorVisibleByModule(
  byModule: Record<string, MonitorVisibleSettings>,
): void {
  try {
    localStorage.setItem(STORAGE_KEY_BY_MODULE, JSON.stringify(byModule));
  } catch {
    // ignore
  }
}

export function getModuleVisible(
  moduleId: string,
  byModule: Record<string, MonitorVisibleSettings>,
): MonitorVisibleSettings {
  return byModule[moduleId] ?? DEFAULT_MONITOR_VISIBLE;
}
