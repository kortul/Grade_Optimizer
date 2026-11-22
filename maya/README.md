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
- **Client ID** — slug клиента, например `alpine-resort`.
- По умолчанию экспортируется вся сцена одним FBX с полной иерархией.
- Включён экспорт FBX materials и Embed Media.
- Selection позволяет экспортировать только выделенную ветку.
- Обязательные категории объектов не навязываются.

## Метки отдельных узлов

В секции **Optional Node Metadata** можно добавлять необязательные метаданные к выделенным Maya Transform / Group / Mesh nodes:

- Role — свободное текстовое назначение, например `station`, `gondola`, `terrain`.
- Tags — список через запятую.
- Collision hint.
- Forest blocker hint.

Выдели нужные объекты, заполни метки и нажми **Apply Metadata to Selected Nodes**. Пустые поля и выключенные флаги при повторном применении удалят метаданные с выделения.

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

