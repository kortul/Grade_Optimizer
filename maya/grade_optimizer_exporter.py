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
VERSION = "0.1.0"
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


def write_manifest(client_dir, slug, components, model_size):
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
        manifest_path = write_manifest(client_dir, slug, components, size)
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
    cmds.window(WINDOW, title="Grade Optimizer Exporter " + VERSION, sizeable=False, widthHeight=(510, 300))
    cmds.columnLayout(adjustableColumn=True, rowSpacing=9, columnAttach=("both", 12))
    cmds.text(label="One Maya scene → one FBX → GitHub Desktop Push", align="left", height=28, font="boldLabelFont")
    cmds.text(label="Сохраняются иерархия, имена mesh-объектов и material assignments.", align="left", height=24)
    cmds.textFieldButtonGrp(
        WINDOW + "_repo", label="Git repo", text="",
        buttonLabel="Browse…", buttonCommand=browse_repo,
        columnWidth3=(65, 340, 85)
    )
    cmds.textFieldGrp(WINDOW + "_client", label="Client ID", text="alpine-resort", columnWidth2=(65, 440))
    cmds.checkBox(WINDOW + "_selection", label="Export selected objects only (default: entire scene)", value=False)
    cmds.separator(height=8, style="in")
    cmds.text(label="clients/<client>/models/resort.fbx + scene.json", align="left", height=24)
    cmds.text(label="Embed Media включён. Рекомендуемый предел FBX для Git: 90 MiB.", align="left", height=24)
    cmds.button(label="EXPORT CLIENT SCENE", height=42, backgroundColor=(0.18, 0.48, 0.32), command=export_scene)
    cmds.text(label="Затем проверь изменения в GitHub Desktop и нажми Push.", align="left", height=24)
    cmds.showWindow(WINDOW)
    return WINDOW


# Maya Script Editor: execute this file, then call show().
