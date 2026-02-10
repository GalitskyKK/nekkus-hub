import type { ModuleSummary } from './types'

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8080'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const fetchSummary = () => request<ModuleSummary[]>('/api/summary')
export const rescanModules = () =>
  request<ModuleSummary[]>('/api/scan', {
    method: 'POST',
  })
export const startModule = (id: string) =>
  request<{ ok: boolean }>(`/api/modules/${encodeURIComponent(id)}/start`, {
    method: 'POST',
  })
export const openModuleUI = (id: string) =>
  request<{ ok: boolean }>(`/api/modules/${encodeURIComponent(id)}/open-ui`, {
    method: 'POST',
  })
export const stopModule = (id: string) =>
  request<{ ok: boolean }>(`/api/modules/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
  })
