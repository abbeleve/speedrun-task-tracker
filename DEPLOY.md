# Развёртывание на голом сервере (bare metal / VPS)

Здесь описан полный пошаговый деплой на чистый Ubuntu-сервер (подойдёт любой
VPS с Ubuntu 22.04/24.04, достаточно 1 vCPU и 1 ГБ RAM).

## Архитектура

```
Интернет ──> Nginx (порт 80/443)
               ├── /            → статика из frontend/dist (React SPA)
               └── /api/*       → прокси на 127.0.0.1:8000 (FastAPI/Uvicorn)

Uvicorn (systemd: speedrun-backend)  →  SQLite файл (backend/data/tracker.db)
```

- **Фронтенд** — React/Vite, собирается в статические файлы (`frontend/dist`),
  раздаётся Nginx'ом.
- **Бэкенд** — FastAPI под Uvicorn, все данные в одном SQLite-файле.
- Всё на одном сервере, один домен. Токен авторизации живёт в `localStorage`
  браузера и летает в заголовке `Authorization: Bearer ...`.

---

## 1. Базовые требования

На сервере нужны `git`, `nginx`, `python3` + `venv`, `nodejs` + `npm`.

```bash
sudo apt update
sudo apt install -y git nginx python3 python3-venv python3-pip curl
```

Node.js лучше поставить через NodeSource / nvm (чтобы версия была свежая):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # должно быть >= 20
```

## 2. Клонируем репозиторий

Создаём отдельного пользователя (без sudo) для запуска сервиса:

```bash
sudo useradd -m -s /bin/bash speedrun
sudo -u speedrun git clone <url-вашего-репозитория> /home/speedrun/app
```

Дальше все команды выполняем под этим пользователем, если не указано иначе.

## 3. Бэкенд (FastAPI + Uvicorn)

```bash
cd /home/speedrun/app/backend

# виртуальное окружение
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# каталог с БД (backend/data уже проигнорирован в git)
mkdir -p data

# быстрая проверка, что всё поднимается и API отвечает
DATABASE_PATH=/home/speedrun/app/backend/data/tracker.db \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Проверьте в отдельном терминале: `curl http://127.0.0.1:8000/api/health` →
`{"status":"ok"}`. После проверки остановите (Ctrl-C).

### systemd-сервис

Создайте файл `/etc/systemd/system/speedrun-backend.service`:

```ini
[Unit]
Description=SpeedRun Task Tracker backend (FastAPI)
After=network.target

[Service]
User=speedrun
Group=speedrun
WorkingDirectory=/home/speedrun/app/backend
Environment=DATABASE_PATH=/home/speedrun/app/backend/data/tracker.db
ExecStart=/home/speedrun/app/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Запускаем и проверяем:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now speedrun-backend
sudo systemctl status speedrun-backend
curl http://127.0.0.1:8000/api/health
```

## 4. Фронтенд (сборка)

```bash
cd /home/speedrun/app/frontend
npm ci
npm run build    # создаст dist/
```

Собранная статика появится в `frontend/dist`.

## 5. Nginx

Создайте конфиг `/etc/nginx/sites-available/speedrun` (замените
`tracker.example.com` на ваш домен или IP сервера):

```nginx
server {
    listen 80;
    server_name tracker.example.com;

    # корень со статикой фронтенда
    root /home/speedrun/app/frontend/dist;
    index index.html;

    # SPA-фоллбэк: любой не-API путь отдаёт index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API — проксируем на FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # статика кэшируется долго, index.html — нет
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Включите сайт и перезапустите Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/speedrun /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Теперь по адресу `http://tracker.example.com` открывается приложение, а API
работает на том же домене по пути `/api`.

### HTTPS (рекомендуется — иначе token будет летать открыто)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tracker.example.com
```

## 6. Фаервол

Если используется `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw enable
```

## 7. Бэкапы

Вся база — один файл. Достаточно регулярно копировать его (например, в cron
каждую ночь):

```bash
sudo crontab -e
# 30 3 * * * cp /home/speedrun/app/backend/data/tracker.db /home/speedrun/backups/tracker-$(date +\%F).db
```

Восстановление — просто вернуть файл и перезапустить сервис.

## 8. Как обновлять приложение

```bash
cd /home/speedrun/app
sudo -u speedrun git pull

# бэкенд: обновить зависимости и перезапустить
cd backend
sudo -u speedrun .venv/bin/pip install -r requirements.txt
sudo systemctl restart speedrun-backend

# фронтенд: пересобрать статику
cd ../frontend
sudo -u speedrun npm ci
sudo -u speedrun npm run build
```

Схема БД создаётся автоматически при старте (`CREATE TABLE IF NOT EXISTS`),
отдельных миграций для простых обновлений не требуется.

## Проверка после деплоя

```bash
curl http://127.0.0.1:8000/api/health              # {"status":"ok"}
curl -I https://tracker.example.com/                # HTTP 200
# Через браузер: регистрация → вход → работа со спринтами и статистикой.
```

## Типовые проблемы

- **502 от Nginx** — бэкенд не запущен: `journalctl -u speedrun-backend -e`.
- **Страница открывается, но данные не грузятся** — проверьте `/api` в консоли
  браузера (Network) и права на `backend/data`.
- **500 при записи** — нет прав на каталог БД у пользователя `speedrun`:
  `chown -R speedrun:speedrun /home/speedrun/app/backend/data`.

## 9. Автодеплой (CI/CD через GitHub Actions)

Workflow `.github/workflows/deploy.yml` на каждый push в ветку `master`:
прогоняет тесты бэкенда и фронтенда, собирает фронт **на раннере GitHub**
(сервер не тратит на это CPU/RAM), затем по SSH заливает готовый `dist/` на
сервер, обновляет бэкенд и перезапускает сервис.

Ветка/пути в workflow рассчитаны на этот деплой
(`/home/deploy/speedrun-task-tracker`, venv `.venv`, сервис
`speedrun-task-tracker`) — поправьте их под себя, если раскладка другая.

### 9.1. SSH-ключ для деплоя

На локальной машине:

```bash
ssh-keygen -t ed25519 -f deploy_key -C "github-actions" -N ""
```

Публичный ключ добавьте на сервер пользователю `deploy`:

```bash
# содержимое deploy_key.pub:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys <<'KEY'
<вставьте сюда deploy_key.pub>
KEY
chmod 600 ~/.ssh/authorized_keys
```

Приватный ключ (`deploy_key`) целиком — в секрет GitHub (см. ниже). В git его
**не коммитить** (`deploy_key` и `deploy_key.pub` уже в `.gitignore`).

### 9.2. Секреты GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Имя секрета | Значение |
| ----------- | -------- |
| `SSH_HOST`  | IP или домен сервера (напр. `194.87.111.40`) |
| `SSH_USER`  | `deploy` |
| `SSH_PRIVATE_KEY` | содержимое файла `deploy_key` (весь текст, от `-----BEGIN` до `-----END`) |

### 9.3. sudo без пароля (для перезапуска сервиса)

Деплой выполняет `sudo systemctl restart speedrun-task-tracker`. Чтобы это
работало по SSH без пароля, на **сервере** добавьте правило:

```bash
echo 'deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart speedrun-task-tracker, /bin/systemctl status speedrun-task-tracker' \
  | sudo tee /etc/sudoers.d/speedrun-deploy
sudo chmod 440 /etc/sudoers.d/speedrun-deploy
sudo visudo -c    # проверка синтаксиса
```

### 9.4. Как теперь деплоить

```bash
git add -A
git commit -m "..."
git push origin master
```

Дальше всё само: тесты → сборка → выкладка → рестарт. Прогресс видно во вкладке
**Actions** репозитория.

