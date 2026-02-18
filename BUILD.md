# nekkus-hub: сборка и проверка

## Сборка

1. **Фронтенд** (один раз или после правок UI):
   ```bash
   cd frontend
   npm install
   npm run build
   ```
   Сборка попадёт в `ui/frontend/dist` (embed для Go).

2. **Go** (из корня `nekkus-hub`):
   - PowerShell: `go build -o nekkus-hub.exe ./cmd`
   - Bash (Git Bash): `go build -o nekkus-hub.exe ./cmd`
   Исполняемый файл появится в текущей папке.

## Запуск Hub

```bash
./nekkus-hub.exe
# или с флагами:
./nekkus-hub.exe -port 9000 -grpc-port 19000
```

Откроется окно и tray. UI: http://localhost:9000

## Проверка (smoke-test по плану)

1. **Только Hub**
   - Запустить `./nekkus-hub.exe`.
   - Открыть http://localhost:9000 — должен открыться интерфейс Hub.
   - В списке модулей должен быть **Nekkus Net**, если есть `modules/com.nekkus.net/manifest.json` (он уже в репо).

2. **Hub + nekkus-net (чтобы модуль не только отображался, но и запускался)**
   - Структура каталогов: рядом должны быть папки `nekkus-hub/` и `nekkus-net/` (например, оба внутри `nekkus/`).
   - В `nekkus-hub/modules/com.nekkus.net/` уже лежит `manifest.json` — ничего копировать не нужно.
   - Собрать **nekkus-net**: из каталога `nekkus-net` выполнить `go build -o nekkus-net.exe ./cmd`. Исполняемый файл должен оказаться в корне `nekkus-net/` (Hub ищет его там при разработке).
   - Запустить Hub из каталога `nekkus-hub`: `./nekkus-hub.exe`.
   - В UI Hub: модуль **Nekkus Net** в списке; при необходимости нажать **Rescan**.
   - **Start** — запуск Net в фоне (без своего окна).
   - **Open UI** — запуск Net с окном.
   - **Stop** — остановка Net.
   - API: `curl http://localhost:9000/api/summary` — в ответе должен быть объект с `"id":"com.nekkus.net"`.

3. **Порты**
   - Hub HTTP: по умолчанию 9000.
   - Hub gRPC: 19000.
   - Net при запуске из Hub получает свои порты (из manifest или логики модуля).

## Если `./nekkus-hub.exe` — No such file or directory

- Сборку делайте из каталога, где лежит `cmd/` (корень `nekkus-hub`).
- После `go build -o nekkus-hub.exe ./cmd` файл `nekkus-hub.exe` появляется в текущей директории; оттуда же запускайте `./nekkus-hub.exe` (или полный путь к exe).
