# Maya → Grade Optimizer → GitHub Desktop

The native Maya Python plug-in is delivered as an installable Maya module for the local project folder:

`C:\zGit\GradeOptimizer\Grade_Optimizer`

Run `maya/install_maya_module.bat` once, restart Maya, then enable `grade_optimizer.py` with **Loaded** and **Auto load** in Plug-in Manager. The **Grade Optimizer** menu opens the exporter.

The exporter is launched directly from Maya Script Editor / Shelf; installing the native plug-in is optional.

Default behavior is **selected objects only**. The checkbox starts enabled every time the exporter opens. If nothing is selected, export is blocked rather than silently exporting the whole resort. Disable the checkbox only when a full-scene export is intentional.

The field shown as **Project ID** is a short project slug (for example `alpine-resort`), not a GitHub account ID. It selects the folder `clients/<slug>/` and the public URL query parameter `?client=<slug>`. The Project ID and Git repository path are remembered between Maya sessions.

The exporter writes one FBX and one client manifest:

- `clients/<slug>/models/resort.fbx`
- `clients/<slug>/scene.json`

The optional collapsible Maya metadata panel applies ready-made object presets to selected nodes. Presets set only Role and standard Tags; custom Role and extra Tags remain available in a collapsed advanced subsection. Collision and Forest blocker are deliberately configured in the Web Editor's Outliner Inspector, on the individual node that needs them. The editor stores these flags in `nodeMetadata` in `clients/<slug>/scene.json`. `collectClientManifest()` serializes the per-node flags, and **Publish Client Workspace** commits the updated manifest (and any dirty model file) to GitHub. Existing schema 1.0 client scenes without `nodeMetadata` remain compatible. These flags are currently stored as project metadata; automatic collision simulation and forest placement behavior still need implementation.

The FBX contains hierarchy, transforms, geometry and supported material assignments. Semantic metadata is written to the JSON manifest rather than relying on arbitrary custom Maya attributes to survive FBX export.

Open GitHub Desktop, review the changed client files, Commit and Push. This local exporter workflow does not need a browser GitHub token.

## Проверка Maya FBX перед рабочей сценой

После загрузки plug-in выбери **Grade Optimizer → Create FBX Test Scene…**. Это создаст контрольную сцену только после подтверждения замены текущей сцены. Экспортируй её под Project ID `maya-fbx-test`, затем проверь вложенную иерархию, повторяющиеся имена, общие материалы, два material slots на Station_Building, скрытый узел и nodeMetadata. Этот fixture проверяет обычный Lambert FBX workflow; он не доказывает поддержку сложных Arnold/custom shader networks.

## Запуск без установки Maya plug-in

Пользователь может запускать exporter прямо из Maya Script Editor / Shelf через импорт `grade_optimizer_exporter`; для этого достаточно добавить локальную папку `C:\zGit\GradeOptimizer\Grade_Optimizer\maya` в `sys.path`. Plug-in Manager, `MAYA_MODULE_PATH` и запуск установщика не требуются. Полный Python snippet и Shelf instructions находятся в `maya/README.md`.


## Общие настройки Scene Editor — хранение в проекте

Открой нужную клиентскую сцену по Project ID и подключи GitHub Publisher. Кнопка **SAVE ALL PROJECT CHANGES TO GITHUB** создаёт commit непосредственно в `kortul/Grade_Optimizer`; промежуточный JSON вручную скачивать или копировать не нужно.

В `clients/<slug>/scene.json` хранятся:
- клиентские модели и их категории, фазы, root transforms, видимость, collision / forest flags;
- nested node visibility и Role / Tags / Collision / Forest blocker каждого узла;
- настройки встроенной сцены приложения в `editorSettings.assets`: трансформации, видимость, node metadata, PBR-параметры и пользовательские карты текстур;
- параметры материалов и загруженные пользователем текстуры.

После commit данные становятся частью проекта в GitHub и загружаются при открытии той же клиентской ссылки в другом браузере / на другом устройстве. Кнопка сохранения требует активного GitHub Publisher token с Contents: Read and write; token хранится только в памяти текущей вкладки. Без нажатия Save/Publish изменения текущего сеанса остаются черновиком браузера.
