# Grade Optimizer Maya Exporter

## Локальная папка проекта

Корень локального Git-репозитория:

`C:\zGit\GradeOptimizer\Grade_Optimizer`

Папка Maya:

`C:\zGit\GradeOptimizer\Grade_Optimizer\maya`

## Рекомендуемый запуск: Script Editor / Shelf без установки plug-in

Для открытия Exporter **не нужно** устанавливать Maya plug-in, запускать `install_maya_module.bat`, менять `MAYA_MODULE_PATH` или включать Plug-in Manager.

1. Открой Maya → Script Editor.
2. Переключись на вкладку Python.
3. Выполни этот код:

```python
import sys
import os
import importlib

maya_path = r"C:\zGit\GradeOptimizer\Grade_Optimizer\maya"
exporter_file = os.path.join(maya_path, "grade_optimizer_exporter.py")

if not os.path.isfile(exporter_file):
    raise RuntimeError("Не найден файл: " + exporter_file)

if maya_path not in sys.path:
    sys.path.insert(0, maya_path)

import grade_optimizer_exporter
importlib.reload(grade_optimizer_exporter)
grade_optimizer_exporter.show()
```

4. Чтобы создать Shelf-кнопку, выдели весь скрипт в Script Editor и перетащи его средней кнопкой мыши на нужную полку.

На другом компьютере достаточно поменять переменную `maya_path`.

## Создание контрольной FBX-сцены без plug-in

Можно запустить генератор через Script Editor, не загружая настоящий Maya plug-in:

```python
import sys
import importlib

maya_path = r"C:\zGit\GradeOptimizer\Grade_Optimizer\maya"
if maya_path not in sys.path:
    sys.path.insert(0, maya_path)

import grade_optimizer_test_scene
importlib.reload(grade_optimizer_test_scene)
grade_optimizer_test_scene.create_test_scene()
```

Генератор создаёт вложенную сцену для проверки FBX hierarchy, общих материалов, двух material slots на одном mesh, скрытого объекта, повторяющихся имён DAG и nodeMetadata. Он заменит текущую сцену только после подтверждения диалога. Сохрани рабочую сцену заранее.

## Настройки Exporter

- **Git repo** — корень локального клона GitHub, по умолчанию `C:/zGit/GradeOptimizer/Grade_Optimizer`.
- Отдельный Project ID вводить не нужно: Exporter автоматически находит единственный файл `clients/<slug>/scene.json` в репозитории. Если клиентских сцен несколько, экспорт останавливается, чтобы не записать модель не в тот проект.
- Экспортируется только выделенная ветка Maya и её дочерние mesh-объекты. Пустое выделение блокирует экспорт.
- Выбранная группа экспортируется как самостоятельная FBX-модель в `clients/<slug>/models/<asset-id>.fbx`. Запись автоматически добавляется в массив `assets` клиентского `scene.json`.
- Повторный экспорт объекта с тем же именем обновляет его отдельный FBX-файл. Другие объекты и базовая поверхность не затрагиваются.
- **`assets/real-terrain.fbx` и `assets/real-terrain.json` никогда не перезаписываются этим Exporter.** Чтобы поменять базовый рельеф, это должно быть отдельное явное действие в Web Editor.
- Масштаб FBX автоматически переводится из текущих единиц Maya в метры через transform модели в `scene.json`.
- Включён экспорт FBX materials и Embed Media. Рекомендуемый предел FBX для обычного Git workflow — 90 MiB.

## Метки отдельных узлов

Разметка объектов находится в сворачиваемом разделе **Разметка объектов** и по умолчанию скрыта, чтобы не загромождать Exporter.

Ручной ввод для обычной работы не нужен:

1. Выдели в Maya один или несколько объектов / групп.
2. Выбери готовый тип в списке: Рельеф, Здание, Станция, Подъёмник / опора, Дорога / площадка, Вода, Скала / препятствие, Растительность или Другое.
3. Нажми **Применить к выделению**.

Пресет задаёт только Role и стандартные Tags. **Collision и Forest blocker настраиваются в Web Editor** на конкретном узле в Outliner Inspector — Maya Exporter эти флаги не выставляет. Последний выбранный пресет запоминается в настройках Maya и восстанавливается при следующем открытии Exporter.

В сворачиваемом разделе **Дополнительно: свои Role / Tags** можно задать собственный Role и дополнительные теги. Эти поля также запоминаются. Кнопка **Очистить метки** удаляет метаданные у выделенных узлов.

Project ID и Git repo тоже сохраняются между запусками Exporter. Их достаточно задать один раз и менять только при переходе к другому проекту.

Экспортёр записывает Role / Tags в `nodeMetadata` внутри клиентского `scene.json`. Web Outliner применяет метки к соответствующим узлам по пути имён в Maya hierarchy. В редакторе на том же узле можно отдельно включить `Collision hint` и `Forest blocker hint`; эти флаги также записываются в `nodeMetadata` и сохраняются при публикации клиентской сцены. На текущем этапе они хранятся как настройки проекта, но ещё не запускают физику столкновений или алгоритм размещения леса автоматически.

## Результат экспорта

Например, для группы `Slopes_Stage1`:

```
clients/
  alpine-resort/
    scene.json
    models/
      slopes_stage1.fbx
```

В `scene.json` объект регистрируется как отдельная геометрия категории `slope`, фазы `stage_1` и с `activeTerrain: false`. Он остаётся видимым рядом с исходной поверхностью и может использоваться лыжником как отдельная piste-геометрия.

После экспорта открой GitHub Desktop, проверь оба изменённых файла (`models/*.fbx` и `scene.json`), сделай Commit и Push.

Ссылка проекта: `https://kortul.github.io/Grade_Optimizer/?client=alpine-resort`.

## Необязательный вариант: установка нативного Maya plug-in

Нативный plug-in добавляет меню **Grade Optimizer** с пунктами **Open Exporter…** и **Create FBX Test Scene…**. Он не требуется для обычного Shelf workflow выше.

Для установки:
1. Закрой Maya.
2. Запусти `C:\zGit\GradeOptimizer\Grade_Optimizer\maya\\install_maya_module.bat`.
3. Запусти Maya заново.
4. В Windows → Settings/Preferences → Plug-in Manager включи `grade_optimizer.py` под Loaded и Auto load.

