# SSGO Web v0.56

## Срочное исправление v0.55
Ошибка "loader.setURLModifier is not a function": setURLModifier есть у THREE.LoadingManager,
а не у GLTFLoader. Теперь:
- assetManager = new THREE.LoadingManager();
- assetManager.setURLModifier добавляет ?t=<token> к .bin;
- new GLTFLoader(assetManager).

Кэш-bust для A1.bin работает, страница грузится.

## Всё остальное — без изменений с v0.54
- Слайдер "Тени" по умолчанию 2.
- Смещение высот +21.21 во всех подписях и линейке.
- Подложка лейблов 30%, слайдер "Лейблы" (<=10% скрыты).
- Линейка: высоты точек, расстояние, угол, Δh; новое измерение стирает предыдущее.

## Эталон
Maya v17.24 и веб: 14 182 / 12 765 м³, core 13 920 / 11 443, баланс -1 м³.

## Деплой
index.html + app.v56.js в корень; A1.curves.json от Maya v17.24.
На компе со старым кэшем один раз Ctrl+F5.
