import { useCallback, useEffect, useMemo, useState } from 'react'
import './app.css'
import { fetchSummary, openModuleUI, rescanModules, startModule, stopModule } from './api'
import type { ModuleSummary } from './types'

function App() {
  const [modules, setModules] = useState<ModuleSummary[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const totalModules = useMemo(() => modules.length, [modules])
  const withErrors = useMemo(() => modules.filter((module) => module.error).length, [modules])

  const loadSummary = useCallback(async () => {
    try {
      setErrorMessage(null)
      const summary = await fetchSummary()
      setModules(summary)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load modules')
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const handleRescan = useCallback(async () => {
    try {
      setIsBusy(true)
      setErrorMessage(null)
      await rescanModules()
      await loadSummary()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to rescan modules')
    } finally {
      setIsBusy(false)
    }
  }, [loadSummary])

  const handleStart = useCallback(
    async (id: string) => {
      try {
        setIsBusy(true)
        setErrorMessage(null)
        await startModule(id)
        await loadSummary()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to start module')
      } finally {
        setIsBusy(false)
      }
    },
    [loadSummary],
  )

  const handleOpenUI = useCallback(
    async (id: string) => {
      try {
        setIsBusy(true)
        setErrorMessage(null)
        await openModuleUI(id)
        await loadSummary()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to open module UI')
      } finally {
        setIsBusy(false)
      }
    },
    [loadSummary],
  )

  const handleStop = useCallback(
    async (id: string) => {
      try {
        setIsBusy(true)
        setErrorMessage(null)
        await stopModule(id)
        await loadSummary()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to stop module')
      } finally {
        setIsBusy(false)
      }
    },
    [loadSummary],
  )

  return (
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
          <button className="btn btn--primary" onClick={handleRescan} disabled={isBusy}>
            Пересканировать
          </button>
        </div>
      </header>

      {errorMessage ? <div className="hub__error">{errorMessage}</div> : null}

      <section className="hub__grid">
        {modules.map((module) => (
          <article key={module.manifest.id} className="card">
            <header className="card__header">
              <div>
                <h2>{module.manifest.name || module.manifest.id}</h2>
                <p>{module.manifest.description || 'No description'}</p>
              </div>
              <span className="pill">{module.manifest.widget?.type || 'widget'}</span>
            </header>
            <div className="card__body">
              {module.error ? (
                <div className="card__error">Ошибка: {module.error}</div>
              ) : (
                <pre>{module.payload ? JSON.stringify(module.payload, null, 2) : 'Нет данных'}</pre>
              )}
            </div>
            <footer className="card__footer">
              <span>ID: {module.manifest.id}</span>
              <span>gRPC: {module.manifest.grpc_addr || '—'}</span>
              <span>Статус: {module.running ? 'Запущен' : 'Остановлен'}</span>
              <div className="card__actions">
                {!module.running ? (
                  <button className="btn btn--primary" onClick={() => handleStart(module.manifest.id)} disabled={isBusy}>
                    Запустить
                  </button>
                ) : null}
                <button className="btn" onClick={() => handleOpenUI(module.manifest.id)} disabled={isBusy}>
                  Открыть UI
                </button>
                {module.running ? (
                  <button className="btn" onClick={() => handleStop(module.manifest.id)} disabled={isBusy}>
                    Остановить
                  </button>
                ) : null}
              </div>
            </footer>
          </article>
        ))}
      </section>
    </div>
  )
}

export default App
