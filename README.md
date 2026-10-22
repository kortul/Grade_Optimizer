# SSGO web update v39

## Что внутри
- app.v39.js — веб-версия с портом v19.3 (DP zipper, 3 промежуточных кольца, без ear-clip/hole repair).
- SSGO_v19.3-local-offset.py — Maya-версия, на которой основан порт.

## Как обновить Git
1. Замените app.js на app.v39.js (или переименуйте app.v39.js в app.js).
2. Закоммитьте и запушьте.
3. В Maya нажмите «Подготовить и экспортировать для веба» и залейте новые slope1.gltf/.bin/.curves.json (и result/labels, если нужны).

## Проверка
- В логе Maya: CHECK watertight boundary edges = исходным, non-manifold = 0, area ratio ~1.000.
- На сайте: стенки плавные, дырок нет, меш не взрывается.
