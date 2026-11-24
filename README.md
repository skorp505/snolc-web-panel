# SNOLC Web

Веб-панель и менеджер сервиса [`snolc`](https://github.com/owenewans/snolc) — модульный пользовательский proxy для Linux.

Панель даёт:

- статус сервиса `snolc run` и установленной версии `snolc`;
- редактирование файла конфигурации `snolc.toml` (с проверкой через `snolc validate`);
- запуск, остановку и перезапуск сервиса;
- лог работы процесса;
- установку и обновление snolc через панель (определение доступных обновлений с GitHub);
- проверку обновлений с показом доступных изменений.

## Установка

```sh
curl -fsSL https://raw.githubusercontent.com/skorp505/snolc-web-panel/main/scripts/install.sh | sudo bash
```

После установки панель доступна по HTTPS по случайному адресу и порту из вывода установщика, логин/пароль печатаются в конце установки. Перед первым входом смените пароль в разделе «Пароль».

По умолчанию сервис слушает `0.0.0.0:<random-port>` и работает со самоподписанным TLS-сертификатом (браузер может предупредить — это нормально).

## Разработка

```sh
pnpm install
pnpm build
CGO_ENABLED=0 go build -o cmd/snolc-web/snolc-web ./cmd/snolc-web
```

## Файлы времени выполнения

- `/etc/snolc-web/config.json` — конфигурация панели;
- `/etc/snolc-web/panel.env` — логин/пароль (`SNOLC_WEB_USER`, `SNOLC_WEB_PASS`);
- `/etc/snolc-web/snolc.toml` — конфигурация snolc, редактируемая из панели;
- `/etc/snolc-web/snolc.pid` — pid работающего `snolc run`;
- `/etc/snolc-web/run.log` — лог работы сервиса;
- `/etc/snolc-web/install.log`, `/etc/snolc-web/update.log` — логи установки.

## Лицензия

Unlicense, как и проект snolc.
