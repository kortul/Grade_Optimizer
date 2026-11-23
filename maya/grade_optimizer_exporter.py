# -*- coding: utf-8 -*-
"""
Grade Optimizer Exporter for Autodesk Maya.
Exports the selected Maya hierarchy as a separate client scene asset in a local Git working copy.
Run in Maya's Python Script Editor.
"""
import os
import re
import json
import datetime

import maya.cmds as cmds
import maya.mel as mel

WINDOW = "GradeOptimizerExporter"
VERSION = "0.4.0"
MAYA_LINEAR_UNIT_TO_METERS = {
    "mm": 0.001, "cm": 0.01, "m": 1.0, "km": 1000.0,
    "in": 0.0254, "ft": 0.3048, "yd": 0.9144
}

# Maya optionVars keep the export settings and last-used metadata preset between
# Script Editor / Shelf launches, so users do not have to re-enter them.
OPTION_REPO = "gradeOptimizerRepoPath"
OPTION_PRESET = "gradeOptimizerMetadataPreset"
OPTION_CUSTOM_ROLE = "gradeOptimizerCustomRole"
OPTION_EXTRA_TAGS = "gradeOptimizerExtraTags"
PRESET_PLACEHOLDER = "— Выбрать тип объекта —"

METADATA_PRESETS = {
    "Рельеф": {
        "role": "terrain", "tags": ["terrain", "ground"]
    },
    "Здание": {
        "role": "building", "tags": ["building", "structure"]
    },
    "Станция": {
        "role": "station", "tags": ["station", "building"]
    },
    "Подъёмник / опора": {
        "role": "lift", "tags": ["lift", "transport", "support"]
    },
    "Дорога / площадка": {
        "role": "road", "tags": ["road", "access"]
    },
    "Вода": {
        "role": "water", "tags": ["water"]
    },
    "Скала / препятствие": {
        "role": "obstacle", "tags": ["rock", "obstacle"]
    },
    "Растительность": {
        "role": "vegetation", "tags": ["vegetation"]
    },
    "Другое": {
        "role": "object", "tags": ["object"]
    }
}


def safe_path(path):
    return os.path.abspath(path).replace("\\", "/")


def collect_meshes(selection_only=False):
    selection = cmds.ls(selection=True, long=True) or []
    result = []
    seen = set()
    for shape in cmds.ls(type="mesh", long=True) or []:
        try:
            if cmds.getAttr(shape + ".intermediateObject"):
                continue
        except Exception:
            pass
        parents = cmds.listRelatives(shape, parent=True, fullPath=True) or []
        if not parents:
            continue
        transform = parents[0]
        if selection_only and not any(
            transform == item
            or transform.startswith(item.rstrip("|") + "|")
            or item.startswith(transform.rstrip("|") + "|")
            for item in selection
        ):
            continue
        if transform in seen:
            continue
        seen.add(transform)
        materials = []
        for sg in cmds.listConnections(shape, type="shadingEngine") or []:
            for shader in cmds.listConnections(
                sg + ".surfaceShader", source=True, destination=False
            ) or []:
                if shader not in materials:
                    materials.append(shader)
        result.append({
            "dagPath": transform,
            "name": transform.rsplit("|", 1)[-1],
            "shape": shape.rsplit("|", 1)[-1],
            "materials": materials
        })
    return result


def _attribute_value(node, attribute, default=None):
    try:
        if cmds.attributeQuery(attribute, node=node, exists=True):
            return cmds.getAttr(node + "." + attribute)
    except Exception:
        pass
    return default


def _node_name_path(dag_path):
    return [part for part in str(dag_path).split("|") if part]


def _selected_node_matches(node, selection):
    return any(
        node == item
        or node.startswith(item.rstrip("|") + "|")
        or item.startswith(node.rstrip("|") + "|")
        for item in selection
    )


def collect_node_metadata(selection_only=False):
    selection = cmds.ls(selection=True, long=True) or []
    records = []
    for node in cmds.ls(type="transform", long=True) or []:
        if selection_only and not _selected_node_matches(node, selection):
            continue
        role = str(_attribute_value(node, "goRole", "") or "").strip()
        raw_tags = str(_attribute_value(node, "goTags", "") or "")
        tags = [item.strip() for item in raw_tags.split(",") if item.strip()]
        # Collision and Forest blocker are configured per node in the Web Editor.
        if not (role or tags):
            continue
        records.append({
            "name": node.rsplit("|", 1)[-1],
            "namePath": _node_name_path(node),
            "role": role,
            "tags": tags
        })
    return records


def _set_string_attribute(node, attribute, value):
    if not cmds.attributeQuery(attribute, node=node, exists=True):
        cmds.addAttr(node, longName=attribute, dataType="string")
    cmds.setAttr(node + "." + attribute, str(value or ""), type="string")


def _selected_transforms():
    selection = cmds.ls(selection=True, long=True) or []
    transforms = []
    seen = set()
    for item in selection:
        node = str(item).split(".", 1)[0]
        try:
            if cmds.nodeType(node) not in ("transform", "joint"):
                parents = cmds.listRelatives(node, parent=True, fullPath=True) or []
                if parents:
                    node = parents[0]
        except Exception:
            continue
        if node and node not in seen and cmds.objExists(node):
            if cmds.nodeType(node) in ("transform", "joint"):
                transforms.append(node)
                seen.add(node)
    return transforms


def _option_string(name, default=""):
    try:
        if cmds.optionVar(exists=name):
            value = cmds.optionVar(query=name)
            return str(value) if value is not None else default
    except Exception:
        pass
    return default


def _remember_option(name, value):
    try:
        cmds.optionVar(stringValue=(name, str(value or "")))
    except Exception as exc:
        cmds.warning("[Grade Optimizer] Could not remember setting %s: %s" % (name, exc))


def remember_export_settings(*_):
    try:
        repo = cmds.textFieldButtonGrp(WINDOW + "_repo", query=True, text=True).strip()
        _remember_option(OPTION_REPO, repo)
    except Exception:
        pass


def remember_custom_metadata(*_):
    try:
        custom_role = cmds.textFieldGrp(WINDOW + "_custom_role", query=True, text=True).strip()
        extra_tags = cmds.textFieldGrp(WINDOW + "_extra_tags", query=True, text=True).strip()
        _remember_option(OPTION_CUSTOM_ROLE, custom_role)
        _remember_option(OPTION_EXTRA_TAGS, extra_tags)
    except Exception:
        pass


def on_metadata_preset_changed(*_):
    try:
        label = cmds.optionMenuGrp(WINDOW + "_preset", query=True, value=True)
        _remember_option(OPTION_PRESET, label)
        # Presets define Role / Tags only; simulation hints are edited in Web Editor.
        pass
    except Exception as exc:
        cmds.warning("[Grade Optimizer] Metadata preset update failed: " + str(exc))


def apply_metadata_to_selection(*_):
    transforms = _selected_transforms()
    if not transforms:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Сначала выдели один или несколько объектов или групп в Maya.",
            button=["OK"]
        )
        return

    preset_label = cmds.optionMenuGrp(WINDOW + "_preset", query=True, value=True)
    preset = METADATA_PRESETS.get(preset_label)
    custom_role = cmds.textFieldGrp(WINDOW + "_custom_role", query=True, text=True).strip()
    extra_tags = cmds.textFieldGrp(WINDOW + "_extra_tags", query=True, text=True).strip()
    if not preset and not (custom_role or extra_tags):
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Выбери готовый тип объекта или укажи свои метки в разделе «Дополнительно».",
            button=["OK"]
        )
        return

    # A standard preset always wins. Custom Role is used only with the
    # placeholder selected, preventing stale custom text from overriding presets.
    role = (preset or {}).get("role", "") if preset else custom_role
    tags = list((preset or {}).get("tags", []))
    tags.extend(item.strip() for item in extra_tags.split(",") if item.strip())
    tags = list(dict.fromkeys(tags))
    for node in transforms:
        _set_string_attribute(node, "goRole", role)
        _set_string_attribute(node, "goTags", ",".join(tags))

    remember_export_settings()
    remember_custom_metadata()
    message = "Пресет «%s» применён к %d выделенным узлам." % (
        preset_label if preset else "Свои метки", len(transforms)
    )
    cmds.confirmDialog(title="Grade Optimizer · Metadata", message=message, button=["OK"])
    print("[Grade Optimizer] " + message)


def clear_metadata_from_selection(*_):
    transforms = _selected_transforms()
    if not transforms:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Сначала выдели объекты или группы, у которых нужно очистить метки.",
            button=["OK"]
        )
        return
    for node in transforms:
        for attribute in ("goRole", "goTags", "goCollision", "goForestBlocker"):
            try:
                if cmds.attributeQuery(attribute, node=node, exists=True):
                    cmds.deleteAttr(node, attribute=attribute)
            except Exception:
                pass
    message = "Метки очищены у %d выделенных узлов." % len(transforms)
    cmds.confirmDialog(title="Grade Optimizer · Metadata", message=message, button=["OK"])
    print("[Grade Optimizer] " + message)


def enable_fbx():
    try:
        if not cmds.pluginInfo("fbxmaya", query=True, loaded=True):
            cmds.loadPlugin("fbxmaya", quiet=True)
    except Exception as exc:
        raise RuntimeError("Не удалось загрузить FBX-плагин fbxmaya: " + str(exc))


def set_option(command):
    try:
        mel.eval(command)
    except Exception as exc:
        cmds.warning("FBX option skipped: " + command + " — " + str(exc))


def _safe_asset_id(value):
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip())
    slug = slug.strip("._-").lower()
    return slug or "maya_asset"


def find_client_scene_manifest(repo):
    clients_dir = os.path.join(repo, "clients")
    matches = []
    if os.path.isdir(clients_dir):
        for slug in sorted(os.listdir(clients_dir)):
            scene_path = os.path.join(clients_dir, slug, "scene.json")
            if os.path.isfile(scene_path):
                matches.append((slug, scene_path))

    if not matches:
        raise RuntimeError(
            "В clients/ не найден scene.json. Сначала создай клиентскую сцену в Web Editor."
        )
    if len(matches) != 1:
        names = ", ".join(item[0] for item in matches)
        raise RuntimeError(
            "Найдено несколько клиентских сцен: " + names
            + ". Экспорт остановлен, чтобы не записать геометрию не в тот проект."
        )
    return matches[0]


def prepare_client_asset_export(repo, components, node_metadata):
    client_slug, scene_path = find_client_scene_manifest(repo)
    with open(scene_path, "r", encoding="utf-8") as stream:
        manifest = json.load(stream)
    if not isinstance(manifest, dict):
        raise RuntimeError("Клиентский scene.json должен содержать JSON-объект.")

    assets = manifest.get("assets", [])
    if not isinstance(assets, list):
        raise RuntimeError("Поле assets в клиентском scene.json должно быть массивом.")

    selected = _selected_transforms()
    asset_name = (
        selected[0].rsplit("|", 1)[-1]
        if selected
        else str(components[0].get("name") or "Maya Asset")
    )
    base_id = _safe_asset_id(asset_name)

    asset_id = base_id
    suffix = 2
    while True:
        existing = next(
            (item for item in assets if isinstance(item, dict) and item.get("id") == asset_id),
            None
        )
        relative_file = "models/" + asset_id + ".fbx"
        model_path = os.path.join(os.path.dirname(scene_path), "models", asset_id + ".fbx")
        if existing or not os.path.exists(model_path):
            break
        asset_id = base_id + "_" + str(suffix)
        suffix += 1

    linear_unit = str(cmds.currentUnit(query=True, linear=True) or "").strip().lower()
    meters_per_unit = MAYA_LINEAR_UNIT_TO_METERS.get(linear_unit)
    if meters_per_unit is None:
        raise RuntimeError(
            "Неизвестная линейная единица Maya: " + (linear_unit or "не указана")
        )

    lower_name = asset_name.lower()
    is_slope = "slope" in lower_name or "piste" in lower_name
    is_stage_one = "stage1" in lower_name or "stage_1" in lower_name
    category = "slope" if is_slope else "prop"
    phase = "stage_1" if is_stage_one else "always"

    serialized_node_metadata = []
    for record in node_metadata:
        serialized_node_metadata.append({
            "namePath": record.get("namePath", []),
            "role": record.get("role", ""),
            "tags": record.get("tags", []),
            "collision": False,
            "forestBlocker": False
        })

    entry = dict(existing or {})
    if not existing:
        entry.update({
            "category": category,
            "phase": phase,
            "visible": True,
            "collision": False,
            "forestBlocker": is_slope,
            "activeTerrain": False,
            "transform": {
                "position": [0, 0, 0],
                "rotation": [0, 0, 0],
                "scale": [meters_per_unit, meters_per_unit, meters_per_unit]
            },
            "nodeVisibility": [],
            "nodeMetadata": []
        })

    entry.update({
        "id": asset_id,
        "name": asset_name,
        "file": relative_file,
        "sourceFile": cmds.file(query=True, sceneName=True, shortName=True) or "",
        "mayaExport": {
            "pluginVersion": VERSION,
            "sourceScene": cmds.file(query=True, sceneName=True, shortName=True) or "",
            "mayaVersion": cmds.about(version=True),
            "linearUnit": linear_unit,
            "metersPerUnit": meters_per_unit,
            "meshComponentCount": len(components),
            "components": components
        }
    })
    if serialized_node_metadata:
        entry["nodeMetadata"] = serialized_node_metadata

    manifest["schemaVersion"] = manifest.get("schemaVersion") or "1.0"
    manifest["clientId"] = client_slug
    manifest["updatedAt"] = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    manifest["assets"] = [
        item for item in assets
        if not (isinstance(item, dict) and item.get("id") == asset_id)
    ] + [entry]

    client_dir = os.path.dirname(scene_path)
    model_path = os.path.join(client_dir, *relative_file.split("/"))
    model_dir = os.path.dirname(model_path)
    if not os.path.isdir(model_dir):
        os.makedirs(model_dir)

    temporary_model_path = os.path.join(model_dir, asset_id + ".exporting.fbx")
    temporary_manifest_path = scene_path + ".exporting.tmp"
    return {
        "client_slug": client_slug,
        "asset_id": asset_id,
        "asset_name": asset_name,
        "relative_file": relative_file,
        "model_path": model_path,
        "temporary_model_path": temporary_model_path,
        "manifest_path": scene_path,
        "temporary_manifest_path": temporary_manifest_path,
        "manifest": manifest
    }


def write_client_asset_manifest(export_info, model_size):
    manifest = export_info["manifest"]
    entry = next(
        item for item in manifest["assets"]
        if isinstance(item, dict) and item.get("id") == export_info["asset_id"]
    )
    entry["mayaExport"]["modelSizeBytes"] = model_size
    path = export_info["temporary_manifest_path"]
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return path

def browse_repo(*_):
    result = cmds.fileDialog2(fileMode=3, caption="Выбери корень локального репозитория Grade Optimizer")
    if result:
        cmds.textFieldButtonGrp(WINDOW + "_repo", edit=True, text=result[0])
        remember_export_settings()


def export_scene(*_):
    repo = cmds.textFieldButtonGrp(WINDOW + "_repo", query=True, text=True).strip()
    remember_export_settings()

    if not os.path.isdir(repo):
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Укажи существующую локальную папку репозитория.",
            button=["OK"]
        )
        return
    if not os.path.isfile(os.path.join(repo, "index.html")) or not os.path.isdir(os.path.join(repo, "assets")):
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Выбери корень репозитория Grade_Optimizer — папку с index.html и assets.",
            button=["OK"]
        )
        return

    previous_selection = cmds.ls(selection=True, long=True) or []
    if not previous_selection:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Сначала выдели корневую группу или один/несколько mesh-объектов.",
            button=["OK"]
        )
        return

    components = collect_meshes(selection_only=True)
    node_metadata = collect_node_metadata(selection_only=True)
    if not components:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="В выделении не найдено polygon mesh объектов. Выдели группу или её mesh.",
            button=["OK"]
        )
        return

    export_info = None
    temporary_paths = []
    try:
        export_info = prepare_client_asset_export(repo, components, node_metadata)
        temporary_model_path = export_info["temporary_model_path"]
        temporary_manifest_path = export_info["temporary_manifest_path"]
        temporary_paths.extend([temporary_model_path, temporary_manifest_path])

        for temporary_path in temporary_paths:
            if os.path.isfile(temporary_path):
                os.remove(temporary_path)

        enable_fbx()
        # Preserve hierarchy, transforms, smoothing, tangents, materials and embedded textures.
        set_option("FBXExportFileVersion -v FBX202000;")
        set_option("FBXExportSmoothingGroups -v true;")
        set_option("FBXExportHardEdges -v false;")
        set_option("FBXExportTangents -v true;")
        set_option("FBXExportMaterials -v true;")
        set_option("FBXExportTextures -v true;")
        set_option("FBXExportEmbeddedTextures -v true;")
        set_option("FBXExportCameras -v false;")
        set_option("FBXExportLights -v false;")

        path = safe_path(temporary_model_path).replace('"', '\\"')
        # Selection-only is intentional: only the selected branch becomes this scene asset.
        mel.eval('FBXExport -f "' + path + '" -s;')

        if not os.path.isfile(temporary_model_path):
            raise RuntimeError("Maya не создала FBX. Проверь FBX Exporter и выделение.")
        size = os.path.getsize(temporary_model_path)
        if size <= 0:
            raise RuntimeError("Maya создала пустой FBX. Экспорт отменён.")

        write_client_asset_manifest(export_info, size)

        # Publish the new asset file and its scene.json registration only after both are ready.
        os.replace(temporary_model_path, export_info["model_path"])
        os.replace(temporary_manifest_path, export_info["manifest_path"])

        mib = size / float(1024 * 1024)
        message = (
            "Новая геометрия добавлена в клиентскую сцену.\n\n"
            + export_info["model_path"]
            + "\n\n" + export_info["manifest_path"]
            + "\n\nAsset ID: " + export_info["asset_id"]
            + " · " + str(len(components)) + " mesh objects · "
            + str(len(set(m for c in components for m in c["materials"])))
            + " materials · %.1f MiB" % mib
        )
        if size >= 90 * 1024 * 1024:
            message += "\n\nВНИМАНИЕ: размер достиг 90 MiB — обычный Git не подходит."
        message += "\n\nИсходный assets/real-terrain.fbx не изменён."
        cmds.confirmDialog(
            title="Grade Optimizer · Scene asset export complete",
            message=message,
            button=["OK"]
        )
        print("[Grade Optimizer] " + message.replace("\n", " | "))
    except Exception as exc:
        for temporary_path in temporary_paths:
            try:
                if os.path.isfile(temporary_path):
                    os.remove(temporary_path)
            except Exception:
                pass
        cmds.warning("[Grade Optimizer] Scene asset export failed: " + str(exc))
        cmds.confirmDialog(
            title="Grade Optimizer · Export failed",
            message=str(exc),
            button=["OK"]
        )
    finally:
        try:
            if previous_selection:
                cmds.select(previous_selection, replace=True)
            else:
                cmds.select(clear=True)
        except Exception:
            pass

def show():
    if cmds.window(WINDOW, exists=True):
        cmds.deleteUI(WINDOW)

    repo_default = _option_string(OPTION_REPO, "C:/zGit/GradeOptimizer/Grade_Optimizer")
    preset_default = _option_string(OPTION_PRESET, PRESET_PLACEHOLDER)
    if preset_default not in METADATA_PRESETS and preset_default != PRESET_PLACEHOLDER:
        preset_default = PRESET_PLACEHOLDER

    cmds.window(
        WINDOW,
        title="Grade Optimizer Scene Asset Exporter " + VERSION,
        sizeable=True,
        widthHeight=(540, 410)
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=7, columnAttach=("both", 12))
    cmds.text(
        label="Maya → New Scene Asset → Grade Optimizer",
        align="left",
        height=26,
        font="boldLabelFont"
    )
    cmds.text(
        label="Экспортируется только выделенная ветка Maya как отдельная модель сцены.",
        align="left",
        height=22
    )

    cmds.textFieldButtonGrp(
        WINDOW + "_repo",
        label="Git repo",
        text=repo_default,
        buttonLabel="Browse…",
        buttonCommand=browse_repo,
        changeCommand=remember_export_settings,
        columnWidth3=(65, 380, 85)
    )
    cmds.text(
        label="Файл создаётся в clients/<client>/models/<имя-объекта>.fbx.",
        align="left",
        height=22,
        font="boldLabelFont"
    )
    cmds.text(
        label="Исходный assets/real-terrain.fbx не изменяется и остаётся базовой поверхностью.",
        align="left",
        height=22
    )

    cmds.frameLayout(
        label="Разметка объектов (необязательно)",
        collapsable=True,
        collapse=True,
        marginWidth=8,
        marginHeight=7,
        borderStyle="etchedIn"
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=5)
    cmds.text(
        label="Role / Tags сохраняются в клиентском scene.json. Collision и Forest blocker настраиваются в Web Editor.",
        align="left",
        height=30
    )
    preset_menu = cmds.optionMenuGrp(
        WINDOW + "_preset",
        label="Тип объекта",
        columnWidth2=(85, 420),
        changeCommand=on_metadata_preset_changed
    )
    menu_parent = preset_menu + "|OptionMenu"
    cmds.menuItem(parent=menu_parent, label=PRESET_PLACEHOLDER)
    for preset_name in METADATA_PRESETS:
        cmds.menuItem(parent=menu_parent, label=preset_name)
    cmds.optionMenuGrp(WINDOW + "_preset", edit=True, value=preset_default)

    cmds.frameLayout(
        label="Дополнительно: свои Role / Tags",
        collapsable=True,
        collapse=True,
        marginWidth=6,
        marginHeight=5,
        borderStyle="etchedIn"
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=4)
    cmds.textFieldGrp(
        WINDOW + "_custom_role",
        label="Custom Role",
        text=_option_string(OPTION_CUSTOM_ROLE, ""),
        changeCommand=remember_custom_metadata,
        columnWidth2=(85, 420)
    )
    cmds.textFieldGrp(
        WINDOW + "_extra_tags",
        label="Extra Tags",
        text=_option_string(OPTION_EXTRA_TAGS, ""),
        annotation="Необязательно. Несколько тегов через запятую.",
        changeCommand=remember_custom_metadata,
        columnWidth2=(85, 420)
    )
    cmds.setParent("..")
    cmds.setParent("..")

    cmds.rowLayout(numberOfColumns=2, adjustableColumn=1, columnWidth2=(270, 270))
    cmds.button(
        label="ПРИМЕНИТЬ ROLE / TAGS К ВЫДЕЛЕНИЮ",
        height=32,
        backgroundColor=(0.24, 0.40, 0.31),
        command=apply_metadata_to_selection
    )
    cmds.button(
        label="ОЧИСТИТЬ МЕТКИ",
        height=32,
        command=clear_metadata_from_selection
    )
    cmds.setParent("..")
    cmds.setParent("..")

    on_metadata_preset_changed()

    cmds.separator(height=7, style="in")
    cmds.text(
        label="Новая геометрия добавляется в clients/<client>/scene.json как отдельный объект.",
        align="left",
        height=22
    )
    cmds.text(
        label="Embed Media включён · рекомендуемый предел FBX для Git: 90 MiB.",
        align="left",
        height=22
    )
    cmds.button(
        label="ЭКСПОРТИРОВАТЬ КАК НОВЫЙ ОБЪЕКТ",
        height=42,
        backgroundColor=(0.18, 0.48, 0.32),
        command=export_scene
    )
    cmds.text(
        label="Затем GitHub Desktop → Commit → Push.",
        align="left",
        height=22
    )
    cmds.showWindow(WINDOW)
    return WINDOW


# Maya Script Editor: execute this file, then call show().
