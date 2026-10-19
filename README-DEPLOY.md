# SSGO Web v0.40

## Изменения
- crossfall корректно переводится из процентов в долю.
- offset — вертикальный сдвиг профиля, как в Maya.
- Кривые сглаживаются Catmull-Rom и ресемплируются равномерно по длине, как в Maya.
- Добавлены полный evaluate/score и оптимизатор offset/crossfall.
- Кнопка «ОПТИМИЗИРОВАТЬ offset / crossfall».
- Дефолт A1: offset=-0.75, crossfall=+0.264%, usable=90%.

## Деплой
Загрузите в корень репозитория:
- index.html
- app.v40.js

Папку assets/ не менять. Старые app.v25–v39.js и main.js удалить.
