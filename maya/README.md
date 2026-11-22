# Grade Optimizer Maya Exporter

## Запуск

1. Открой `maya/grade_optimizer_exporter.py` в Maya → Script Editor.
2. Выбери вкладку Python и выполни файл.
3. Вызови:

```python
show()
```

Если Maya не видит файл как модуль, открой его напрямую через Script Editor и выполни целиком.

## Экспорт

- **Git repo** — локальная папка клона `Grade_Optimizer`, которую отслеживает GitHub Desktop.
- **Client ID** — slug клиента, например `alpine-resort`.
- По умолчанию экспортируется вся сцена одним FBX. Опция Selection позволяет экспортировать только выделенные объекты.
- FBX включает Embed Media.

Структура:

```
clients/
  alpine-resort/
    scene.json
    models/
      resort.fbx
```

Категории не обязательны: весь импортированный файл получает роль General model. Имена mesh-объектов, иерархия и назначения материалов остаются внутри FBX. В веб-редакторе материал отображается как `mesh name · material name`.

После экспорта открой GitHub Desktop, проверь изменения, сделай Commit и Push. Ссылка клиента:

`https://kortul.github.io/Grade_Optimizer/?client=alpine-resort`

Держи FBX меньше 90 MiB для текущего обычного Git workflow.
