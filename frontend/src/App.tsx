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
} from "./types";
import {
  DEFAULT_MONITOR_VISIBLE,
  getModuleVisible,
  loadMonitorVisibleByModule,
  PRESET_EXTENDED,
  PRESET_NETWORK,
  PRESET_STANDARD,
  saveMonitorVisibleByModule,
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
  const addModuleInputRef = useRef<HTMLInputElement>(null);

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
              variant="primary"
              onClick={handleRescan}
              disabled={isBusy}
            >
              Пересканировать
            </Button>
            <Button
              variant="secondary"
              onClick={handleAddModuleClick}
              disabled={isBusy}
            >
              Добавить модуль
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
            {modules.map((module) => {
              const moduleVisible = getModuleVisible(
                module.manifest.id,
                monitorVisibleByModule,
              );
              return (
              <Card
                key={module.manifest.id}
                title=""
                accentTop={module.running}
                className="hub__card"
              >
                <header className="hub__card-header">
                  <div>
                    <h2 className="hub__card-title">
                      {module.manifest.name || module.manifest.id}
                    </h2>
                    <p className="hub__card-desc">
                      {module.manifest.description || "No description"}
                    </p>
                  </div>
                  <div className="hub__card-header-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfigOpenModuleId((id) =>
                          id === module.manifest.id ? null : module.manifest.id,
                        )
                      }
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
                    <p className="hub__card-config-title">Что показывать</p>
                    <div className="hub__card-config-presets">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          applyPresetForModule(
                            module.manifest.id,
                            PRESET_STANDARD,
                          )
                        }
                      >
                        Стандарт
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          applyPresetForModule(
                            module.manifest.id,
                            PRESET_EXTENDED,
                          )
                        }
                      >
                        Расширенный
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          applyPresetForModule(
                            module.manifest.id,
                            PRESET_NETWORK,
                          )
                        }
                      >
                        Сеть
                      </Button>
                    </div>
                    <div className="hub__card-config-grid">
                      {(
                        [
                          ["cpu", "CPU"],
                          ["memory", "Память %"],
                          ["memory_mb", "Память МБ"],
                          ["disk_percent", "Диск %"],
                          ["disk_gb", "Диск ГБ"],
                          ["uptime", "Аптайм"],
                          ["process_count", "Процессы"],
                          ["download_speed", "Скорость ↓"],
                          ["upload_speed", "Скорость ↑"],
                          ["total_download", "Всего ↓"],
                          ["total_upload", "Всего ↑"],
                        ] as const
                      ).map(([key, label]) => {
                        const visible = getModuleVisible(
                          module.manifest.id,
                          monitorVisibleByModule,
                        );
                        return (
                          <label
                            key={key}
                            className="hub__monitor-settings-label"
                          >
                            <input
                              type="checkbox"
                              checked={
                                visible[
                                  key as keyof MonitorVisibleSettings
                                ] ?? false
                              }
                              onChange={(e) =>
                                updateModuleVisible(module.manifest.id, {
                                  [key]: e.target.checked,
                                })
                              }
                            />
                            {label}
                          </label>
                        );
                      })}
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
                        module.payload.gpu_percent != null ||
                        (module.payload.gpu_name != null && module.payload.gpu_name !== "") ||
                        module.payload.gpu_temp_c != null) ? (
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
                          {(module.payload.gpu_percent != null || (module.payload.gpu_name != null && module.payload.gpu_name !== "") || module.payload.gpu_temp_c != null) ? (
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
          </div>
        </Section>
      </div>
    </PageLayout>
  );
}

export default App;
