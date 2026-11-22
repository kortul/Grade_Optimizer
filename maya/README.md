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

- **Git repo** — по умолчанию `C:/zGit/GradeOptimizer/Grade_Optimizer`; это корень локального клона GitHub.
- **Project ID** — короткий slug проекта, например `alpine-resort`. Это не GitHub ID и не имя пользователя. Он задаёт папку `clients/alpine-resort/` и параметр ссылки `?client=alpine-resort`. Для нового проекта используй отдельный уникальный slug.
- По умолчанию экспортируются **только выделенные объекты** и их дочерняя иерархия. Флажок включён при каждом открытии Exporter. Если выделение пустое, экспорт останавливается, чтобы случайно не выгрузить всю сцену.
- Чтобы намеренно выгрузить всю сцену, сними флажок **Export selected objects only**.
- Включён экспорт FBX materials и Embed Media.
- Selection позволяет экспортировать только выделенную ветку.
- Обязательные категории объектов не навязываются.

## Метки отдельных узлов

Разметка объектов находится в сворачиваемом разделе **Разметка объектов** и по умолчанию скрыта, чтобы не загромождать Exporter.

Ручной ввод для обычной работы не нужен:

1. Выдели в Maya один или несколько объектов / групп.
2. Выбери готовый тип в списке: Рельеф, Здание, Станция, Подъёмник / опора, Дорога / площадка, Вода, Скала / препятствие, Растительность или Другое.
3. Нажми **Применить к выделению**.

Пресет сам задаёт Role, стандартные Tags и начальные значения Collision / Forest blocker. Флаги можно переключить вручную после выбора пресета. Последний выбранный пресет запоминается в настройках Maya и восстанавливается при следующем открытии Exporter.

В сворачиваемом разделе **Дополнительно: свои Role / Tags** можно задать собственный Role и дополнительные теги. Эти поля также запоминаются. Кнопка **Очистить метки** удаляет метаданные у выделенных узлов.

Project ID и Git repo тоже сохраняются между запусками Exporter. Их достаточно задать один раз и менять только при переходе к другому проекту.

Экспортёр записывает их в `nodeMetadata` внутри клиентского `scene.json`. Web Outliner применяет метки к соответствующим узлам по пути имён в Maya hierarchy. Эти поля описательные и сами по себе не включают физику коллизий или логику леса.

## Результат экспорта

```
clients/
  alpine-resort/
    scene.json
    models/
      resort.fbx
```

После экспорта открой GitHub Desktop, проверь изменения, сделай Commit и Push.

Ссылка клиента:

`https://kortul.github.io/Grade_Optimizer/?client=alpine-resort`

Держи FBX меньше 90 MiB для текущего обычного Git workflow.

## Необязательный вариант: установка нативного Maya plug-in

Нативный plug-in добавляет меню **Grade Optimizer** с пунктами **Open Exporter…** и **Create FBX Test Scene…**. Он не требуется для обычного Shelf workflow выше.

Для установки:
1. Закрой Maya.
2. Запусти `C:\zGit\GradeOptimizer\Grade_Optimizer\maya\\install_maya_module.bat`.
3. Запусти Maya заново.
4. В Windows → Settings/Preferences → Plug-in Manager включи `grade_optimizer.py` под Loaded и Auto load.

