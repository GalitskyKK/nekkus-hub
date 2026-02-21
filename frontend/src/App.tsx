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
import type { ModuleSummary } from "./types";

/** Payload от Net /api/status для виджета в Hub */
type NetStatusPayload = {
  connected?: boolean;
  server?: string;
  downloadSpeed?: number;
  uploadSpeed?: number;
  totalDownload?: number;
  totalUpload?: number;
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

function isNetPayload(payload: unknown): payload is NetStatusPayload {
  return payload != null && typeof payload === "object" && "connected" in payload;
}

function App() {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const addModuleInputRef = useRef<HTMLInputElement>(null);

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
            {modules.map((module) => (
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
                  <Pill variant="default">
                    {module.manifest.widget?.type || "widget"}
                  </Pill>
                </header>
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
                        <div className="hub__net-widget-metric">
                          <span className="hub__net-widget-label">↓</span>
                          <DataText size="base">
                            {formatSpeed(
                              module.payload.downloadSpeed ?? 0,
                            )}
                          </DataText>
                        </div>
                        <div className="hub__net-widget-metric">
                          <span className="hub__net-widget-label">↑</span>
                          <DataText size="base">
                            {formatSpeed(
                              module.payload.uploadSpeed ?? 0,
                            )}
                          </DataText>
                        </div>
                        <div className="hub__net-widget-metric">
                          <span className="hub__net-widget-label">Всего ↓</span>
                          <DataText size="sm">
                            {formatBytes(
                              module.payload.totalDownload ?? 0,
                            )}
                          </DataText>
                        </div>
                        <div className="hub__net-widget-metric">
                          <span className="hub__net-widget-label">Всего ↑</span>
                          <DataText size="sm">
                            {formatBytes(
                              module.payload.totalUpload ?? 0,
                            )}
                          </DataText>
                        </div>
                      </div>
                    </div>
                  ) : module.payload != null ? (
                    <details className="hub__card-details">
                      <summary className="hub__card-details-summary">
                        Данные модуля
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
            ))}
          </div>
        </Section>
      </div>
    </PageLayout>
  );
}

export default App;
