import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './app.css'
import { addModule, fetchSummary, openModuleUI, rescanModules, startModule, stopModule } from './api'
import type { ModuleSummary } from './types'

function App() {
  const [modules, setModules] = useState<ModuleSummary[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const addModuleInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (isBusy) {
      return
    }
    const intervalId = window.setInterval(() => {
      void loadSummary()
    }, 3000)
    return () => window.clearInterval(intervalId)
  }, [isBusy, loadSummary])

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

  const handleAddModuleClick = useCallback(() => {
    addModuleInputRef.current?.click()
  }, [])

  const handleAddModuleFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList?.length) return
      const files: Array<{ file: File; relativePath: string }> = []
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]
        if (!file) continue
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const segments = path.split('/')
        const relativePath = segments.length > 1 ? segments.slice(1).join('/') : file.name
        files.push({ file, relativePath })
      }
      const manifestEntry = files.find((f) => f.file.name === 'manifest.json')
      const moduleRootPrefix =
        manifestEntry && manifestEntry.relativePath.includes('/')
          ? `${manifestEntry.relativePath.split('/').slice(0, -1).join('/')}/`
          : ''
      const formData = new FormData()
      for (const { file, relativePath } of files) {
        if (moduleRootPrefix && !relativePath.startsWith(moduleRootPrefix)) continue
        const key = moduleRootPrefix
          ? relativePath.slice(moduleRootPrefix.length)
          : relativePath
        formData.append(key, file)
      }
      event.target.value = ''
      try {
        setIsBusy(true)
        setErrorMessage(null)
        await addModule(formData)
        await loadSummary()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to add module')
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
          <button
            type="button"
            className="btn"
            onClick={handleAddModuleClick}
            disabled={isBusy}
          >
            Добавить модуль
          </button>
          <input
            ref={addModuleInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={handleAddModuleFiles}
            style={{ display: 'none' }}
            aria-hidden
          />
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
