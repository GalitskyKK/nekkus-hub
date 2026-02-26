import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AddModulePlaceholder,
  AppShell,
  Button,
  DataText,
  EmptyState,
  HeaderStat,
  ModuleCard,
  ModuleCardGrid,
  PageLayout,
  Pill,
  ProgressBar,
  Section,
  StatusDot,
} from "@nekkus/ui-kit";
import {
  addModule,
  fetchSummary,
  netConnect,
  netDisconnect,
  openModuleUI,
  rescanModules,
  startModule,
  stopModule,
} from "./api";
import type { ModuleCardSize, ModuleSummary, MonitorVisibleSettings } from "./types";
import {
  DEFAULT_MONITOR_VISIBLE,
  getModuleVisible,
  loadMonitorVisibleByModule,
  loadModuleOrder,
  loadModuleSizes,
  PRESET_EXTENDED,
  PRESET_NETWORK,
  PRESET_STANDARD,
  saveMonitorVisibleByModule,
  saveModuleOrder,
  saveModuleSizes,
} from "./types";

/** Payload от Net /api/status для виджета в Hub */
type NetStatusPayload = {
  connected?: boolean;
  server?: string;
  servers?: string[];
  downloadSpeed?: number;
  uploadSpeed?: number;
  totalDownload?: number;
  totalUpload?: number;
};

/** Элемент top_processes от Eye */
type EyeTopProcess = { name?: string; cpu_percent?: number };

/** Payload от Eye /api/stats для виджета в Hub */
type EyeStatsPayload = {
  cpu_percent?: number;
  cpu_temp_c?: number;
  cpu_mhz?: number;
  memory_percent?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  gpu_percent?: number;
  gpu_name?: string;
  gpu_temp_c?: number;
  uptime_sec?: number;
  process_count?: number;
  timestamp?: number;
  top_processes?: EyeTopProcess[];
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatUptime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours <= 0) return `${minutes}м ${seconds}с`;
  return `${hours}ч ${minutes}м`;
}

function isNetPayload(payload: unknown): payload is NetStatusPayload {
  return payload != null && typeof payload === "object" && "connected" in payload;
}

function isEyePayload(payload: unknown): payload is EyeStatsPayload {
  return (
    payload != null &&
    typeof payload === "object" &&
    ("cpu_percent" in payload || "memory_percent" in payload)
  );
}

/** Payload от Gate /api/stats для виджета в Hub (stats + privacy по трекерам) */
type GateStatsPayload = {
  total_queries?: number;
  blocked_today?: number;
  blocked_total?: number;
  blocked_percent?: number;
  blocklist_count?: number;
  score?: number;
  tracker_queries?: number;
  tracker_blocked?: number;
  timestamp?: number;
};

function isGatePayload(payload: unknown): payload is GateStatsPayload {
  return (
    payload != null &&
    typeof payload === "object" &&
    ("total_queries" in payload || "blocked_today" in payload)
  );
}

/** Опции конфига и пресеты по типу модуля (Net — только сеть, Eye — метрики + GPU). */
const EYE_CONFIG_KEYS: ReadonlyArray<[keyof MonitorVisibleSettings, string]> = [
  ["cpu", "CPU"],
  ["memory", "Память %"],
  ["memory_mb", "Память МБ"],
  ["disk_percent", "Диск %"],
  ["disk_gb", "Диск ГБ"],
  ["uptime", "Аптайм"],
  ["process_count", "Процессы"],
  ["gpu", "GPU"],
];
const NET_CONFIG_KEYS: ReadonlyArray<[keyof MonitorVisibleSettings, string]> = [
  ["download_speed", "Скорость ↓"],
  ["upload_speed", "Скорость ↑"],
  ["total_download", "Всего ↓"],
  ["total_upload", "Всего ↑"],
];

function isNetModule(moduleId: string): boolean {
  return moduleId.includes("net") || moduleId === "net";
}

/** Тип модуля для обводки карточки (net/eye). */
function getModuleBorderType(moduleId: string): "net" | "eye" | undefined {
  if (moduleId.includes("net")) return "net";
  if (moduleId.includes("eye")) return "eye";
  return undefined;
}

/** Название модуля для отображения: без префикса "nekkus ", в верхнем регистре (NET, EYE, HUB). */
function getModuleDisplayName(manifest: { id: string; name?: string }): string {
  const raw = (manifest.name || manifest.id || "").trim();
  const withoutNekkus = raw.replace(/^nekkus\s+/i, "").trim() || raw;
  return withoutNekkus.toUpperCase();
}

function App() {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [monitorVisibleByModule, setMonitorVisibleByModule] = useState<
    Record<string, MonitorVisibleSettings>
  >(loadMonitorVisibleByModule);
  const [configOpenModuleId, setConfigOpenModuleId] = useState<string | null>(
    null,
  );
  const [moduleOrder, setModuleOrderState] = useState<string[]>(loadModuleOrder);
  const [moduleSizes, setModuleSizesState] = useState<Record<string, ModuleCardSize>>(
    loadModuleSizes,
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  /** Выбранный сервер для Net в Hub (по moduleId), для выпадающего списка. */
  const [selectedNetServerByModule, setSelectedNetServerByModule] = useState<
    Record<string, string>
  >({});
  const addModuleInputRef = useRef<HTMLInputElement>(null);

  const setModuleOrder = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    setModuleOrderState((prev) => {
      const order = typeof next === "function" ? next(prev) : next;
      saveModuleOrder(order);
      return order;
    });
  }, []);

  const setModuleSizes = useCallback(
    (patch: Record<string, ModuleCardSize> | ((prev: Record<string, ModuleCardSize>) => Record<string, ModuleCardSize>)) => {
      setModuleSizesState((prev) => {
        const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
        saveModuleSizes(next);
        return next;
      });
    },
    [],
  );

  const updateModuleVisible = useCallback(
    (moduleId: string, patch: Partial<MonitorVisibleSettings>) => {
      setMonitorVisibleByModule((prev) => {
        const next = {
          ...prev,
          [moduleId]: {
            ...(prev[moduleId] ?? DEFAULT_MONITOR_VISIBLE),
            ...patch,
          },
        };
        saveMonitorVisibleByModule(next);
        return next;
      });
    },
    [],
  );

  const applyPresetForModule = useCallback(
    (moduleId: string, preset: MonitorVisibleSettings) => {
      setMonitorVisibleByModule((prev) => {
        const next = { ...prev, [moduleId]: preset };
        saveMonitorVisibleByModule(next);
        return next;
      });
    },
    [],
  );

  const totalModules = useMemo(() => modules.length, [modules]);
  const withErrors = useMemo(
    () => modules.filter((m) => m.error).length,
    [modules],
  );

  const orderedModules = useMemo(() => {
    const byId = new Map(modules.map((m) => [m.manifest.id, m]));
    const seen = new Set<string>();
    const result: ModuleSummary[] = [];
    for (const id of moduleOrder) {
      const m = byId.get(id);
      if (m) {
        result.push(m);
        seen.add(id);
      }
    }
    for (const m of modules) {
      if (!seen.has(m.manifest.id)) result.push(m);
    }
    return result;
  }, [modules, moduleOrder]);

  const getCardSize = useCallback(
    (moduleId: string): ModuleCardSize => moduleSizes[moduleId] ?? "medium",
    [moduleSizes],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, moduleId: string) => {
      setDraggedId(moduleId);
      e.dataTransfer.setData("text/plain", moduleId);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === targetId) return;
      setModuleOrder((prev) => {
        const idx = prev.indexOf(sourceId);
        if (idx === -1) {
          const next = [...prev];
          const t = next.indexOf(targetId);
          next.splice(t < 0 ? next.length : t, 0, sourceId);
          return next;
        }
        const next = prev.filter((id) => id !== sourceId);
        const newTargetIdx = next.indexOf(targetId);
        next.splice(newTargetIdx < 0 ? next.length : newTargetIdx, 0, sourceId);
        return next;
      });
      setDraggedId(null);
    },
    [setModuleOrder],
  );

  const loadSummary = useCallback(async () => {
    try {
      setErrorMessage(null);
      const summary = await fetchSummary();
      setModules(summary);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to load modules",
      );
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (isBusy) return;
    const intervalId = window.setInterval(() => void loadSummary(), 3000);
    return () => window.clearInterval(intervalId);
  }, [isBusy, loadSummary]);

  const handleRescan = useCallback(async () => {
    try {
      setIsBusy(true);
      setErrorMessage(null);
      await rescanModules();
      await loadSummary();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to rescan modules",
      );
    } finally {
      setIsBusy(false);
    }
  }, [loadSummary]);

  const handleStart = useCallback(
    async (id: string) => {
      try {
        setIsBusy(true);
        setErrorMessage(null);
        await startModule(id);
        await loadSummary();
        // Повторный запрос через 2 с: модуль (и VPN в Net) успевает инициализироваться,
        // карточка не показывает устаревшее «Отключено» до следующего опроса.
        window.setTimeout(() => void loadSummary(), 2000);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to start module",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadSummary],
  );

  const handleOpenUI = useCallback(
    async (id: string) => {
      try {
        setIsBusy(true);
        setErrorMessage(null);
        await openModuleUI(id);
        await loadSummary();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to open module UI",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadSummary],
  );

  const handleStop = useCallback(
    async (id: string) => {
      try {
        setIsBusy(true);
        setErrorMessage(null);
        await stopModule(id);
        await loadSummary();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to stop module",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadSummary],
  );

  const handleNetConnect = useCallback(
    async (moduleId: string, server: string) => {
      if (!server.trim()) return;
      try {
        setIsBusy(true);
        setErrorMessage(null);
        await netConnect(moduleId, server.trim());
        await loadSummary();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Не удалось подключиться",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadSummary],
  );

  const handleNetDisconnect = useCallback(
    async (moduleId: string) => {
      try {
        setIsBusy(true);
        setErrorMessage(null);
        await netDisconnect(moduleId);
        await loadSummary();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Не удалось отключиться",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadSummary],
  );

  const handleAddModuleClick = useCallback(() => {
    addModuleInputRef.current?.click();
  }, []);

  const handleAddModuleFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList?.length) return;
      const files: Array<{ file: File; relativePath: string }> = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;
        const path =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        const segments = path.split("/");
        const relativePath =
          segments.length > 1 ? segments.slice(1).join("/") : file.name;
        files.push({ file, relativePath });
      }
      const manifestEntry = files.find((f) => f.file.name === "manifest.json");
      const moduleRootPrefix =
        manifestEntry && manifestEntry.relativePath.includes("/")
          ? `${manifestEntry.relativePath.split("/").slice(0, -1).join("/")}/`
          : "";
      const formData = new FormData();
      for (const { file, relativePath } of files) {
        if (moduleRootPrefix && !relativePath.startsWith(moduleRootPrefix))
          continue;
        const key = moduleRootPrefix
          ? relativePath.slice(moduleRootPrefix.length)
          : relativePath;
        formData.append(key, file);
      }
      event.target.value = "";
      try {
        setIsBusy(true);
        setErrorMessage(null);
        await addModule(formData);
        await loadSummary();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to add module",
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadSummary],
  );

  return (
    <PageLayout className="nekkus-glass-root">
      <div className="hub">
        <AppShell
          logo="Nekkus"
          title="Hub"
          description="Модули и виджеты в одной панели."
          meta={
            <>
              <HeaderStat label="Модули" value={totalModules} />
              <HeaderStat label="Ошибки" value={withErrors} />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRescan}
                disabled={isBusy}
                title="Обновить список модулей"
                aria-label="Обновить список модулей"
              >
                Обновить
              </Button>
              <input
                ref={addModuleInputRef}
                type="file"
                multiple
                {...({
                  webkitdirectory: "",
                  directory: "",
                } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={handleAddModuleFiles}
                style={{ display: "none" }}
                aria-hidden
              />
            </>
          }
        >
          {errorMessage ? (
          <div className="hub__error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <Section title="" className="hub__grid-wrap">
          <ModuleCardGrid>
            {orderedModules.length === 0 ? (
              <EmptyState>
                Нет модулей. Нажмите на блок «+» ниже или кнопку обновления выше.
              </EmptyState>
            ) : null}
            {orderedModules.map((module) => {
              const moduleVisible = getModuleVisible(
                module.manifest.id,
                monitorVisibleByModule,
              );
              const cardSize = getCardSize(module.manifest.id);
              const isDragging = draggedId === module.manifest.id;
              const moduleBorderType = getModuleBorderType(module.manifest.id);
              return (
              <ModuleCard
                key={module.manifest.id}
                size={cardSize}
                title={getModuleDisplayName(module.manifest)}
                description={module.manifest.description || "No description"}
                module={moduleBorderType}
                running={module.running}
                onSizeChange={(s) => setModuleSizes({ [module.manifest.id]: s })}
                headerActions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfigOpenModuleId((id) =>
                          id === module.manifest.id ? null : module.manifest.id,
                        );
                      }}
                      aria-expanded={configOpenModuleId === module.manifest.id}
                      aria-haspopup="true"
                      title="Что показывать в виджете"
                    >
                      ⚙
                    </Button>
                    <Pill variant="default">
                      {module.manifest.widget?.type || "widget"}
                    </Pill>
                  </>
                }
                configPanel={
                  configOpenModuleId === module.manifest.id ? (
                  <>
                    <p className="nekkus-module-card__config-title">
                      {isNetModule(module.manifest.id) ? "Сетевые метрики" : "Метрики мониторинга"}
                    </p>
                    <div className="hub__card-config-presets">
                      {isNetModule(module.manifest.id) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            applyPresetForModule(module.manifest.id, PRESET_NETWORK)
                          }
                        >
                          Сеть
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              applyPresetForModule(module.manifest.id, PRESET_STANDARD)
                            }
                          >
                            Стандарт
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              applyPresetForModule(module.manifest.id, PRESET_EXTENDED)
                            }
                          >
                            Расширенный
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="hub__card-config-grid">
                      {(isNetModule(module.manifest.id) ? NET_CONFIG_KEYS : EYE_CONFIG_KEYS).map(
                        ([key, label]) => {
                          const visible = getModuleVisible(
                            module.manifest.id,
                            monitorVisibleByModule,
                          );
                          return (
                            <label key={key} className="hub__monitor-settings-label">
                              <input
                                type="checkbox"
                                checked={visible[key] ?? false}
                                onChange={(e) =>
                                  updateModuleVisible(module.manifest.id, { [key]: e.target.checked })
                                }
                              />
                              {label}
                            </label>
                          );
                        },
                      )}
                    </div>
                  </>
                  ) : undefined}
                footer={
                  <>
                    <span>ID: {module.manifest.id}</span>
                    <span>gRPC: {module.manifest.grpc_addr || "—"}</span>
                    <span>Статус: {module.running ? "Запущен" : "Остановлен"}</span>
                    <div className="hub__card-actions">
                      {!module.running ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleStart(module.manifest.id)}
                          disabled={isBusy}
                        >
                          Запустить
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenUI(module.manifest.id)}
                        disabled={isBusy}
                        title="Открыть приложение в отдельном окне"
                      >
                        Открыть
                      </Button>
                      {module.running ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStop(module.manifest.id)}
                          disabled={isBusy}
                        >
                          Остановить
                        </Button>
                      ) : null}
                    </div>
                  </>
                }
                onDragStart={(e) => handleDragStart(e, module.manifest.id)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, module.manifest.id)}
                dragging={isDragging}
              >
                {module.error ? (
                    <div className="hub__card-error">
                      Ошибка: {module.error}
                    </div>
                  ) : isNetPayload(module.payload) ? (
                    (() => {
                      const netPayload = module.payload as NetStatusPayload;
                      return (
                    <div className="hub__net-widget">
                      <div className="hub__net-widget-status">
                        <StatusDot
                          status={netPayload.connected ? "online" : "offline"}
                          label={
                            netPayload.connected
                              ? "VPN: Подключено"
                              : "VPN: Отключено"
                          }
                          pulse={!!netPayload.connected}
                        />
                        <span className="hub__net-widget-server">
                          {netPayload.server || "—"}
                        </span>
                      </div>
                      {Array.isArray(netPayload.servers) && netPayload.servers.length > 0 ? (
                        <div className="hub__net-widget-controls">
                          <select
                            className="hub__net-widget-select"
                            value={
                              selectedNetServerByModule[module.manifest.id] ??
                              netPayload.server ??
                              netPayload.servers[0] ??
                              ""
                            }
                            onChange={(e) =>
                              setSelectedNetServerByModule((prev) => ({
                                ...prev,
                                [module.manifest.id]: e.target.value,
                              }))
                            }
                            disabled={isBusy}
                            aria-label="Выбор сервера VPN"
                          >
                            {netPayload.servers.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          {netPayload.connected ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNetDisconnect(module.manifest.id);
                              }}
                              disabled={isBusy}
                            >
                              Отключить
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                const server =
                                  selectedNetServerByModule[module.manifest.id] ??
                                  netPayload.server ??
                                  netPayload.servers?.[0] ??
                                  "";
                                if (server) handleNetConnect(module.manifest.id, server);
                              }}
                              disabled={isBusy}
                            >
                              Подключить
                            </Button>
                          )}
                        </div>
                      ) : null}
                      {!netPayload.connected && !(netPayload.servers?.length) ? (
                        <p className="hub__net-widget-hint">
                          Выберите подписку по умолчанию в приложении Net — тогда здесь появится список серверов и кнопки подключения.
                        </p>
                      ) : null}
                      <div className="hub__net-widget-metrics">
                        {moduleVisible.download_speed ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">↓</span>
                            <DataText size="base">
                              {formatSpeed(
                                netPayload.downloadSpeed ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                        {moduleVisible.upload_speed ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">↑</span>
                            <DataText size="base">
                              {formatSpeed(
                                netPayload.uploadSpeed ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                        {moduleVisible.total_download ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">Всего ↓</span>
                            <DataText size="sm">
                              {formatBytes(
                                netPayload.totalDownload ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                        {moduleVisible.total_upload ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">Всего ↑</span>
                            <DataText size="sm">
                              {formatBytes(
                                netPayload.totalUpload ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                      </div>
                    </div>
                      );
                    })()
                  ) : isEyePayload(module.payload) ? (
                    (() => {
                      const eyePayload = module.payload as EyeStatsPayload;
                      const hasAnyMetric =
                        moduleVisible.cpu ||
                        moduleVisible.memory ||
                        moduleVisible.memory_mb ||
                        moduleVisible.disk_percent ||
                        moduleVisible.disk_gb ||
                        moduleVisible.uptime ||
                        moduleVisible.process_count ||
                        (moduleVisible.gpu &&
                          (eyePayload.gpu_percent != null ||
                            (eyePayload.gpu_name != null && eyePayload.gpu_name !== "") ||
                            eyePayload.gpu_temp_c != null));
                      return (
                    <div className="hub__eye-widget">
                      {hasAnyMetric ? (
                        <div className="hub__eye-widget-metrics">
                          {moduleVisible.cpu ? (
                            <ProgressBar
                              label="CPU"
                              value={eyePayload.cpu_percent ?? 0}
                              extra={
                                eyePayload.cpu_temp_c != null && eyePayload.cpu_temp_c > 0
                                  ? `${eyePayload.cpu_temp_c}°C`
                                  : eyePayload.cpu_mhz != null && eyePayload.cpu_mhz > 0
                                    ? `${(eyePayload.cpu_mhz / 1000).toFixed(1)} GHz`
                                    : undefined
                              }
                              height={6}
                              className="hub__eye-widget-bar"
                            />
                          ) : null}
                          {moduleVisible.memory ? (
                            <ProgressBar
                              label="RAM"
                              value={eyePayload.memory_percent ?? 0}
                              extra={
                                moduleVisible.memory_mb && eyePayload.memory_used_mb != null && eyePayload.memory_total_mb != null
                                  ? `${eyePayload.memory_used_mb} / ${eyePayload.memory_total_mb} МБ`
                                  : undefined
                              }
                              height={6}
                              className="hub__eye-widget-bar"
                            />
                          ) : moduleVisible.memory_mb ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Память</span>
                              <DataText size="sm">
                                {`${eyePayload.memory_used_mb ?? 0} / ${eyePayload.memory_total_mb ?? 0} МБ`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.disk_percent ? (
                            <ProgressBar
                              label="Диск"
                              value={eyePayload.disk_percent ?? 0}
                              extra={
                                moduleVisible.disk_gb && eyePayload.disk_used_gb != null && eyePayload.disk_total_gb != null
                                  ? `${eyePayload.disk_used_gb} / ${eyePayload.disk_total_gb} ГБ`
                                  : undefined
                              }
                              height={6}
                              className="hub__eye-widget-bar"
                            />
                          ) : moduleVisible.disk_gb ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Диск</span>
                              <DataText size="sm">
                                {`${eyePayload.disk_used_gb ?? 0} / ${eyePayload.disk_total_gb ?? 0} ГБ`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.uptime ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Аптайм</span>
                              <DataText size="sm">
                                {formatUptime(eyePayload.uptime_sec ?? 0)}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.process_count ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Процессы</span>
                              <DataText size="sm">
                                {eyePayload.process_count ?? 0}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.gpu &&
                          (eyePayload.gpu_percent != null || (eyePayload.gpu_name != null && eyePayload.gpu_name !== "") || eyePayload.gpu_temp_c != null) ? (
                            <ProgressBar
                              label="GPU"
                              value={eyePayload.gpu_percent ?? 0}
                              extra={
                                eyePayload.gpu_temp_c != null && eyePayload.gpu_temp_c > 0
                                  ? `${eyePayload.gpu_temp_c}°C`
                                  : eyePayload.gpu_name ?? undefined
                              }
                              height={6}
                              className="hub__eye-widget-bar"
                            />
                          ) : null}
                          {Array.isArray(eyePayload.top_processes) && eyePayload.top_processes.length > 0 ? (
                            <div className="hub__eye-widget-top">
                              <span className="hub__eye-widget-top-label">Топ:</span>
                              <span className="hub__eye-widget-top-list font-mono text-nekkus-sm text-nekkus-text-muted">
                                {eyePayload.top_processes
                                  .slice(0, 3)
                                  .map((p) => `${p.name ?? "?"} ${(p.cpu_percent ?? 0).toFixed(0)}%`)
                                  .join("  ")}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="hub__card-no-data">
                          Включите метрики в «Настроить» на карточке
                        </p>
                      )}
                    </div>
                      );
                    })()
                  ) : isGatePayload(module.payload) ? (
                    (() => {
                      const gatePayload = module.payload as GateStatsPayload;
                      const total = gatePayload.total_queries ?? 0;
                      const blockedToday = gatePayload.blocked_today ?? 0;
                      const pct = gatePayload.blocked_percent ?? (total > 0 ? (blockedToday / total) * 100 : 0);
                      const blocklistCount = gatePayload.blocklist_count ?? 0;
                      const score = gatePayload.score ?? null;
                      const trackerQueries = gatePayload.tracker_queries ?? 0;
                      const trackerBlocked = gatePayload.tracker_blocked ?? 0;
                      return (
                    <div className="hub__gate-widget">
                      <div className="hub__gate-widget-metrics">
                        {score != null && (
                          <div className="hub__gate-widget-metric hub__gate-widget-score">
                            <span className="hub__gate-widget-label">Privacy Score</span>
                            <DataText size="base">{score}/100</DataText>
                          </div>
                        )}
                        <div className="hub__gate-widget-metric">
                          <span className="hub__gate-widget-label">Заблокировано сегодня</span>
                          <DataText size="base">{blockedToday.toLocaleString()}</DataText>
                        </div>
                        <div className="hub__gate-widget-metric">
                          <span className="hub__gate-widget-label">Запросов</span>
                          <DataText size="sm">{total.toLocaleString()}</DataText>
                        </div>
                        <div className="hub__gate-widget-metric">
                          <span className="hub__gate-widget-label">Трекеров заблок.</span>
                          <DataText size="sm">{trackerQueries > 0 ? `${trackerBlocked}/${trackerQueries}` : '—'}</DataText>
                        </div>
                        <div className="hub__gate-widget-metric">
                          <span className="hub__gate-widget-label">Доменов в блок-листе</span>
                          <DataText size="sm">{blocklistCount.toLocaleString()}</DataText>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openModuleUI(module.manifest.id);
                        }}
                        disabled={isBusy}
                      >
                        Открыть →
                      </Button>
                    </div>
                      );
                    })()
                  ) : module.payload != null ? (
                    <details className="hub__card-details">
                      <summary className="hub__card-details-summary">
                        Данные модуля (JSON)
                      </summary>
                      <pre className="hub__card-pre">
                        {JSON.stringify(module.payload, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <p className="hub__card-no-data">Нет данных</p>
                  )}
              </ModuleCard>
              );
            })}
            <AddModulePlaceholder
              empty={orderedModules.length === 0}
              disabled={isBusy}
              onClick={handleAddModuleClick}
            >
              Добавить модуль
            </AddModulePlaceholder>
          </ModuleCardGrid>
        </Section>
        </AppShell>
      </div>
    </PageLayout>
  );
}

export default App;
