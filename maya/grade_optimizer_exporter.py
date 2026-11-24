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
import subprocess

import maya.cmds as cmds
import maya.mel as mel
import maya.api.OpenMaya as om2

WINDOW = "GradeOptimizerExporter"
VERSION = "0.8.3"
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



def _git_executable():
    """Find a Git executable, including the one bundled with GitHub Desktop."""
    from_path = shutil.which("git")
    if from_path and os.path.isfile(from_path):
        return from_path

    candidates = []
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    desktop_root = os.path.join(local_app_data, "GitHubDesktop")
    try:
        for folder in os.listdir(desktop_root):
            if not folder.lower().startswith("app-"):
                continue
            app_root = os.path.join(desktop_root, folder, "resources", "app", "git")
            candidates.extend([
                os.path.join(app_root, "cmd", "git.exe"),
                os.path.join(app_root, "mingw64", "bin", "git.exe"),
                os.path.join(app_root, "bin", "git.exe")
            ])
    except Exception:
        pass

    candidates.extend([
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files\Git\bin\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe"
    ])
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return "git"


def _run_git(repo, arguments):
    """Run Git quietly from the exact folder selected in the Maya Exporter."""
    executable = _git_executable()
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        process = subprocess.Popen(
            [executable] + list(arguments),
            cwd=os.path.abspath(repo),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            creationflags=creation_flags
        )
        stdout, stderr = process.communicate()
    except Exception as exc:
        raise RuntimeError(
            "Не удалось запустить Git из Maya: %s\n"
            "Установи Git for Windows / GitHub Desktop или проверь Git PATH."
            % exc
        )
    return process.returncode, (stdout or "").strip(), (stderr or "").strip()


def _inspect_git_worktree(repo):
    """Require an actual Git worktree and return its canonical root, branch and origin."""
    repo_path = os.path.realpath(os.path.abspath(repo))
    code, top_level, error = _run_git(repo_path, ["rev-parse", "--show-toplevel"])
    if code != 0 or not top_level:
        raise RuntimeError(
            "Выбранная папка содержит файлы проекта, но Git не распознаёт её как локальный репозиторий.\n\n"
            "Папка: %s\nGit: %s\n\n"
            "Выбери именно локальный clone Grade_Optimizer, который открыт в GitHub Desktop."
            % (repo_path, error or "working tree not found")
        )

    actual_root = os.path.realpath(top_level)
    normalize = lambda value: os.path.normcase(os.path.normpath(value))
    if normalize(actual_root) != normalize(repo_path):
        raise RuntimeError(
            "Указана не корневая папка Git-репозитория.\n\n"
            "Поле Maya: %s\nНастоящий Git root: %s\n\n"
            "Укажи настоящий Git root — папку, внутри которой лежит .git."
            % (repo_path, actual_root)
        )

    code, branch, branch_error = _run_git(actual_root, ["branch", "--show-current"])
    if code != 0:
        branch = "(не удалось определить)"
    code, origin, origin_error = _run_git(actual_root, ["config", "--get", "remote.origin.url"])
    if code != 0:
        origin = ""
    expected_origin = bool(re.search(
        r"(?:github\.com[:/])kortul/Grade_Optimizer(?:\.git)?$",
        origin.strip(),
        re.IGNORECASE
    ))
    return {
        "root": actual_root,
        "branch": branch or "(detached HEAD)",
        "origin": origin or "(origin не настроен)",
        "origin_matches": expected_origin,
        "git": _git_executable()
    }


def _git_changes_for_paths(repo, paths):
    """Return precise status entries for the FBX and scene manifest just exported."""
    relative_paths = []
    for path in paths:
        relative = os.path.relpath(os.path.abspath(path), os.path.abspath(repo)).replace("\\", "/")
        if relative == ".." or relative.startswith("../"):
            raise RuntimeError("Экспортируемый файл оказался вне выбранного Git root: " + path)
        relative_paths.append(relative)

    code, output, error = _run_git(
        repo, ["status", "--short", "--untracked-files=all", "--"] + relative_paths
    )
    if code != 0:
        raise RuntimeError("Git не смог проверить изменённые файлы: " + (error or output))
    changes = [line.rstrip() for line in output.splitlines() if line.strip()]

    ignored = []
    for relative in relative_paths:
        ignored_code, ignored_output, _ = _run_git(repo, ["check-ignore", "-v", "--", relative])
        if ignored_code == 0 and ignored_output:
            ignored.append(ignored_output)
    return {"paths": relative_paths, "changes": changes, "ignored": ignored}


def _format_git_export_report(git_info, git_result):
    lines = [
        "Git root: " + git_info["root"],
        "Branch: " + git_info["branch"],
        "Origin: " + git_info["origin"]
    ]
    if not git_info["origin_matches"]:
        lines.append("ВНИМАНИЕ: origin не совпадает с kortul/Grade_Optimizer.")
    if git_result["changes"]:
        lines.append("Git видит изменения:")
        lines.extend(git_result["changes"])
    elif git_result["ignored"]:
        lines.append("Git ИГНОРИРУЕТ экспортируемые файлы:")
        lines.extend(git_result["ignored"])
    else:
        lines.append(
            "Git не обнаружил отличий в этих двух файлах. "
            "Проверь, не экспортировалась ли геометрия с тем же содержимым."
        )
    return "\n".join(lines)


def check_git_repository(*_):
    """Show exactly which local repository GitHub Desktop should be watching."""
    try:
        repo = cmds.textFieldButtonGrp(WINDOW + "_repo", query=True, text=True).strip()
        git_info = _inspect_git_worktree(repo)
        label = "Git OK · %s · %s" % (git_info["branch"], git_info["root"])
        if not git_info["origin_matches"]:
            label = "ПРОВЕРЬ ORIGIN · " + label
        if cmds.control(WINDOW + "_repo_status", exists=True):
            cmds.text(WINDOW + "_repo_status", edit=True, label=label)
        status_code, working_status, status_error = _run_git(
            repo, ["status", "--short", "--branch", "--untracked-files=all"]
        )
        if status_code != 0:
            raise RuntimeError("Git status failed: " + (status_error or working_status))
        report = [
            "Git root: " + git_info["root"],
            "Branch: " + git_info["branch"],
            "Origin: " + git_info["origin"]
        ]
        if not git_info["origin_matches"]:
            report.append("ВНИМАНИЕ: origin не совпадает с kortul/Grade_Optimizer.")
        report.append("")
        report.append("Текущее состояние Git:")
        report.append(working_status if working_status else "Рабочая копия чистая — незакоммиченных изменений нет.")
        report.append("")
        report.append("GitHub Desktop должен быть открыт именно для этого Git root.")
        cmds.confirmDialog(
            title="Grade Optimizer · Git repository",
            message="\n".join(report),
            button=["OK"]
        )
    except Exception as exc:
        if cmds.control(WINDOW + "_repo_status", exists=True):
            cmds.text(WINDOW + "_repo_status", edit=True, label="Git не подтверждён · " + str(exc).split("\n")[0])
        cmds.confirmDialog(title="Grade Optimizer · Git check failed", message=str(exc), button=["OK"])

def _normalize_dag_roots(roots):
    """Resolve supplied Maya node names to unambiguous full DAG paths."""
    normalized = []
    for root in roots or []:
        matches = cmds.ls(str(root), long=True) or []
        matches = [
            item for item in matches
            if cmds.objExists(item) and cmds.nodeType(item) in ("transform", "joint")
        ]
        if not matches and cmds.objExists(str(root)):
            node = str(root)
            if cmds.nodeType(node) in ("transform", "joint"):
                matches = [node]
        if len(matches) > 1:
            raise RuntimeError(
                "Неоднозначный DAG root %s: Maya вернула несколько путей: %s"
                % (root, ", ".join(matches))
            )
        if matches and matches[0] not in normalized:
            normalized.append(matches[0])
    return normalized


def collect_meshes(selection_only=False, selection_roots=None):
    # Resolve roots to full DAG paths. A selected branch includes only its
    # descendants; selecting a child must never pull in meshes from its parent.
    if selection_only:
        requested_roots = (
            selection_roots if selection_roots is not None
            else _selected_transforms()
        )
        selection = _normalize_dag_roots(requested_roots)
    else:
        selection = []

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
            transform == root or transform.startswith(root.rstrip("|") + "|")
            for root in selection
        ):
            continue
        # Track shape paths rather than transforms: one transform may
        # legitimately contain several independent polygon mesh shapes.
        if shape in seen:
            continue
        seen.add(shape)
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


def collect_node_metadata(selection_only=False, selection_roots=None):
    selection = (
        list(selection_roots) if selection_only and selection_roots is not None
        else (_selected_transforms() if selection_only else [])
    )
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
        if cmds.control(WINDOW + "_repo_status", exists=True):
            try:
                git_info = _inspect_git_worktree(repo)
                status = "Git OK · %s · %s" % (git_info["branch"], git_info["root"])
                if not git_info["origin_matches"]:
                    status = "ПРОВЕРЬ ORIGIN · " + status
                cmds.text(WINDOW + "_repo_status", edit=True, label=status)
            except Exception as exc:
                cmds.text(WINDOW + "_repo_status", edit=True, label="Git не подтверждён · " + str(exc).split("\n")[0])
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
    # The canonical base terrain is global (assets/), not a client asset.
    # Expose it as a distinct selectable entry with its own replacement path.
    terrain_manifest_path = os.path.join(repo, "assets", "real-terrain.json")
    terrain_model_path = os.path.join(repo, "assets", "real-terrain.fbx")
    if os.path.isfile(terrain_manifest_path):
        with open(terrain_manifest_path, "r", encoding="utf-8") as stream:
            terrain_manifest = json.load(stream)
        if (
            terrain_manifest.get("assetId") != "real-terrain"
            or str(terrain_manifest.get("file") or "").replace("\\", "/") != "assets/real-terrain.fbx"
            or terrain_manifest.get("category") != "terrain"
        ):
            raise RuntimeError(
                "assets/real-terrain.json не описывает ожидаемый базовый рельеф real-terrain."
            )
        if os.path.isfile(terrain_model_path):
            terrain_asset = dict(terrain_manifest)
            terrain_asset.update({
                "_canonical_terrain": True,
                "_model_path": terrain_model_path,
                "_relative_file": "assets/real-terrain.fbx",
                "_size_bytes": os.path.getsize(terrain_model_path),
                "_label": "Основной рельеф  [real-terrain]"
            })
            result.append(terrain_asset)
        else:
            missing_fbx += 1

    result.sort(key=lambda item: (
        str(item.get("category") or "").lower() != "terrain",
        str(item.get("name") or "").lower(),
        str(item.get("id") or "")
    ))
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
            "terrain": "Основной рельеф",
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

        client_asset_count = sum(1 for item in assets if not item.get("_canonical_terrain"))
        canonical_count = sum(1 for item in assets if item.get("_canonical_terrain"))
        note = "Git: clients/%s/scene.json    ·    Клиентские FBX: %d    ·    Основной рельеф: %s" % (
            client_slug, client_asset_count, "доступен" if canonical_count else "не найден"
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
    existing_size_bytes = 0
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
        existing_size_bytes = os.path.getsize(model_path)

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
        "existing_size_bytes": existing_size_bytes,
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


def _terrain_mesh_shape_path(component):
    """Resolve one component record to its exact Maya mesh shape path."""
    transform = component.get("dagPath")
    if not transform or not cmds.objExists(transform):
        return None
    shapes = cmds.listRelatives(transform, shapes=True, fullPath=True, type="mesh") or []
    wanted = str(component.get("shape") or "")
    for shape in shapes:
        if shape.rsplit("|", 1)[-1] == wanted:
            return shape
    return shapes[0] if shapes else None


def _is_component_under_root(component, root):
    transform = str(component.get("dagPath") or "")
    root = str(root or "").rstrip("|")
    return bool(transform and root and (transform == root or transform.startswith(root + "|")))



def find_working_group(node):
    """
    Find the enclosing MAYA_WORKING_SCENE ancestor for any mesh/transform path.

    The selected slopes may be distributed across arbitrary nested groups.
    Walk the actual Maya DAG parents instead of assuming a fixed hierarchy.
    """
    if not node:
        return None

    matches = cmds.ls(str(node), long=True) or []
    current = matches[0] if matches else str(node)
    if not cmds.objExists(current):
        return None

    # A mesh shape is below its transform; start at the transform so the
    # returned path always identifies the actual working-scene group.
    try:
        if cmds.nodeType(current) == "mesh":
            parents = cmds.listRelatives(current, parent=True, fullPath=True) or []
            if parents:
                current = parents[0]
    except Exception:
        pass

    while current and cmds.objExists(current):
        leaf = current.rsplit("|", 1)[-1]
        if leaf.startswith("MAYA_WORKING_SCENE"):
            return current
        parents = cmds.listRelatives(current, parent=True, fullPath=True) or []
        current = parents[0] if parents else None

    return None


def get_bridge_data(working_group):
    """
    Read the CAD Bridge v14 offset and uniform scale stored on a working group.
    Returns (offset_xyz, scale), or None when the Bridge metadata is absent.
    """
    if not working_group or not cmds.objExists(working_group):
        return None

    attribute_names = (
        "bridgeOriginalOffsetX",
        "bridgeOriginalOffsetY",
        "bridgeOriginalOffsetZ",
        "bridgeOriginalScale"
    )
    if not all(cmds.attributeQuery(name, node=working_group, exists=True)
               for name in attribute_names):
        return None

    try:
        offset = tuple(
            float(cmds.getAttr(working_group + "." + name))
            for name in attribute_names[:3]
        )
        scale = float(cmds.getAttr(working_group + ".bridgeOriginalScale"))
    except Exception:
        return None

    return offset, scale


def _bridge_context_for_export_root(source_root, components):
    """
    Read the CAD Bridge inverse for one selected DAG root.

    CAD Bridge v14 documents this exact relation:
        working_world = bridge_scale * (original_maya - bridge_offset)
    """
    relevant = [item for item in components if _is_component_under_root(item, source_root)]
    if not relevant:
        raise RuntimeError("В выделенной группе нет mesh-компонентов: " + source_root)

    groups = set()
    missing_group = []
    for component in relevant:
        working_group = find_working_group(component.get("dagPath"))
        if working_group:
            groups.add(working_group)
        else:
            missing_group.append(component.get("dagPath") or component.get("name") or "mesh")

    if not groups:
        return None
    if missing_group or len(groups) != 1:
        raise RuntimeError(
            "Одна экспортируемая группа содержит mesh из разных CAD Bridge-контекстов. "
            "Выдели отдельную ветку одной MAYA_WORKING_SCENE."
        )

    working_group = next(iter(groups))
    bridge_data = get_bridge_data(working_group)
    if not bridge_data:
        raise RuntimeError(
            "На %s отсутствуют bridgeOriginalOffset / bridgeOriginalScale. "
            "Экспорт остановлен, чтобы не записать CAD-смещённые координаты."
            % working_group.rsplit("|", 1)[-1]
        )
    offset, scale = bridge_data
    if abs(float(scale)) < 1e-9:
        raise RuntimeError("CAD Bridge scale равен нулю: " + working_group)

    return {
        "group": working_group,
        "offset": [float(value) for value in offset],
        "scale": float(scale)
    }


def _apply_inverse_bridge_to_root_matrix(export_root, bridge_context):
    """
    Remove the CAD Bridge ancestor transform from a temporary root.

    Maya's row-vector 4x4 layout stores translation in indices 12..14.
    Right-multiplying by the inverse uniform Bridge transform divides the
    3x3 basis by scale and maps translation back by /scale + offset.
    """
    if not bridge_context:
        return

    offset = bridge_context["offset"]
    scale = float(bridge_context["scale"])
    matrix = cmds.xform(export_root, query=True, worldSpace=True, matrix=True)
    if not matrix or len(matrix) != 16:
        raise RuntimeError("Maya не вернула корректную world matrix для " + export_root)

    corrected = list(matrix)
    for row in range(3):
        for column in range(3):
            index = row * 4 + column
            corrected[index] = float(matrix[index]) / scale

    corrected[12] = float(matrix[12]) / scale + offset[0]
    corrected[13] = float(matrix[13]) / scale + offset[1]
    corrected[14] = float(matrix[14]) / scale + offset[2]
    cmds.xform(export_root, worldSpace=True, matrix=corrected)


def _all_transform_nodes(root):
    descendants = cmds.listRelatives(
        root, allDescendents=True, fullPath=True, type="transform"
    ) or []
    return [root] + list(dict.fromkeys(descendants))


def _bake_export_root_to_world_meshes(source_root, suffix, bridge_context=None,
                                      stage_one=False):
    """
    Duplicate one selected branch, remove the CAD Bridge transform and bake
    world-space mesh points into identity transforms. Original Maya nodes are
    never changed. Each mesh shape remains a separate FBX object.

    Stage 1 applies the same legacy compatibility normalisation previously
    performed by the web loader: descendant scales -> 1 and ToSketchfab
    translation -> 0. That result is baked before export.
    """
    short_name = str(source_root).rsplit("|", 1)[-1]
    duplicate_name = "GO_EXPORT_%s_%03d" % (
        re.sub(r"[^A-Za-z0-9_]+", "_", short_name)[:40] or "MESH",
        int(suffix)
    )
    baked_root = cmds.duplicate(
        source_root, name=duplicate_name, returnRootsOnly=True
    )[0]

    # Maya may return a short name from duplicate/parent. Resolve the copied
    # root again after every DAG reparent so descendant filtering uses a full path.
    copied_roots = cmds.ls(baked_root, long=True) or []
    if len(copied_roots) != 1:
        raise RuntimeError(
            "Не удалось однозначно определить корень временной копии %s: %s"
            % (short_name, ", ".join(copied_roots) or "узел не найден")
        )
    baked_root = copied_roots[0]

    parents = cmds.listRelatives(baked_root, parent=True, fullPath=True) or []
    if parents:
        parent_result = cmds.parent(baked_root, world=True, absolute=True) or []
        if not parent_result:
            raise RuntimeError("Maya не смогла перенести временную копию %s в World." % short_name)
        copied_roots = cmds.ls(parent_result[0], long=True) or []
        if len(copied_roots) != 1:
            raise RuntimeError(
                "После переноса %s в World корень копии неоднозначен: %s"
                % (short_name, ", ".join(copied_roots) or "узел не найден")
            )
        baked_root = copied_roots[0]

    _apply_inverse_bridge_to_root_matrix(baked_root, bridge_context)

    transform_nodes = _all_transform_nodes(baked_root)
    if stage_one:
        for node in transform_nodes:
            try:
                cmds.setAttr(node + ".scaleX", 1.0)
                cmds.setAttr(node + ".scaleY", 1.0)
                cmds.setAttr(node + ".scaleZ", 1.0)
            except Exception as error:
                raise RuntimeError(
                    "Не удалось нормализовать Maya scale на %s: %s" % (node, error)
                )
            if node.rsplit("|", 1)[-1].lower() == "tosketchfab":
                cmds.setAttr(node + ".translateX", 0.0)
                cmds.setAttr(node + ".translateY", 0.0)
                cmds.setAttr(node + ".translateZ", 0.0)

    # Capture world-space points after Bridge inversion and (for Stage 1)
    # after the compatibility normalisation above.
    mesh_components = collect_meshes(
        selection_only=True, selection_roots=[baked_root]
    )
    if not mesh_components:
        descendant_shapes = cmds.listRelatives(
            baked_root, allDescendents=True, fullPath=True, type="mesh"
        ) or []
        raise RuntimeError(
            "В копии %s не удалось найти экспортируемый polygon mesh. "
            "Корень: %s. Mesh shapes в DAG: %d. "
            "Возможно, в копии остались только intermediate shapes или пустая ветка."
            % (short_name, baked_root, len(descendant_shapes))
        )

    point_records = []
    for component in mesh_components:
        shape = _terrain_mesh_shape_path(component)
        if not shape:
            raise RuntimeError(
                "Не удалось разрешить mesh shape для %s." % component.get("name", short_name)
            )
        selection = om2.MSelectionList()
        selection.add(shape)
        dag_path = selection.getDagPath(0)
        dag_path.extendToShape()
        mesh_fn = om2.MFnMesh(dag_path)
        points_world = mesh_fn.getPoints(om2.MSpace.kWorld)
        point_records.append((shape, points_world))

    # Make every local transform identity. The captured world coordinates
    # are then written into object-space vertices; hierarchy / names / material
    # assignments remain, but the CAD wrapper no longer affects the FBX.
    identity = [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0
    ]
    for node in transform_nodes:
        cmds.xform(node, objectSpace=True, matrix=identity)

    for shape, points_world in point_records:
        selection = om2.MSelectionList()
        selection.add(shape)
        dag_path = selection.getDagPath(0)
        dag_path.extendToShape()
        mesh_fn = om2.MFnMesh(dag_path)
        mesh_fn.setPoints(points_world, om2.MSpace.kObject)
        mesh_fn.updateSurface()

    cmds.select(baked_root, replace=True)
    print(
        "Temporary CAD-normalized export copy: %s | meshes: %d | Bridge inverse: %s | Stage1 normalisation: %s"
        % (baked_root, len(mesh_components), bool(bridge_context), bool(stage_one))
    )
    return baked_root


def _prepare_export_roots(source_roots, components, stage_one=False, label="ASSET"):
    """
    Build temporary, CAD-independent copies for the selected roots.
    Overlapping selected roots are pruned to prevent duplicate mesh export.
    """
    minimal_roots = []
    for root in sorted(source_roots, key=lambda value: (str(value).count("|"), str(value))):
        if any(root == parent or root.startswith(parent.rstrip("|") + "|") for parent in minimal_roots):
            continue
        minimal_roots.append(root)

    temporary_roots = []
    bridge_summaries = []
    export_roots = []
    try:
        for index, source_root in enumerate(minimal_roots, start=1):
            bridge_context = _bridge_context_for_export_root(source_root, components)
            baked_root = _bake_export_root_to_world_meshes(
                source_root,
                index,
                bridge_context=bridge_context,
                stage_one=stage_one
            )
            temporary_roots.append(baked_root)
            export_roots.append(baked_root)
            if bridge_context:
                bridge_summaries.append({
                    "workingGroup": bridge_context["group"],
                    "originalOffset": bridge_context["offset"],
                    "originalScale": bridge_context["scale"]
                })
        if not export_roots:
            raise RuntimeError("Не удалось подготовить временные FBX-копии для экспорта.")
        export_components = collect_meshes(
            selection_only=True, selection_roots=export_roots
        )
        if len(export_components) != len(components):
            raise RuntimeError(
                "После подготовки копий изменилось число mesh shapes: исходно %d, в копиях %d. "
                "Экспорт остановлен."
                % (len(components), len(export_components))
            )
        return export_roots, temporary_roots, export_components, bridge_summaries
    except Exception:
        existing = [node for node in temporary_roots if cmds.objExists(node)]
        if existing:
            cmds.delete(existing)
        raise


def replace_canonical_terrain(*_):
    """
    Replace assets/real-terrain.fbx + its JSON sidecar as one recoverable pair.
    This is deliberately separate from client-scene asset replacement.
    """
    repo = cmds.textFieldButtonGrp(WINDOW + "_repo", query=True, text=True).strip()
    remember_export_settings()
    if not os.path.isdir(repo):
        cmds.confirmDialog(title="Grade Optimizer", message="Укажи существующую локальную папку репозитория.", button=["OK"])
        return

    try:
        git_info = _inspect_git_worktree(repo)
        manifest_path = os.path.join(repo, "assets", "real-terrain.json")
        model_path = os.path.join(repo, "assets", "real-terrain.fbx")
        if not os.path.isfile(manifest_path) or not os.path.isfile(model_path):
            raise RuntimeError("Не найдена пара assets/real-terrain.json + assets/real-terrain.fbx. Сначала сделай Pull.")
        with open(manifest_path, "r", encoding="utf-8") as stream:
            manifest = json.load(stream)
        if (
            manifest.get("assetId") != "real-terrain"
            or manifest.get("category") != "terrain"
            or str(manifest.get("file") or "").replace("\\", "/") != "assets/real-terrain.fbx"
        ):
            raise RuntimeError("Манифест assets/real-terrain.json не прошёл проверку ID / category / file.")

        previous_selection = cmds.ls(selection=True, long=True) or []
        if not previous_selection:
            raise RuntimeError("Выдели только mesh основного рельефа внутри CAD-синхронизируемой группы.")
        export_roots = _selected_transforms()
        if not export_roots:
            raise RuntimeError("Не удалось определить transform-объекты из выделения Maya.")
        source_components = collect_meshes(selection_only=True, selection_roots=export_roots)
        if not source_components:
            raise RuntimeError("В выделении не найдены polygon mesh объекты.")

        # The source mesh may have any scene-specific name. The user explicitly
        # chooses the canonical terrain geometry; its Maya node name is not an
        # identifier for the published asset.
        selected_root_names = [
            str(root).rsplit("|", 1)[-1].split(":", 1)[-1].lower()
            for root in export_roots
        ]
        if any(name == "maya_working_scene" for name in selected_root_names):
            raise RuntimeError(
                "Выбрана вся MAYA_WORKING_SCENE. Выдели только основной mesh "
                "рельефа или отдельную группу, содержащую только его геометрию. "
                "Имя объекта в Maya может быть любым."
            )
        terrain_components = list(source_components)
        stage_components = [
            item for item in source_components
            if re.search(r"(stage[_ -]?[12]|slope|piste)", " ".join((
                str(item.get("dagPath") or ""),
                str(item.get("name") or ""),
                str(item.get("shape") or "")
            )).lower())
        ]
        if stage_components:
            raise RuntimeError(
                "Выделение содержит также геометрию Stage / slope (%d mesh). "
                "Для основного рельефа выбери только terrainShape или его отдельную группу."
                % len(stage_components)
            )

        # The selected terrain must be a dedicated branch, not a mixed
        # selection containing Stage / slope / unrelated meshes.
        if len(terrain_components) != len(source_components):
            raise RuntimeError(
                "В выделении %d mesh, из них %d относятся к terrain / ground. "
                "Выдели отдельную группу основного рельефа, без Stage 1 и других объектов."
                % (len(source_components), len(terrain_components))
            )
        source_components = terrain_components

        linear_unit = str(cmds.currentUnit(query=True, linear=True) or "").strip().lower()
        meters_per_unit = MAYA_LINEAR_UNIT_TO_METERS.get(linear_unit)
        if meters_per_unit is None:
            raise RuntimeError("Неизвестная линейная единица Maya: " + (linear_unit or "не указана"))

        existing_size = os.path.getsize(model_path)
        minimum_safe_size = max(16 * 1024, int(existing_size * 0.01))
        source_root_names = [root.rsplit("|", 1)[-1] for root in export_roots]
        bridge_note = (
            "CAD Bridge inverse: будет снят с временной копии; исходные объекты не меняются"
        )
        choice = cmds.confirmDialog(
            title="Grade Optimizer · Replace Canonical Terrain",
            message=(
                "Будет заменён ОСНОВНОЙ рельеф для A1.\n\n"
                "Файл: assets/real-terrain.fbx\n"
                "Объекты: %s\n"
                "Mesh shapes: %d\n"
                "Старый размер: %.2f MiB\n\n"
                "%s\n\n"
                "Stage 1 и клиентская сцена не изменяются.\n"
                "Отдельные mesh сохраняются отдельными объектами; объединения не будет.\n\n"
                "Продолжить?"
            ) % (
                ", ".join(source_root_names), len(source_components),
                existing_size / float(1024 * 1024), bridge_note
            ),
            button=["ЗАМЕНИТЬ ОСНОВНОЙ РЕЛЬЕФ", "ОТМЕНА"],
            defaultButton="ОТМЕНА",
            cancelButton="ОТМЕНА",
            dismissString="ОТМЕНА"
        )
        if choice != "ЗАМЕНИТЬ ОСНОВНОЙ РЕЛЬЕФ":
            return

        temporary_model_path = model_path + ".exporting.fbx"
        temporary_manifest_path = manifest_path + ".exporting.tmp"
        backup_model_path = model_path + ".go-backup"
        backup_manifest_path = manifest_path + ".go-backup"
        temporary_paths = [temporary_model_path, temporary_manifest_path]
        baked_nodes = []
        material_overrides = []
        conversion_summary = []
        try:
            for temporary_path in temporary_paths:
                if os.path.isfile(temporary_path):
                    os.remove(temporary_path)
            for backup_path in (backup_model_path, backup_manifest_path):
                if os.path.isfile(backup_path):
                    os.remove(backup_path)

            baked_nodes, _, baked_components, bridge_summaries = _prepare_export_roots(
                export_roots, source_components, stage_one=False, label="TERRAIN"
            )
            if not baked_components:
                raise RuntimeError("После CAD Bridge inverse не осталось polygon mesh объектов.")

            enable_fbx()
            set_option("FBXExportFileVersion -v FBX202000;")
            set_option("FBXExportSmoothingGroups -v true;")
            set_option("FBXExportHardEdges -v false;")
            set_option("FBXExportTangents -v true;")
            set_option("FBXExportMaterials -v true;")
            set_option("FBXExportTextures -v true;")
            set_option("FBXExportEmbeddedTextures -v true;")
            set_option("FBXExportCameras -v false;")
            set_option("FBXExportLights -v false;")

            material_overrides = prepare_fbx_compatible_materials(baked_components)
            path = safe_path(temporary_model_path).replace('"', '\\\\"')
            try:
                cmds.select(baked_nodes, replace=True)
                selected_for_fbx = cmds.ls(selection=True, long=True) or []
                if not selected_for_fbx:
                    raise RuntimeError("Не удалось выделить временные terrain-копии для FBXExport.")
                missing_roots = [root for root in baked_nodes if root not in selected_for_fbx]
                if missing_roots:
                    raise RuntimeError("Перед FBXExport потеряны временные terrain-копии: " + ", ".join(missing_roots))
                mel.eval('FBXExport -f "' + path + '" -s;')
            finally:
                conversion_summary = [
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
                raise RuntimeError("Maya не создала временный FBX основного рельефа.")
            new_size = os.path.getsize(temporary_model_path)
            if new_size < minimum_safe_size:
                raise RuntimeError(
                    "Новый terrain FBX подозрительно мал (%d bytes; минимум %d). "
                    "Старый основной рельеф сохранён."
                    % (new_size, minimum_safe_size)
                )

            bounds = [cmds.exactWorldBoundingBox(node) for node in baked_nodes]
            world_bounds = [
                min(box[0] for box in bounds),
                min(box[1] for box in bounds),
                min(box[2] for box in bounds),
                max(box[3] for box in bounds),
                max(box[4] for box in bounds),
                max(box[5] for box in bounds)
            ]
            updated_manifest = dict(manifest)
            terrain_metadata = dict(updated_manifest.get("mayaExport") or {})
            source_file = cmds.file(query=True, sceneName=True, shortName=True) or ""
            material_names = sorted({
                material
                for component in source_components
                for material in (component.get("materials") or [])
            })
            terrain_metadata.update({
                "pluginVersion": VERSION,
                "sourceScene": source_file,
                "mayaVersion": cmds.about(version=True),
                "linearUnit": linear_unit,
                "metersPerUnit": meters_per_unit,
                "modelSizeBytes": new_size,
                "meshComponentCount": len(baked_components),
                "exportedRootNames": source_root_names,
                "worldBounds": world_bounds,
                "materialNames": material_names,
                "components": baked_components,
                "sourceComponents": source_components,
                "nodeMetadata": collect_node_metadata(
                    selection_only=True, selection_roots=export_roots
                ),
                "cadBridge": {
                    "inverseApplied": bool(bridge_summaries),
                    "workingGroups": bridge_summaries,
                    "geometryBakedToMayaWorld": True
                },
                "fbxMaterialConversions": conversion_summary
            })
            updated_manifest["mayaExport"] = terrain_metadata
            updated_manifest["assetId"] = "real-terrain"
            updated_manifest["name"] = updated_manifest.get("name") or "Real Terrain"
            updated_manifest["file"] = "assets/real-terrain.fbx"
            updated_manifest["category"] = "terrain"
            updated_manifest["activeTerrain"] = True
            updated_manifest["updatedAt"] = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            with open(temporary_manifest_path, "w", encoding="utf-8") as stream:
                json.dump(updated_manifest, stream, ensure_ascii=False, indent=2)
                stream.write("\n")

            had_model = os.path.isfile(model_path)
            try:
                if had_model:
                    shutil.copy2(model_path, backup_model_path)
                shutil.copy2(manifest_path, backup_manifest_path)
                os.replace(temporary_model_path, model_path)
                os.replace(temporary_manifest_path, manifest_path)
            except Exception:
                if os.path.isfile(backup_model_path):
                    os.replace(backup_model_path, model_path)
                if os.path.isfile(backup_manifest_path):
                    os.replace(backup_manifest_path, manifest_path)
                raise
            finally:
                for backup_path in (backup_model_path, backup_manifest_path):
                    try:
                        if os.path.isfile(backup_path):
                            os.remove(backup_path)
                    except Exception:
                        pass

            try:
                git_result = _git_changes_for_paths(repo, [model_path, manifest_path])
                git_report = _format_git_export_report(git_info, git_result)
            except Exception as git_error:
                git_report = (
                    "Файлы уже заменены, но Git не смог проверить изменения: %s"
                    % git_error
                )
            message = (
                "Основной рельеф заменён.\n\n"
                + model_path
                + "\n\n" + manifest_path
                + "\n\n" + str(len(baked_components)) + " mesh shapes · %.1f MiB\n\nПРОВЕРКА GIT:\n" % (new_size / float(1024 * 1024))
                + git_report
            )
            cmds.confirmDialog(
                title="Grade Optimizer · Canonical Terrain Export Complete",
                message=message,
                button=["OK"]
            )
        finally:
            if material_overrides:
                restore_fbx_compatible_materials(material_overrides)
            for temporary_path in temporary_paths:
                try:
                    if os.path.isfile(temporary_path):
                        os.remove(temporary_path)
                except Exception:
                    pass
            if baked_nodes:
                try:
                    existing_nodes = [node for node in baked_nodes if cmds.objExists(node)]
                    if existing_nodes:
                        cmds.delete(existing_nodes)
                except Exception as cleanup_error:
                    cmds.warning("Не удалось удалить временные terrain-копии: " + str(cleanup_error))
            try:
                if previous_selection:
                    valid_selection = [node for node in previous_selection if cmds.objExists(node)]
                    if valid_selection:
                        cmds.select(valid_selection, replace=True)
                    else:
                        cmds.select(clear=True)
            except Exception:
                pass
    except Exception as exc:
        cmds.warning("[Grade Optimizer] Canonical terrain replacement failed: " + str(exc))
        cmds.confirmDialog(
            title="Grade Optimizer · Terrain export failed",
            message=str(exc) + "\n\nСуществующие assets/real-terrain.fbx и assets/real-terrain.json не заменены.",
            button=["OK"]
        )


def replace_selected_scene_asset(*_):
    asset = _selected_git_asset()
    if not asset:
        cmds.confirmDialog(title="Grade Optimizer", message="Сначала обнови список Git и выбери существующий FBX для замены.", button=["OK"])
        return
    if asset.get("_canonical_terrain"):
        replace_canonical_terrain()
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
    try:
        git_info = _inspect_git_worktree(repo)
    except Exception as git_error:
        cmds.confirmDialog(title="Grade Optimizer · Git path error", message=str(git_error), button=["OK"])
        return

    previous_selection = cmds.ls(selection=True, long=True) or []
    if not previous_selection:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Сначала выдели корневую группу или один/несколько mesh-объектов.",
            button=["OK"]
        )
        return

    # Capture the real DAG targets before material compatibility nodes are created.
    # Component selections (faces / vertices / edges) are normalized to whole meshes.
    export_roots = _selected_transforms()
    if not export_roots:
        cmds.confirmDialog(
            title="Grade Optimizer",
            message="Не удалось определить transform-объекты в выделении. Выдели группу или mesh в Outliner.",
            button=["OK"]
        )
        return

    components = collect_meshes(selection_only=True, selection_roots=export_roots)
    node_metadata = collect_node_metadata(selection_only=True, selection_roots=export_roots)
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
        target_entry = next(
            item for item in export_info["manifest"]["assets"]
            if isinstance(item, dict) and item.get("id") == export_info["asset_id"]
        )
        stage_one_export = str(target_entry.get("phase") or "") == "stage_1"
        if stage_one_export:
            stage_two_components = [
                item for item in components
                if re.search(
                    r"(stage[_ -]?2|slopes[_ -]?stage[_ -]?2)",
                    " ".join((
                        str(item.get("dagPath") or ""),
                        str(item.get("name") or ""),
                        str(item.get("shape") or "")
                    )).lower()
                )
            ]
            if stage_two_components:
                examples = ", ".join(
                    str(item.get("name") or item.get("shape") or "mesh")
                    for item in stage_two_components[:6]
                )
                raise RuntimeError(
                    "Экспорт Stage 1 остановлен: в выделении обнаружено %d mesh из Stage 2. "
                    "Они не должны попадать в Slopes_Stage1. "
                    "Сними выделение Stage 2 и повтори замену.\n\nПримеры: %s"
                    % (len(stage_two_components), examples)
                )
        base_terrain_components = [
            item for item in components
            if "terrain" in (str(item.get("name") or "") + " " + str(item.get("shape") or "")).lower()
            or "ground" in (str(item.get("name") or "") + " " + str(item.get("shape") or "")).lower()
        ]
        if str(replace_asset_id or "") == "slopes_stage1" and base_terrain_components:
            raise RuntimeError(
                "В выделение Stage 1 попал также основной terrain (%d mesh). "
                "Выдели только ветку Slopes_Stage1 внутри MAYA_WORKING_SCENE."
                % len(base_terrain_components)
            )
        fbx_export_roots = list(export_roots)
        temporary_export_roots = []
        export_components = list(components)
        bridge_summaries = []
        if stage_one_export or any(find_working_group(item.get("dagPath")) for item in components):
            (
                fbx_export_roots,
                temporary_export_roots,
                export_components,
                bridge_summaries
            ) = _prepare_export_roots(
                export_roots,
                components,
                stage_one=stage_one_export,
                label="STAGE1" if stage_one_export else "ASSET"
            )
            target_entry["mayaExport"]["geometryBakedToMayaWorld"] = True
            target_entry["mayaExport"]["stageOneHierarchyNormalizedAtExport"] = bool(stage_one_export)
            target_entry["mayaExport"]["cadBridge"] = {
                "inverseApplied": bool(bridge_summaries),
                "workingGroups": bridge_summaries
            }
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
        material_overrides = prepare_fbx_compatible_materials(export_components)
        path = safe_path(temporary_model_path).replace('"', '\\\\"')
        try:
            # Restore the exact, CAD-normalized temporary branch immediately
            # before FBXExport -s. Original Maya objects are never exported or moved.
            cmds.select(fbx_export_roots, replace=True)
            selected_for_fbx = cmds.ls(selection=True, long=True) or []
            if not selected_for_fbx:
                raise RuntimeError(
                    "Maya потеряла выделение перед FBXExport. Экспорт отменён без изменения исходного FBX."
                )
            missing_roots = [root for root in fbx_export_roots if root not in selected_for_fbx]
            if missing_roots:
                raise RuntimeError(
                    "Не удалось восстановить выделение перед FBXExport: "
                    + ", ".join(missing_roots)
                )
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

        # A replacement must not destroy a healthy asset with a header-only or
        # otherwise truncated export. Compare before writing the manifest or
        # swapping either file, so the previous FBX remains untouched on failure.
        previous_size = int(export_info.get("existing_size_bytes") or 0)
        if export_info["is_replacement"] and previous_size:
            minimum_safe_size = max(16 * 1024, int(previous_size * 0.01))
            if size < minimum_safe_size:
                raise RuntimeError(
                    "Замена остановлена: новый FBX подозрительно мал.\n\n"
                    "Старый файл: %s bytes\n"
                    "Новый файл: %s bytes\n"
                    "Минимум для безопасной замены: %s bytes\n\n"
                    "Корни выделения: %s\n"
                    "Mesh-объектов в выборке: %s\n\n"
                    "Исходная геометрия сохранена. Exporter теперь нормализует "
                    "выделение до целых transform-объектов; проверь, что выбрана "
                    "именно нужная ветка Outliner."
                    % (
                        previous_size, size, minimum_safe_size,
                        ", ".join(export_roots), len(components)
                    )
                )

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
            + " · " + str(len(export_roots)) + " selected roots · "
            + str(len(components)) + " mesh objects · "
            + str(len(set(m for c in components for m in c["materials"])))
            + " materials · %.1f MiB" % mib
        )
        if size >= 90 * 1024 * 1024:
            message += "\n\nВНИМАНИЕ: размер достиг 90 MiB — обычный Git не подходит."
        if material_conversion_summary:
            message += "\n\nСовместимость материалов: %d неподдерживаемых shader узлов временно переведены в Lambert. Назначения faces и исходные материалы Maya восстановлены." % len(material_conversion_summary)
        if 'temporary_export_roots' in locals() and temporary_export_roots:
            message += "\n\nCAD / Maya transforms baked into temporary copies: %d root(s). Исходная Maya-геометрия не изменена." % len(temporary_export_roots)
        message += "\n\nИсходный assets/real-terrain.fbx не изменён."
        try:
            git_result = _git_changes_for_paths(repo, [export_info["model_path"], export_info["manifest_path"]])
            git_report = _format_git_export_report(git_info, git_result)
        except Exception as git_error:
            git_report = (
                "Файлы уже записаны, но Git не смог проверить изменения: %s\n"
                "Открой GitHub Desktop для папки: %s"
                % (git_error, git_info["root"])
            )
        message += "\n\nПРОВЕРКА GIT:\n" + git_report
        refresh_git_asset_list()
        print("[Grade Optimizer] " + message.replace("\n", " | "))
        cmds.confirmDialog(
            title="Grade Optimizer · Scene asset export complete",
            message=message,
            button=["OK"]
        )
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
        if 'temporary_export_roots' in locals() and temporary_export_roots:
            try:
                existing_temp_roots = [
                    node for node in temporary_export_roots if cmds.objExists(node)
                ]
                if existing_temp_roots:
                    cmds.delete(existing_temp_roots)
            except Exception as cleanup_error:
                cmds.warning("[Grade Optimizer] Could not remove temporary export copies: " + str(cleanup_error))
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
    cmds.rowLayout(numberOfColumns=2, adjustableColumn=1, columnWidth2=(390, 145))
    cmds.text(WINDOW + "_repo_status", label="Git-папка ещё не проверена.", align="left", height=24, wordWrap=True)
    cmds.button(label="ПРОВЕРИТЬ ПАПКУ", height=26, command=check_git_repository)
    cmds.setParent("..")

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
        label="ОБЪЕКТЫ ПРОЕКТА + БАЗОВЫЙ РЕЛЬЕФ",
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
        label="«Основной рельеф» показан отдельной категорией. При его замене выбирай только terrainShape; CAD Bridge offset / scale будут отменены на временных копиях.",
        align="left", height=42, wordWrap=True
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
    remember_export_settings()
    refresh_git_asset_list()
    return WINDOW

# Maya Script Editor: execute this file, then call show().
