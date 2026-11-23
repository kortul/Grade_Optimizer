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
import shutil

import maya.cmds as cmds
import maya.mel as mel

WINDOW = "GradeOptimizerExporter"
VERSION = "0.7.0"
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
GIT_ASSET_ITEMS = []
GIT_ASSET_TREE_MAP = {}
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
        if cmds.control(WINDOW + "_git_asset", exists=True):
            refresh_git_asset_list()
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


def _maya_color_triplet(value):
    """Normalize Maya getAttr output for a color compound into an RGB tuple."""
    while isinstance(value, (list, tuple)) and len(value) == 1 and isinstance(value[0], (list, tuple)):
        value = value[0]
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None
    try:
        return tuple(float(value[index]) for index in range(3))
    except (TypeError, ValueError):
        return None


def _material_color_source(shader):
    """Return the first usable base/diffuse color input on a Maya shader."""
    for attribute in ("baseColor", "color", "diffuseColor", "base_color", "diffuse"):
        try:
            if not cmds.attributeQuery(attribute, node=shader, exists=True):
                continue
            incoming = cmds.listConnections(
                shader + "." + attribute,
                source=True,
                destination=False,
                plugs=True
            ) or []
            if incoming:
                return attribute, incoming[0], None
            color = _maya_color_triplet(cmds.getAttr(shader + "." + attribute))
            if color is not None:
                return attribute, None, color
        except Exception:
            continue
    return None, None, None


def _create_fbx_lambert_proxy(shader):
    """Make a temporary FBX/Three.js-compatible Lambert shader without editing the source shader."""
    safe_name = re.sub(r"[^A-Za-z0-9_]+", "_", str(shader))[:48] or "Material"
    proxy = cmds.shadingNode("lambert", asShader=True, name="GO_FBX_" + safe_name + "_MAT")
    color_attribute, color_connection, color_value = _material_color_source(shader)
    if color_connection:
        try:
            cmds.connectAttr(color_connection, proxy + ".color", force=True)
        except Exception:
            color_connection = None
    if not color_connection:
        if color_value is None:
            color_value = (0.72, 0.72, 0.72)
            cmds.warning(
                "[Grade Optimizer] No readable base/diffuse color on %s; "
                "using neutral gray for the FBX compatibility material." % shader
            )
        cmds.setAttr(proxy + ".color", color_value[0], color_value[1], color_value[2], type="double3")
    for weight_attribute in ("baseWeight", "base", "diffuse"):
        try:
            if not cmds.attributeQuery(weight_attribute, node=shader, exists=True):
                continue
            weight = cmds.getAttr(shader + "." + weight_attribute)
            if isinstance(weight, (int, float)):
                cmds.setAttr(proxy + ".diffuse", max(0.0, min(1.0, float(weight))))
                break
        except Exception:
            continue
    return proxy, color_attribute


def prepare_fbx_compatible_materials(components):
    """
    Three.js FBXLoader reads Lambert / Phong FBX materials.
    Temporarily connect a Lambert proxy to unsupported Maya shading groups so their
    per-face assignments and source material graphs remain untouched in the Maya scene.
    """
    overrides = []
    proxies_by_shader = {}
    seen_shading_groups = set()
    supported_node_types = {"lambert", "phong"}
    try:
        for component in components:
            transform = component.get("dagPath")
            shapes = cmds.listRelatives(transform, shapes=True, fullPath=True, type="mesh") or []
            for shape in shapes:
                shading_groups = cmds.listConnections(shape, type="shadingEngine") or []
                for shading_group in shading_groups:
                    if shading_group in seen_shading_groups:
                        continue
                    seen_shading_groups.add(shading_group)
                    destination = shading_group + ".surfaceShader"
                    source_plugs = cmds.listConnections(
                        destination, source=True, destination=False, plugs=True
                    ) or []
                    if not source_plugs:
                        continue
                    source_plug = source_plugs[0]
                    source_shader = source_plug.split(".", 1)[0]
                    try:
                        node_type = cmds.nodeType(source_shader)
                    except Exception:
                        continue
                    if node_type in supported_node_types:
                        continue
                    proxy = proxies_by_shader.get(source_shader)
                    color_attribute = None
                    if not proxy:
                        proxy, color_attribute = _create_fbx_lambert_proxy(source_shader)
                        proxies_by_shader[source_shader] = proxy
                    else:
                        color_attribute, _, _ = _material_color_source(source_shader)
                    overrides.append({
                        "shadingGroup": shading_group,
                        "destination": destination,
                        "sourcePlug": source_plug,
                        "sourceMaterial": source_shader,
                        "sourceType": node_type,
                        "proxyMaterial": proxy,
                        "colorAttribute": color_attribute or ""
                    })
                    cmds.connectAttr(proxy + ".outColor", destination, force=True)
    except Exception:
        restore_fbx_compatible_materials(overrides)
        raise
    return overrides


def restore_fbx_compatible_materials(overrides):
    """Restore original shading-group connections and remove temporary Lambert proxies."""
    proxies = set()
    failed_restores = set()
    for item in reversed(overrides or []):
        destination = item.get("destination")
        source_plug = item.get("sourcePlug")
        proxy = item.get("proxyMaterial")
        if proxy:
            proxies.add(proxy)
        try:
            if destination and source_plug and cmds.objExists(source_plug.split(".", 1)[0]):
                cmds.connectAttr(source_plug, destination, force=True)
                if not cmds.isConnected(source_plug, destination):
                    failed_restores.add(proxy)
        except Exception as exc:
            failed_restores.add(proxy)
            cmds.warning(
                "[Grade Optimizer] Could not restore original material connection %s: %s"
                % (source_plug, exc)
            )
    for proxy in proxies - failed_restores:
        try:
            if cmds.objExists(proxy):
                cmds.delete(proxy)
        except Exception as exc:
            cmds.warning("[Grade Optimizer] Could not remove temporary material %s: %s" % (proxy, exc))
    if failed_restores:
        cmds.warning(
            "[Grade Optimizer] Temporary compatibility materials were kept because an original "
            "shading connection could not be restored: " + ", ".join(sorted(failed_restores))
        )
    if isinstance(overrides, list):
        overrides[:] = []


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


def _read_client_scene(repo):
    client_slug, scene_path = find_client_scene_manifest(repo)
    with open(scene_path, "r", encoding="utf-8") as stream:
        manifest = json.load(stream)
    if not isinstance(manifest, dict):
        raise RuntimeError("Клиентский scene.json должен содержать JSON-объект.")
    assets = manifest.get("assets", [])
    if not isinstance(assets, list):
        raise RuntimeError("Поле assets в клиентском scene.json должно быть массивом.")
    return client_slug, scene_path, manifest, assets


def _safe_existing_fbx_path(client_dir, relative_file, require_exists=True):
    normalized = str(relative_file or "").replace("\\", "/").strip()
    if not re.match(r"^models/[A-Za-z0-9_.-]+\.fbx$", normalized, re.IGNORECASE):
        raise RuntimeError("Заменять можно только FBX внутри clients/<project>/models/: " + normalized)
    absolute = os.path.abspath(os.path.join(client_dir, *normalized.split("/")))
    base = os.path.abspath(client_dir)
    if os.path.commonpath([base, absolute]) != base:
        raise RuntimeError("Путь модели выходит за пределы папки клиентского проекта.")
    if require_exists and not os.path.isfile(absolute):
        raise RuntimeError("Текущий FBX не найден в локальном Git-репозитории: " + normalized)
    return absolute


def list_replaceable_client_assets(repo):
    client_slug, scene_path, manifest, assets = _read_client_scene(repo)
    client_dir = os.path.dirname(scene_path)
    result = []
    non_fbx = 0
    missing_fbx = 0
    for raw_asset in assets:
        if not isinstance(raw_asset, dict):
            continue
        relative_file = str(raw_asset.get("file") or "").replace("\\", "/")
        if not relative_file.lower().endswith(".fbx"):
            non_fbx += 1
            continue
        try:
            model_path = _safe_existing_fbx_path(client_dir, relative_file, require_exists=False)
        except Exception:
            continue
        if not os.path.isfile(model_path):
            missing_fbx += 1
            continue
        asset = dict(raw_asset)
        asset["_model_path"] = model_path
        asset["_relative_file"] = relative_file
        asset["_size_bytes"] = os.path.getsize(model_path)
        asset["_label"] = "%s  [%s]  ·  %s / %s" % (
            asset.get("name") or asset.get("id") or "Без имени",
            asset.get("id") or "no-id",
            asset.get("category") or "model",
            asset.get("phase") or "always"
        )
        result.append(asset)
    result.sort(key=lambda item: (str(item.get("name") or "").lower(), str(item.get("id") or "")))
    return client_slug, result, non_fbx, missing_fbx


def _selected_git_asset():
    """Return the currently selected FBX asset from the Outliner-style tree."""
    try:
        selected_items = cmds.treeView(
            WINDOW + "_git_asset_tree", query=True, selectItem=True
        ) or []
    except Exception:
        return None

    if isinstance(selected_items, str):
        selected_items = [selected_items]
    for tree_item in selected_items:
        asset = GIT_ASSET_TREE_MAP.get(tree_item)
        if asset:
            return asset
    return None


def _git_asset_tree_select(item, state):
    """Only FBX leaf nodes are selectable; category rows act as folders."""
    if not state:
        return True
    return item in GIT_ASSET_TREE_MAP


def _update_git_asset_details(*_):
    asset = _selected_git_asset()
    if not cmds.control(WINDOW + "_git_asset_info", exists=True):
        return

    if not asset:
        message = "Выбери модель в дереве выше. Папки категорий раскрываются стрелкой."
    else:
        size_mib = asset.get("_size_bytes", 0) / float(1024 * 1024)
        category = str(asset.get("category") or "model").replace("_", " ")
        phase = str(asset.get("phase") or "always").replace("_", " ")
        message = "%s    ·    ID: %s    ·    %s / %s    ·    %.1f MiB" % (
            asset.get("_relative_file", ""),
            asset.get("id", ""),
            category,
            phase,
            size_mib
        )

    cmds.text(WINDOW + "_git_asset_info", edit=True, label=message)
    if cmds.control(WINDOW + "_replace_asset", exists=True):
        cmds.button(WINDOW + "_replace_asset", edit=True, enable=bool(asset))


def refresh_git_asset_list(*_):
    global GIT_ASSET_ITEMS, GIT_ASSET_TREE_MAP
    tree_control = WINDOW + "_git_asset_tree"

    try:
        repo = cmds.textFieldButtonGrp(WINDOW + "_repo", query=True, text=True).strip()
        if not os.path.isdir(repo):
            raise RuntimeError("Укажи существующий локальный Git-репозиторий.")

        previous = _selected_git_asset()
        previous_id = previous.get("id") if previous else ""
        client_slug, assets, non_fbx, missing_fbx = list_replaceable_client_assets(repo)

        GIT_ASSET_ITEMS = assets
        GIT_ASSET_TREE_MAP = {}
        cmds.treeView(tree_control, edit=True, removeAll=True)

        category_labels = {
            "slope": "Рельеф / склоны",
            "prop": "Объекты",
            "building": "Здания",
            "station": "Станции",
            "lift": "Подъёмники",
            "road": "Дороги / площадки",
            "water": "Вода",
            "obstacle": "Скалы / препятствия",
            "vegetation": "Растительность"
        }
        grouped = {}
        for asset in assets:
            category = str(asset.get("category") or "other").strip().lower()
            grouped.setdefault(category, []).append(asset)

        item_index = 0
        previous_tree_item = None
        ordered_categories = sorted(
            grouped.keys(),
            key=lambda value: category_labels.get(
                value, value.replace("_", " ").capitalize()
            ).lower()
        )

        for group_index, category in enumerate(ordered_categories):
            group_key = "category_%02d" % group_index
            group_assets = grouped[category]
            group_label = category_labels.get(
                category, category.replace("_", " ").capitalize()
            )
            cmds.treeView(
                tree_control, edit=True, addItem=(group_key, "")
            )
            cmds.treeView(
                tree_control, edit=True,
                displayLabel=(group_key, "%s  (%d)" % (group_label, len(group_assets)))
            )

            for asset in group_assets:
                tree_item = "asset_%04d" % item_index
                item_index += 1
                asset["_tree_item"] = tree_item
                GIT_ASSET_TREE_MAP[tree_item] = asset

                asset_name = str(asset.get("name") or asset.get("id") or "Без имени")
                asset_id = str(asset.get("id") or "no-id")
                cmds.treeView(
                    tree_control, edit=True, addItem=(tree_item, group_key)
                )
                cmds.treeView(
                    tree_control, edit=True,
                    displayLabel=(tree_item, "%s    [%s]" % (asset_name, asset_id))
                )
                if asset_id == previous_id:
                    previous_tree_item = tree_item

            cmds.treeView(
                tree_control, edit=True, expandItem=(group_key, True)
            )

        note = "Git: clients/%s/scene.json    ·    Доступно для замены: %d FBX" % (
            client_slug, len(assets)
        )
        if missing_fbx:
            note += "    ·    отсутствуют локально: %d" % missing_fbx
        if non_fbx:
            note += "    ·    GLB/прочие: %d (не показываются)" % non_fbx
        note += ". Список читается из локального клона — сначала сделай Pull в GitHub Desktop."
        cmds.text(WINDOW + "_git_asset_status", edit=True, label=note)

        # Do not auto-select the first FBX: replacement must require an
        # explicit user choice. Preserve a previous selection only on refresh.
        if previous_tree_item:
            cmds.treeView(
                tree_control, edit=True,
                selectItem=(previous_tree_item, True)
            )
        _update_git_asset_details()

    except Exception as exc:
        GIT_ASSET_ITEMS = []
        GIT_ASSET_TREE_MAP = {}
        try:
            cmds.treeView(tree_control, edit=True, removeAll=True)
            cmds.text(
                WINDOW + "_git_asset_status", edit=True,
                label="Не удалось прочитать Git-сцену: " + str(exc)
            )
            cmds.text(
                WINDOW + "_git_asset_info", edit=True,
                label="Проверь путь к репозиторию и обнови список."
            )
            cmds.button(WINDOW + "_replace_asset", edit=True, enable=False)
        except Exception:
            pass
        cmds.warning("[Grade Optimizer] Could not load Git asset list: " + str(exc))



def prepare_client_asset_export(repo, components, node_metadata, replace_asset_id=None):
    client_slug, scene_path, manifest, assets = _read_client_scene(repo)
    client_dir = os.path.dirname(scene_path)
    selected = _selected_transforms()
    source_root_name = selected[0].rsplit("|", 1)[-1] if selected else str(components[0].get("name") or "Maya Asset")

    existing = None
    if replace_asset_id:
        matches = [item for item in assets if isinstance(item, dict) and str(item.get("id") or "") == str(replace_asset_id)]
        if len(matches) != 1:
            raise RuntimeError("Объект для замены не найден или ID не уникален в scene.json: " + str(replace_asset_id))
        existing = matches[0]
        asset_id = str(existing.get("id") or "")
        if not asset_id:
            raise RuntimeError("У выбранного Git-объекта отсутствует ID.")
        asset_name = str(existing.get("name") or asset_id)
        relative_file = str(existing.get("file") or "").replace("\\", "/")
        model_path = _safe_existing_fbx_path(client_dir, relative_file, require_exists=True)
    else:
        asset_name = source_root_name
        base_id = _safe_asset_id(asset_name)
        occupied_ids = {str(item.get("id") or "") for item in assets if isinstance(item, dict)}
        suffix = 1
        while True:
            asset_id = base_id if suffix == 1 else base_id + "_" + str(suffix)
            relative_file = "models/" + asset_id + ".fbx"
            model_path = os.path.join(client_dir, *relative_file.split("/"))
            if asset_id not in occupied_ids and not os.path.exists(model_path):
                break
            suffix += 1

    linear_unit = str(cmds.currentUnit(query=True, linear=True) or "").strip().lower()
    meters_per_unit = MAYA_LINEAR_UNIT_TO_METERS.get(linear_unit)
    if meters_per_unit is None:
        raise RuntimeError("Неизвестная линейная единица Maya: " + (linear_unit or "не указана"))

    lower_name = source_root_name.lower()
    is_slope = "slope" in lower_name or "piste" in lower_name
    is_stage_one = "stage1" in lower_name or "stage_1" in lower_name
    category = "slope" if is_slope else "prop"
    phase = "stage_1" if is_stage_one else "always"

    # Merge Maya-authored Role / Tags with existing Web Editor node flags.
    old_node_metadata = [dict(item) for item in (existing or {}).get("nodeMetadata", []) if isinstance(item, dict)]
    old_by_path = {tuple(item.get("namePath") or []): index for index, item in enumerate(old_node_metadata)}
    for record in node_metadata:
        node_path = tuple(record.get("namePath") or [])
        serialized = {"namePath": list(node_path), "role": record.get("role", ""), "tags": record.get("tags", [])}
        if node_path in old_by_path:
            old_node_metadata[old_by_path[node_path]].update(serialized)
        else:
            old_node_metadata.append({**serialized, "collision": False, "forestBlocker": False})

    entry = dict(existing or {})
    if not existing:
        entry.update({
            "category": category, "phase": phase, "visible": True, "collision": False,
            "forestBlocker": is_slope, "activeTerrain": False,
            "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0],
                          "scale": [meters_per_unit, meters_per_unit, meters_per_unit]},
            "nodeVisibility": [], "nodeMetadata": []
        })

    # Preserve Web Editor placement, phase, visibility and flags when replacing a model.
    entry.update({
        "id": asset_id, "name": asset_name, "file": relative_file,
        "sourceFile": cmds.file(query=True, sceneName=True, shortName=True) or "",
        "mayaExport": {
            "pluginVersion": VERSION,
            "sourceScene": cmds.file(query=True, sceneName=True, shortName=True) or "",
            "mayaVersion": cmds.about(version=True),
            "linearUnit": linear_unit, "metersPerUnit": meters_per_unit,
            "meshComponentCount": len(components), "exportedRootName": source_root_name,
            "replacement": bool(existing), "components": components
        }
    })
    if old_node_metadata:
        entry["nodeMetadata"] = old_node_metadata

    manifest["schemaVersion"] = manifest.get("schemaVersion") or "1.0"
    manifest["clientId"] = client_slug
    manifest["updatedAt"] = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    if existing:
        existing_index = next(index for index, item in enumerate(assets)
                              if isinstance(item, dict) and item.get("id") == asset_id)
        assets[existing_index] = entry
    else:
        assets.append(entry)
    manifest["assets"] = assets

    model_dir = os.path.dirname(model_path)
    if not os.path.isdir(model_dir):
        os.makedirs(model_dir)
    temporary_model_path = model_path + ".exporting.fbx"
    temporary_manifest_path = scene_path + ".exporting.tmp"
    return {
        "client_slug": client_slug, "asset_id": asset_id, "asset_name": asset_name,
        "source_root_name": source_root_name, "is_replacement": bool(existing),
        "relative_file": relative_file, "model_path": model_path,
        "temporary_model_path": temporary_model_path, "manifest_path": scene_path,
        "temporary_manifest_path": temporary_manifest_path, "manifest": manifest
    }

def write_client_asset_manifest(export_info, model_size, material_conversions=None):
    manifest = export_info["manifest"]
    entry = next(
        item for item in manifest["assets"]
        if isinstance(item, dict) and item.get("id") == export_info["asset_id"]
    )
    entry["mayaExport"]["modelSizeBytes"] = model_size
    entry["mayaExport"]["fbxMaterialConversions"] = list(material_conversions or [])
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
    _export_scene()


def replace_selected_scene_asset(*_):
    asset = _selected_git_asset()
    if not asset:
        cmds.confirmDialog(title="Grade Optimizer", message="Сначала обнови список Git и выбери существующий FBX для замены.", button=["OK"])
        return
    message = (
        "Будет заменён существующий FBX в локальном Git-репозитории.\n\n"
        "Объект: %s\nID: %s\nФайл: %s\n\n"
        "Геометрия и назначения материалов будут взяты из текущего выделения Maya.\n"
        "ID, категория, фаза, transform / масштаб, видимость, Collision и Forest blocker останутся прежними.\n\n"
        "Это изменит локальные файлы Git. Продолжить?"
    ) % (asset.get("name") or asset.get("id"), asset.get("id"), asset.get("_relative_file"))
    choice = cmds.confirmDialog(
        title="Grade Optimizer · Replace Git Geometry",
        message=message,
        button=["ЗАМЕНИТЬ FBX", "ОТМЕНА"],
        defaultButton="ОТМЕНА", cancelButton="ОТМЕНА", dismissString="ОТМЕНА"
    )
    if choice != "ЗАМЕНИТЬ FBX":
        return
    _export_scene(replace_asset_id=asset.get("id"))


def _export_scene(replace_asset_id=None):
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
    material_overrides = []
    material_conversion_summary = []
    try:
        export_info = prepare_client_asset_export(repo, components, node_metadata, replace_asset_id=replace_asset_id)
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

        # FBXLoader in the browser supports Lambert / Phong shading models. Maya 2026
        # OpenPBR / Standard Surface nodes are temporarily bridged through Lambert
        # proxies on their existing shading groups, preserving per-face assignments.
        material_overrides = prepare_fbx_compatible_materials(components)
        path = safe_path(temporary_model_path).replace('"', '\\\\"')
        try:
            # Selection-only is intentional: only the selected branch becomes this scene asset.
            mel.eval('FBXExport -f "' + path + '" -s;')
        finally:
            material_conversion_summary = [
                {
                    "sourceMaterial": item["sourceMaterial"],
                    "sourceType": item["sourceType"],
                    "exportMaterial": item["proxyMaterial"],
                    "colorAttribute": item["colorAttribute"]
                }
                for item in material_overrides
            ]
            restore_fbx_compatible_materials(material_overrides)

        if not os.path.isfile(temporary_model_path):
            raise RuntimeError("Maya не создала FBX. Проверь FBX Exporter и выделение.")
        size = os.path.getsize(temporary_model_path)
        if size <= 0:
            raise RuntimeError("Maya создала пустой FBX. Экспорт отменён.")

        write_client_asset_manifest(export_info, size, material_conversion_summary)

        # Replace the FBX and scene manifest as one recoverable pair of files.
        backup_model_path = export_info["model_path"] + ".go-backup"
        backup_manifest_path = export_info["manifest_path"] + ".go-backup"
        had_model = os.path.isfile(export_info["model_path"])
        for backup_path in (backup_model_path, backup_manifest_path):
            if os.path.isfile(backup_path):
                os.remove(backup_path)
        try:
            if had_model:
                shutil.copy2(export_info["model_path"], backup_model_path)
            shutil.copy2(export_info["manifest_path"], backup_manifest_path)
            os.replace(temporary_model_path, export_info["model_path"])
            os.replace(temporary_manifest_path, export_info["manifest_path"])
        except Exception:
            if os.path.isfile(backup_model_path):
                os.replace(backup_model_path, export_info["model_path"])
            elif not had_model and os.path.isfile(export_info["model_path"]):
                os.remove(export_info["model_path"])
            if os.path.isfile(backup_manifest_path):
                os.replace(backup_manifest_path, export_info["manifest_path"])
            raise
        finally:
            for backup_path in (backup_model_path, backup_manifest_path):
                try:
                    if os.path.isfile(backup_path):
                        os.remove(backup_path)
                except Exception:
                    pass

        mib = size / float(1024 * 1024)
        action_label = (
            "Геометрия и материалы существующего объекта заменены."
            if export_info["is_replacement"]
            else "Новая геометрия добавлена в клиентскую сцену."
        )
        message = (
            action_label + "\n\n"
            + export_info["model_path"]
            + "\n\n" + export_info["manifest_path"]
            + "\n\nAsset ID: " + export_info["asset_id"]
            + " · " + str(len(components)) + " mesh objects · "
            + str(len(set(m for c in components for m in c["materials"])))
            + " materials · %.1f MiB" % mib
        )
        if size >= 90 * 1024 * 1024:
            message += "\n\nВНИМАНИЕ: размер достиг 90 MiB — обычный Git не подходит."
        if material_conversion_summary:
            message += "\n\nСовместимость материалов: %d неподдерживаемых shader узлов временно переведены в Lambert. Назначения faces и исходные материалы Maya восстановлены." % len(material_conversion_summary)
        message += "\n\nИсходный assets/real-terrain.fbx не изменён."
        cmds.confirmDialog(
            title="Grade Optimizer · Scene asset export complete",
            message=message,
            button=["OK"]
        )
        refresh_git_asset_list()
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
        if material_overrides:
            restore_fbx_compatible_materials(material_overrides)
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
        title="Grade Optimizer · Maya Exporter " + VERSION,
        sizeable=True,
        widthHeight=(590, 760)
    )
    cmds.scrollLayout(WINDOW + "_scroll", childResizable=True)
    cmds.columnLayout(
        adjustableColumn=True, rowSpacing=8,
        columnAttach=("both", 12)
    )

    cmds.text(
        label="ЭКСПОРТ ГЕОМЕТРИИ ИЗ MAYA В GRADE OPTIMIZER",
        align="left", height=24, font="boldLabelFont"
    )
    cmds.text(
        label="Выбери один из двух сценариев ниже. Экспортируется текущее выделение Maya.",
        align="left", height=30, wordWrap=True
    )

    cmds.textFieldButtonGrp(
        WINDOW + "_repo",
        label="Git repo",
        text=repo_default,
        buttonLabel="Обзор…",
        buttonCommand=browse_repo,
        changeCommand=remember_export_settings,
        columnWidth3=(65, 420, 75)
    )

    # 1. NEW ASSET — always creates a fresh ID and a separate FBX.
    cmds.frameLayout(
        label="1. НОВЫЙ ОБЪЕКТ",
        collapsable=False, marginWidth=9, marginHeight=8,
        borderStyle="etchedIn"
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=5)
    cmds.text(
        label="Создаёт отдельную модель и новый ID. Существующие объекты проекта не затрагиваются.",
        align="left", height=36, wordWrap=True
    )
    cmds.button(
        label="ДОБАВИТЬ КАК НОВЫЙ ОБЪЕКТ",
        height=42, backgroundColor=(0.18, 0.48, 0.32),
        command=export_scene
    )
    cmds.setParent("..")
    cmds.setParent("..")

    # 2. REPLACE ASSET — choose an existing published FBX in a tree.
    cmds.frameLayout(
        label="2. ЗАМЕНА СУЩЕСТВУЮЩЕГО ОБЪЕКТА",
        collapsable=False, marginWidth=9, marginHeight=8,
        borderStyle="etchedIn"
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=6)
    cmds.text(
        label="Выбери опубликованную модель в дереве. Категории раскрываются как папки в Outliner.",
        align="left", height=34, wordWrap=True
    )
    cmds.rowLayout(
        numberOfColumns=2, adjustableColumn=1,
        columnWidth2=(435, 95)
    )
    cmds.text(
        label="ОБЪЕКТЫ ИЗ КЛИЕНТСКОЙ СЦЕНЫ",
        align="left", font="smallBoldLabelFont"
    )
    cmds.button(
        label="ОБНОВИТЬ",
        height=28, command=refresh_git_asset_list
    )
    cmds.setParent("..")

    cmds.treeView(
        WINDOW + "_git_asset_tree",
        height=205,
        width=540,
        allowMultiSelection=False,
        allowDragAndDrop=False,
        selectCommand=_git_asset_tree_select,
        selectionChangedCommand=_update_git_asset_details
    )
    cmds.text(
        WINDOW + "_git_asset_status",
        label="Список ещё не загружен.",
        align="left", height=42, wordWrap=True
    )
    cmds.text(
        WINDOW + "_git_asset_info",
        label="Выбери FBX-модель в дереве.",
        align="left", height=38, wordWrap=True,
        font="smallPlainLabelFont"
    )
    cmds.button(
        WINDOW + "_replace_asset",
        label="ЗАМЕНИТЬ ВЫБРАННЫЙ ОБЪЕКТ",
        height=42,
        backgroundColor=(0.62, 0.30, 0.18),
        enable=False,
        command=replace_selected_scene_asset
    )
    cmds.text(
        label="Защита: базовый рельеф assets/real-terrain.fbx не входит в список и не может быть заменён этим Exporter.",
        align="left", height=40, wordWrap=True
    )
    cmds.setParent("..")
    cmds.setParent("..")

    # Optional metadata tools remain available, but are kept out of the main path.
    cmds.frameLayout(
        label="Дополнительно · Разметка объектов",
        collapsable=True,
        collapse=True,
        marginWidth=9,
        marginHeight=7,
        borderStyle="etchedIn"
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=5)
    cmds.text(
        label="Role / Tags сохраняются в scene.json. Collision и Forest blocker настраиваются в Web Editor.",
        align="left", height=32, wordWrap=True
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
        label="Свои Role / Tags",
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
        changeCommand=remember_custom_metadata,
        columnWidth2=(85, 420)
    )
    cmds.setParent("..")
    cmds.setParent("..")

    cmds.rowLayout(
        numberOfColumns=2, adjustableColumn=1,
        columnWidth2=(270, 270)
    )
    cmds.button(
        label="ПРИМЕНИТЬ К ВЫДЕЛЕНИЮ",
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
        label="После экспорта проверь изменения в GitHub Desktop и выполни Commit → Push.",
        align="left", height=30, wordWrap=True
    )

    cmds.setParent("..")
    cmds.setParent("..")
    cmds.showWindow(WINDOW)
    refresh_git_asset_list()
    return WINDOW

# Maya Script Editor: execute this file, then call show().
