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
VERSION = "0.2.0"
FBX_NAME = "resort.fbx"


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
        collision = bool(_attribute_value(node, "goCollision", False))
        forest_blocker = bool(_attribute_value(node, "goForestBlocker", False))
        if not (role or tags or collision or forest_blocker):
            continue
        records.append({
            "name": node.rsplit("|", 1)[-1],
            "namePath": _node_name_path(node),
            "role": role,
            "tags": tags,
            "collision": collision,
            "forestBlocker": forest_blocker
        })
    return records


def _set_string_attribute(node, attribute, value):
    if not cmds.attributeQuery(attribute, node=node, exists=True):
        cmds.addAttr(node, longName=attribute, dataType="string")
    cmds.setAttr(node + "." + attribute, str(value or ""), type="string")


def _set_bool_attribute(node, attribute, value):
    if not cmds.attributeQuery(attribute, node=node, exists=True):
        cmds.addAttr(node, longName=attribute, attributeType="bool")
    cmds.setAttr(node + "." + attribute, bool(value))


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


def apply_metadata_to_selection(*_):
    transforms = _selected_transforms()
    if not transforms:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Выдели один или несколько Transform / Group / Mesh объектов.",
            button=["OK"]
        )
        return
    role = cmds.textFieldGrp(WINDOW + "_role", query=True, text=True).strip()
    tags = cmds.textFieldGrp(WINDOW + "_tags", query=True, text=True).strip()
    collision = cmds.checkBox(WINDOW + "_node_collision", query=True, value=True)
    forest_blocker = cmds.checkBox(WINDOW + "_node_forest", query=True, value=True)
    cleared = not (role or tags or collision or forest_blocker)
    for node in transforms:
        if cleared:
            for attribute in ("goRole", "goTags", "goCollision", "goForestBlocker"):
                try:
                    if cmds.attributeQuery(attribute, node=node, exists=True):
                        cmds.deleteAttr(node, attribute=attribute)
                except Exception:
                    pass
            continue
        _set_string_attribute(node, "goRole", role)
        _set_string_attribute(node, "goTags", tags)
        _set_bool_attribute(node, "goCollision", collision)
        _set_bool_attribute(node, "goForestBlocker", forest_blocker)
    message = (
        "Метаданные применены к %d узлам." % len(transforms)
        if not cleared else "Метаданные очищены у %d узлов." % len(transforms)
    )
    cmds.confirmDialog(title="Grade Optimizer · Node metadata", message=message, button=["OK"])
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
    result = cmds.fileDialog2(fileMode=3, caption="Выбери локальный Grade_Optimizer")
    if result:
        cmds.textFieldButtonGrp(WINDOW + "_repo", edit=True, text=result[0])


def export_scene(*_):
    repo = cmds.textFieldButtonGrp(WINDOW + "_repo", query=True, text=True).strip()
    slug = cmds.textFieldGrp(WINDOW + "_client", query=True, text=True).strip().lower()
    selected_only = cmds.checkBox(WINDOW + "_selection", query=True, value=True)

    if not os.path.isdir(repo):
        cmds.confirmDialog(title="Grade Optimizer", message="Укажи существующую локальную папку репозитория.", button=["OK"])
        return
    if not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$", slug):
        cmds.confirmDialog(title="Grade Optimizer", message="Client ID: латиница, цифры и дефис; 1–40 символов.", button=["OK"])
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
    cmds.window(WINDOW, title="Grade Optimizer Exporter " + VERSION, sizeable=True, widthHeight=(540, 510))
    cmds.columnLayout(adjustableColumn=True, rowSpacing=8, columnAttach=("both", 12))
    cmds.text(label="One Maya scene → one FBX → GitHub Desktop Push", align="left", height=28, font="boldLabelFont")
    cmds.text(label="Сохраняются полная иерархия, имена mesh и material assignments.", align="left", height=24)
    cmds.textFieldButtonGrp(
        WINDOW + "_repo", label="Git repo", text="C:/zGit/GradeOptimizer",
        buttonLabel="Browse…", buttonCommand=browse_repo,
        columnWidth3=(65, 380, 85)
    )
    cmds.textFieldGrp(WINDOW + "_client", label="Client ID", text="alpine-resort", columnWidth2=(65, 460))
    cmds.checkBox(WINDOW + "_selection", label="Export selected objects only (default: entire scene)", value=False)
    cmds.separator(height=8, style="in")
    cmds.text(label="OPTIONAL NODE METADATA · selected transforms / groups / meshes", align="left", height=22, font="boldLabelFont")
    cmds.textFieldGrp(WINDOW + "_role", label="Role", text="", columnWidth2=(65, 460))
    cmds.textFieldGrp(WINDOW + "_tags", label="Tags", text="", columnWidth2=(65, 460))
    cmds.rowLayout(numberOfColumns=2, adjustableColumn=1, columnWidth2=(250, 250))
    cmds.checkBox(WINDOW + "_node_collision", label="Collision hint", value=False)
    cmds.checkBox(WINDOW + "_node_forest", label="Forest blocker hint", value=False)
    cmds.setParent("..")
    cmds.button(label="APPLY METADATA TO SELECTED NODES", height=34, backgroundColor=(0.29, 0.39, 0.52), command=apply_metadata_to_selection)
    cmds.text(label="Пустые поля + выключенные флаги очищают метаданные выделения.", align="left", height=22)
    cmds.separator(height=8, style="in")
    cmds.text(label="clients/<client>/models/resort.fbx + scene.json", align="left", height=24)
    cmds.text(label="Embed Media включён. Рекомендуемый предел FBX для Git: 90 MiB.", align="left", height=24)
    cmds.button(label="EXPORT CLIENT SCENE", height=42, backgroundColor=(0.18, 0.48, 0.32), command=export_scene)
    cmds.text(label="Затем проверь изменения в GitHub Desktop и нажми Push.", align="left", height=24)
    cmds.showWindow(WINDOW)
    return WINDOW


# Maya Script Editor: execute this file, then call show().
