# Grade Optimizer Maya Plug-in

## Установка для папки проекта

Плагин подготовлен под локальную папку:

`C:\zGit\GradeOptimizer`

1. Закрой все открытые окна Maya.
2. После синхронизации репозитория открой `C:\zGit\GradeOptimizer\maya`.
3. Запусти `install_maya_module.bat` обычным двойным кликом. Администратор не нужен.
4. Запусти Maya заново.
5. Открой **Windows → Settings/Preferences → Plug-in Manager**.
6. Найди `grade_optimizer.py`, включи **Loaded** и **Auto load**.

В верхнем меню Maya появится **Grade Optimizer → Open Exporter…**. Плагин также регистрирует команду `gradeOptimizerOpen`.

## Что входит

- `plug-ins/grade_optimizer.py` — нативный Maya Python plug-in.
- `GradeOptimizer.mod` — описание Maya module.
- `install_maya_module.bat` / `install_maya_module.ps1` — установка папки модуля в пользовательский `MAYA_MODULE_PATH`.
- `grade_optimizer_exporter.py` — UI и экспорт FBX/manifest.

Путь модуля хранится в пользовательской переменной Windows `MAYA_MODULE_PATH`; установщик добавляет путь и сохраняет существующие Maya module paths.

## Экспорт сцены

- **Git repo** — по умолчанию `C:/zGit/GradeOptimizer`; можно изменить через Browse.
- **Client ID** — slug клиента, например `alpine-resort`.
- По умолчанию экспортируется вся сцена одним FBX с полной иерархией.
- Включён экспорт материалов и Embed Media.
- Selection позволяет экспортировать только выделенную ветку.
- Обязательные категории объектов не навязываются.

## Метки отдельных узлов

В секции **Optional Node Metadata** можно добавлять необязательные метаданные на выделенные Maya Transform / Group / Mesh nodes:

- Role — свободное текстовое назначение, например `station`, `gondola`, `terrain`.
- Tags — список через запятую.
- Collision hint.
- Forest blocker hint.

Выдели нужные объекты, заполни метки и нажми **Apply Metadata to Selected Nodes**. Если оставить поля пустыми и снять флаги, повторное нажатие удалит метаданные с выделения.

Экспортёр записывает их в `nodeMetadata` внутри клиентского `scene.json`. Web Outliner применяет их к соответствующим узлам по пути имён в Maya hierarchy. Эти поля предназначены для описания сцены и сами по себе не включают физику коллизий или логику леса.

## Результат

```
clients/
  alpine-resort/
    scene.json
    models/
      resort.fbx
```

После экспорта открой GitHub Desktop, проверь изменения, сделай Commit и Push. Ссылка клиента:

`https://kortul.github.io/Grade_Optimizer/?client=alpine-resort`

Держи FBX меньше 90 MiB для текущего обычного Git workflow.

## Ручной запуск без plug-in

В Maya Script Editor (Python) можно выполнить:

```python
import sys
sys.path.insert(0, r"C:\zGit\GradeOptimizer\maya")
import grade_optimizer_exporter
grade_optimizer_exporter.show()
```
