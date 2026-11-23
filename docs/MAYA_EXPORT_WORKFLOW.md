# Maya → Grade Optimizer → GitHub Desktop

The Maya exporter detects the only `clients/<slug>/scene.json` in the local repository automatically. No Project ID is requested. If the repository contains more than one client scene, export stops rather than choosing a destination silently.

Only the selected Maya hierarchy and its child meshes are exported. The selected root becomes a separate scene asset:

- `clients/<slug>/models/<asset-id>.fbx`
- `clients/<slug>/scene.json` (the asset is added to or updated in the `assets` array)

Re-exporting a model with the same root name updates that model's FBX only. The base surface pair `assets/real-terrain.fbx` / `assets/real-terrain.json` is never touched by this exporter. Replacing the base terrain must be an explicit, separate action.

Maya linear units are converted to metres through the imported asset's root transform in `scene.json`. For example, a centimetre-based FBX is registered with a scale of `[0.01, 0.01, 0.01]`.

For `Slopes_Stage1`, the exporter creates `models/slopes_stage1.fbx` and registers it as category `slope`, phase `stage_1`, with `activeTerrain: false`. This leaves the original surface visible and lets the skier controller select this piste as its dedicated physics surface.

The optional collapsible Maya metadata panel applies ready-made object presets to selected nodes. Presets set only Role and standard Tags; custom Role and extra Tags remain available in a collapsed advanced subsection. Collision and Forest blocker can be configured in the Web Editor's Outliner Inspector, on the individual node that needs them. The editor stores these flags in `nodeMetadata` in `clients/<slug>/scene.json`.

The FBX contains hierarchy, transforms, geometry and supported material assignments. Semantic metadata is written to the client scene manifest rather than relying on arbitrary custom Maya attributes to survive FBX export.

Open GitHub Desktop, review the changed FBX and `scene.json`, then Commit and Push. This local exporter workflow does not need a browser GitHub token.

## Проверка Maya FBX перед рабочей сценой

После загрузки plug-in выбери **Grade Optimizer → Create FBX Test Scene…**. Это создаст контрольную сцену только после подтверждения замены текущей сцены. Для экспорта теста используй отдельную копию репозитория с единственным `clients/maya-fbx-test/scene.json`: обычный Exporter автоматически находит единственную клиентскую сцену и не принимает Project ID. Затем проверь вложенную иерархию, повторяющиеся имена, общие материалы, два material slots на Station_Building, скрытый узел и nodeMetadata. Этот fixture проверяет обычный Lambert FBX workflow; он не доказывает поддержку сложных Arnold/custom shader networks.

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
