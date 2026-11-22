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

В верхнем меню Maya появится **Grade Optimizer** с командами **Open Exporter…** и **Create FBX Test Scene…**. Плагин также регистрирует команду `gradeOptimizerOpen`.

## Что входит

- `plug-ins/grade_optimizer.py` — нативный Maya Python plug-in.
- `GradeOptimizer.mod` — описание Maya module.
- `install_maya_module.bat` / `install_maya_module.ps1` — установка папки модуля в пользовательский `MAYA_MODULE_PATH`.
- `grade_optimizer_exporter.py` — UI и экспорт FBX/manifest.
- `grade_optimizer_test_scene.py` — генератор контрольной Maya-сцены для проверки FBX round-trip.

Путь модуля хранится в пользовательской переменной Windows `MAYA_MODULE_PATH`; установщик добавляет путь и сохраняет существующие Maya module paths.

## Экспорт сцены

- **Git repo** — по умолчанию `C:/zGit/GradeOptimizer/Grade_Optimizer`; можно изменить через Browse.
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

## Контрольная сцена для проверки FBX

В меню Maya выбери **Grade Optimizer → Create FBX Test Scene…**. Maya предупредит, что текущая сцена будет заменена; генератор продолжит только после явного подтверждения.

Контрольная сцена специально проверяет:

- вложенные группы и Transform hierarchy;
- один и тот же Lambert material на Terrain и Station Roof;
- два material slots на одном mesh `Station_Building`;
- скрытый `Hidden_Survey_Marker`;
- одинаковое имя `Pylon` в двух разных ветках DAG и разные метаданные на каждом;
- Role / Tags / Collision / Forest blocker в manifest.

После создания открой Exporter, оставь экспорт всей сцены и укажи Client ID `maya-fbx-test`. После экспорта проверь `clients/maya-fbx-test/scene.json` и импортируй FBX в тестовую страницу. Не отправляй тестовую сцену клиенту: это диагностический fixture.

## Ручной запуск без plug-in

В Maya Script Editor (Python) можно выполнить:

```python
import sys
sys.path.insert(0, r"C:\zGit\GradeOptimizer\maya")
import grade_optimizer_exporter
grade_optimizer_exporter.show()
```
