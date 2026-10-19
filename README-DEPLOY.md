# SSGO Web v0.44

## Исправления
- 3D-подписи теперь создаются корректно: исправлено сравнение координат станций (eng.C хранит [x,z], а не [x,y,z]).
- Подписи — Sprite с depthTest:false: гарантированно видны поверх рельефа.
- Если в A1.curves.json есть centre_stations/left_stations/right_stations, веб использует точные Maya-станции без ресемплинга.
- Профиль оси — из высот рельефа, как в Maya.
- Crossfall: design принимает долю, ручной режим делит проценты один раз.

## Maya v17.24 (нужно для точных станций)
В UI.run() после строки `LAST_RESULT.update(out);` добавьте:
    out["stations"] = {"centre": centre, "left": left, "right": right}
В export_web() после формирования data добавьте:
    if LAST_RESULT and "stations" in LAST_RESULT:
        data["centre_stations"] = LAST_RESULT["stations"]["centre"]
        data["left_stations"] = LAST_RESULT["stations"]["left"]
        data["right_stations"] = LAST_RESULT["stations"]["right"]
Затем ЗАПУСК + экспорт для веба: в A1.curves.json появятся точные 94 станции.
