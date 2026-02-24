import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  DataText,
  PageLayout,
  Pill,
  Section,
  StatusDot,
} from "@nekkus/ui-kit";
import {
  addModule,
  fetchSummary,
  openModuleUI,
  rescanModules,
  startModule,
  stopModule,
} from "./api";
import type {
  ModuleSummary,
  MonitorVisibleSettings,
  ModuleCardSize,
} from "./types";
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
  downloadSpeed?: number;
  uploadSpeed?: number;
  totalDownload?: number;
  totalUpload?: number;
};

/** Payload от Eye /api/stats для виджета в Hub */
type EyeStatsPayload = {
  cpu_percent?: number;
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
    <PageLayout>
      <div className="hub">
        <header className="hub__header">
          <div>
            <p className="hub__eyebrow">nekkus hub</p>
            <h1 className="hub__title">Модули и виджеты</h1>
          </div>
          <div className="hub__meta">
            <div className="hub__stat">
              <span>Модули</span>
              <strong>{totalModules}</strong>
            </div>
            <div className="hub__stat">
              <span>Ошибки</span>
              <strong>{withErrors}</strong>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRescan}
              disabled={isBusy}
              className="hub__scan-compact"
              title="Пересканировать модули"
            >
              🔄
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
          </div>
        </header>

        {errorMessage ? (
          <div className="hub__error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <Section title="" className="hub__grid-wrap">
          <div className="hub__grid">
            {orderedModules.length === 0 ? (
              <p className="hub__empty-state">
                Нет модулей. Нажмите на блок «+» ниже или кнопку обновления выше.
              </p>
            ) : null}
            {orderedModules.map((module) => {
              const moduleVisible = getModuleVisible(
                module.manifest.id,
                monitorVisibleByModule,
              );
              const cardSize = getCardSize(module.manifest.id);
              const isDragging = draggedId === module.manifest.id;
              return (
              <Card
                key={module.manifest.id}
                title=""
                accentTop={module.running}
                className={`hub__card hub__card--${cardSize} ${isDragging ? "hub__card--dragging" : ""}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, module.manifest.id)}
              >
                <header className="hub__card-header">
                  <div
                    className="hub__card-header-drag hub__card--drag-handle"
                    draggable
                    onDragStart={(e) => handleDragStart(e, module.manifest.id)}
                    onDragEnd={handleDragEnd}
                    title="Перетащите для смены порядка"
                  >
                    <h2 className="hub__card-title">
                      {module.manifest.name || module.manifest.id}
                    </h2>
                    <p className="hub__card-desc">
                      {module.manifest.description || "No description"}
                    </p>
                  </div>
                  <div className="hub__card-header-actions">
                    <span className="hub__card-size-btns" onClick={(e) => e.stopPropagation()}>
                      {(["small", "medium", "large"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`hub__card-size-btn ${cardSize === s ? "hub__card-size-btn--active" : ""}`}
                          onClick={() => setModuleSizes({ [module.manifest.id]: s })}
                          title={s === "small" ? "Маленький" : s === "medium" ? "Средний" : "Большой"}
                          aria-pressed={cardSize === s}
                        >
                          {s === "small" ? "S" : s === "medium" ? "M" : "L"}
                        </button>
                      ))}
                    </span>
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
                  </div>
                </header>
                {configOpenModuleId === module.manifest.id ? (
                  <div className="hub__card-config" role="dialog" aria-label="Настройки отображения">
                    <p className="hub__card-config-title">
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
                  </div>
                ) : null}
                <div className="hub__card-body">
                  {module.error ? (
                    <div className="hub__card-error">
                      Ошибка: {module.error}
                    </div>
                  ) : isNetPayload(module.payload) ? (
                    <div className="hub__net-widget">
                      <div className="hub__net-widget-status">
                        <StatusDot
                          status={module.payload.connected ? "online" : "offline"}
                          label={
                            module.payload.connected
                              ? "Подключено"
                              : "Отключено"
                          }
                          pulse={!!module.payload.connected}
                        />
                        <span className="hub__net-widget-server">
                          {module.payload.server || "—"}
                        </span>
                      </div>
                      {!module.payload.connected ? (
                        <p className="hub__net-widget-hint">
                          Откройте UI модуля и подключитесь к VPN — тогда здесь появятся скорость и трафик (обновление раз в 3 с).
                        </p>
                      ) : null}
                      <div className="hub__net-widget-metrics">
                        {moduleVisible.download_speed ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">↓</span>
                            <DataText size="base">
                              {formatSpeed(
                                module.payload.downloadSpeed ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                        {moduleVisible.upload_speed ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">↑</span>
                            <DataText size="base">
                              {formatSpeed(
                                module.payload.uploadSpeed ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                        {moduleVisible.total_download ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">Всего ↓</span>
                            <DataText size="sm">
                              {formatBytes(
                                module.payload.totalDownload ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                        {moduleVisible.total_upload ? (
                          <div className="hub__net-widget-metric">
                            <span className="hub__net-widget-label">Всего ↑</span>
                            <DataText size="sm">
                              {formatBytes(
                                module.payload.totalUpload ?? 0,
                              )}
                            </DataText>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : isEyePayload(module.payload) ? (
                    <div className="hub__eye-widget">
                      {(moduleVisible.cpu ||
                        moduleVisible.memory ||
                        moduleVisible.memory_mb ||
                        moduleVisible.disk_percent ||
                        moduleVisible.disk_gb ||
                        moduleVisible.uptime ||
                        moduleVisible.process_count ||
                        (moduleVisible.gpu &&
                          (module.payload.gpu_percent != null ||
                            (module.payload.gpu_name != null && module.payload.gpu_name !== "") ||
                            module.payload.gpu_temp_c != null))) ? (
                        <div className="hub__eye-widget-metrics">
                          {moduleVisible.cpu ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">CPU</span>
                              <DataText size="base">
                                {`${(module.payload.cpu_percent ?? 0).toFixed(1)}%`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.memory ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Память %</span>
                              <DataText size="base">
                                {`${(module.payload.memory_percent ?? 0).toFixed(1)}%`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.memory_mb ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Память</span>
                              <DataText size="sm">
                                {`${module.payload.memory_used_mb ?? 0} / ${module.payload.memory_total_mb ?? 0} МБ`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.disk_percent ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Диск %</span>
                              <DataText size="base">
                                {`${(module.payload.disk_percent ?? 0).toFixed(1)}%`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.disk_gb ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Диск</span>
                              <DataText size="sm">
                                {`${module.payload.disk_used_gb ?? 0} / ${module.payload.disk_total_gb ?? 0} ГБ`}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.uptime ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Аптайм</span>
                              <DataText size="sm">
                                {formatUptime(module.payload.uptime_sec ?? 0)}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.process_count ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">Процессы</span>
                              <DataText size="sm">
                                {module.payload.process_count ?? 0}
                              </DataText>
                            </div>
                          ) : null}
                          {moduleVisible.gpu &&
                          (module.payload.gpu_percent != null || (module.payload.gpu_name != null && module.payload.gpu_name !== "") || module.payload.gpu_temp_c != null) ? (
                            <div className="hub__eye-widget-metric">
                              <span className="hub__eye-widget-label">GPU</span>
                              <DataText size="sm">
                                {module.payload.gpu_percent != null
                                  ? `${module.payload.gpu_percent.toFixed(1)}%`
                                  : "—"}
                                {module.payload.gpu_name ? ` · ${module.payload.gpu_name}` : ""}
                                {module.payload.gpu_temp_c != null && module.payload.gpu_temp_c > 0
                                  ? ` · ${module.payload.gpu_temp_c} °C`
                                  : ""}
                              </DataText>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="hub__card-no-data">
                          Включите метрики в «Настроить» на карточке
                        </p>
                      )}
                    </div>
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
                </div>
                <footer className="hub__card-footer">
                  <span>ID: {module.manifest.id}</span>
                  <span>gRPC: {module.manifest.grpc_addr || "—"}</span>
                  <span>
                    Статус: {module.running ? "Запущен" : "Остановлен"}
                  </span>
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
                    >
                      Открыть UI
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
                </footer>
              </Card>
              );
            })}
            <button
              type="button"
              className={`hub__add-placeholder ${orderedModules.length === 0 ? "hub__add-placeholder--empty" : ""}`}
              onClick={handleAddModuleClick}
              disabled={isBusy}
              title="Добавить модуль (папка с manifest.json)"
            >
              <span className="hub__add-placeholder-icon" aria-hidden>+</span>
              <span>Добавить модуль</span>
            </button>
          </div>
        </Section>
      </div>
    </PageLayout>
  );
}

export default App;
