# SSGO Web v0.46

## Исправление ошибки v0.45
Ошибка "Cannot read properties of undefined (reading '0')" возникала в блоке подписей:
использовались поля r.center_point/left_point/right_point, а в движке они называются
r.centerPoint/leftPoint/rightPoint. Теперь используется правильный camelCase и индекс станции
r.station (он уже содержит индекс из labelRows).

## Подписи
Возвращён стиль v26: спрайты 384x96 с полупрозрачной подложкой.

## Движок
- Профиль оси из высот рельефа (как в Maya).
- Crossfall: design принимает долю; ручной режим делит проценты один раз.
- Точные Maya-станции используются напрямую.
- Оптимизатор offset/crossfall.

## Деплой
index.html + app.v46.js в корень; A1.curves.json от Maya v17.24.
