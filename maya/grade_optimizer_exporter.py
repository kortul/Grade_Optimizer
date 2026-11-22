# -*- coding: utf-8 -*-
"""
Grade Optimizer Exporter for Autodesk Maya.
Writes one FBX scene and a scene.json manifest into a local Git working copy.
Run in Maya's Python Script Editor.
"""
import os
import re
import json
import datetime

import maya.cmds as cmds
import maya.mel as mel

WINDOW = "GradeOptimizerExporter"
VERSION = "0.2.4"
FBX_NAME = "resort.fbx"

# Maya optionVars keep the export settings and last-used metadata preset between
# Script Editor / Shelf launches, so users do not have to re-enter them.
OPTION_REPO = "gradeOptimizerRepoPath"
OPTION_PROJECT = "gradeOptimizerProjectId"
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
        project = cmds.textFieldGrp(WINDOW + "_client", query=True, text=True).strip()
        _remember_option(OPTION_REPO, repo)
        _remember_option(OPTION_PROJECT, project)
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


def write_manifest(client_dir, slug, components, model_size, node_metadata):
    material_names = sorted(set(
        material
        for component in components
        for material in component["materials"]
    ))
    manifest = {
        "schemaVersion": "1.0",
        "clientId": slug,
        "updatedAt": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "assets": [{
            "id": "maya-scene",
            "name": slug.replace("-", " ").title(),
            "file": "models/" + FBX_NAME,
            "category": "model",
            "phase": "always",
            "visible": True,
            "collision": False,
            "forestBlocker": False,
            "activeTerrain": False,
            "sourceFile": FBX_NAME,
            "nodeMetadata": node_metadata,
            "transform": {
                "position": [0, 0, 0],
                "rotation": [0, 0, 0],
                "scale": [1, 1, 1]
            }
        }],
        "mayaExport": {
            "pluginVersion": VERSION,
            "sourceScene": cmds.file(query=True, sceneName=True, shortName=True) or "",
            "mayaVersion": cmds.about(version=True),
            "linearUnit": cmds.currentUnit(query=True, linear=True),
            "modelSizeBytes": model_size,
            "meshComponentCount": len(components),
            "materialNames": material_names,
            "nodeMetadata": node_metadata,
            "components": components
        }
    }
    path = os.path.join(client_dir, "scene.json")
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
    slug = cmds.textFieldGrp(WINDOW + "_client", query=True, text=True).strip().lower()
    selected_only = cmds.checkBox(WINDOW + "_selection", query=True, value=True)
    remember_export_settings()

    if not os.path.isdir(repo):
        cmds.confirmDialog(title="Grade Optimizer", message="Укажи существующую локальную папку репозитория.", button=["OK"])
        return
    if not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$", slug):
        cmds.confirmDialog(title="Grade Optimizer", message="Project ID: латиница, цифры и дефис; 1–40 символов.", button=["OK"])
        return
    if selected_only and not (cmds.ls(selection=True, long=True) or []):
        cmds.confirmDialog(title="Grade Optimizer", message="Сначала выдели объекты.", button=["OK"])
        return

    components = collect_meshes(selected_only)
    node_metadata = collect_node_metadata(selected_only)
    if not components:
        cmds.confirmDialog(title="Grade Optimizer", message="Не найдено polygon mesh объектов.", button=["OK"])
        return

    clients_dir = os.path.join(repo, "clients")
    client_dir = os.path.join(clients_dir, slug)
    model_dir = os.path.join(client_dir, "models")
    for directory in (clients_dir, client_dir, model_dir):
        if not os.path.isdir(directory):
            os.makedirs(directory)

    model_path = os.path.join(model_dir, FBX_NAME)
    previous_selection = cmds.ls(selection=True, long=True) or []
    try:
        enable_fbx()
        # One file, full hierarchy, named material assignments, embedded textures.
        set_option("FBXExportFileVersion -v FBX202000;")
        set_option("FBXExportSmoothingGroups -v true;")
        set_option("FBXExportHardEdges -v false;")
        set_option("FBXExportTangents -v true;")
        set_option("FBXExportMaterials -v true;")
        set_option("FBXExportTextures -v true;")
        set_option("FBXExportEmbeddedTextures -v true;")
        set_option("FBXExportCameras -v false;")
        set_option("FBXExportLights -v false;")

        path = safe_path(model_path)
        if selected_only:
            mel.eval('FBXExport -f "' + path + '" -s;')
        else:
            mel.eval('FBXExport -f "' + path + '";')

        if not os.path.isfile(model_path):
            raise RuntimeError("Maya не создала FBX. Проверь FBX Exporter.")
        size = os.path.getsize(model_path)
        manifest_path = write_manifest(client_dir, slug, components, size, node_metadata)
        mib = size / float(1024 * 1024)
        message = (
            "Экспорт завершён.\n\n" + model_path + "\n\n" + manifest_path
            + "\n\n" + str(len(components)) + " mesh objects · "
            + str(len(set(m for c in components for m in c["materials"])))
            + " materials · %.1f MiB" % mib
        )
        if size >= 90 * 1024 * 1024:
            message += "\n\nВНИМАНИЕ: размер достиг 90 MiB — обычный Git не подходит."
        cmds.confirmDialog(title="Grade Optimizer · Export complete", message=message, button=["OK"])
        print("[Grade Optimizer] " + message.replace("\n", " | "))
    except Exception as exc:
        cmds.warning("[Grade Optimizer] Export failed: " + str(exc))
        cmds.confirmDialog(title="Grade Optimizer · Export failed", message=str(exc), button=["OK"])
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
    project_default = _option_string(OPTION_PROJECT, "alpine-resort")
    preset_default = _option_string(OPTION_PRESET, PRESET_PLACEHOLDER)
    if preset_default not in METADATA_PRESETS and preset_default != PRESET_PLACEHOLDER:
        preset_default = PRESET_PLACEHOLDER

    cmds.window(
        WINDOW,
        title="Grade Optimizer Exporter " + VERSION,
        sizeable=True,
        widthHeight=(540, 390)
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=7, columnAttach=("both", 12))
    cmds.text(label="Maya → FBX → Grade Optimizer", align="left", height=26, font="boldLabelFont")
    cmds.text(label="Сохраняются иерархия, геометрия и назначения материалов.", align="left", height=22)

    cmds.textFieldButtonGrp(
        WINDOW + "_repo",
        label="Git repo",
        text=repo_default,
        buttonLabel="Browse…",
        buttonCommand=browse_repo,
        changeCommand=remember_export_settings,
        columnWidth3=(65, 380, 85)
    )
    cmds.textFieldGrp(
        WINDOW + "_client",
        label="Project ID",
        text=project_default,
        annotation="Project ID для папки clients/<id> и ссылки ?project=<id>.",
        changeCommand=remember_export_settings,
        columnWidth2=(85, 440)
    )
    cmds.checkBox(
        WINDOW + "_selection",
        label="Export selected objects only",
        value=True
    )
    cmds.text(
        label="По умолчанию экспортируются только выделенные объекты и их дочерние узлы.",
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
        label="Выдели объекты в Maya → выбери тип → нажми «Применить». Collision и Forest blocker настраиваются в Web Editor.",
        align="left",
        height=24
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
    cmds.text(label="clients/<project>/models/resort.fbx + scene.json", align="left", height=22)
    cmds.text(label="Embed Media включён · рекомендуемый предел FBX для Git: 90 MiB.", align="left", height=22)
    cmds.button(
        label="EXPORT CLIENT SCENE",
        height=42,
        backgroundColor=(0.18, 0.48, 0.32),
        command=export_scene
    )
    cmds.text(label="Затем проверь изменения в GitHub Desktop и нажми Push.", align="left", height=22)
    cmds.showWindow(WINDOW)
    return WINDOW


# Maya Script Editor: execute this file, then call show().
