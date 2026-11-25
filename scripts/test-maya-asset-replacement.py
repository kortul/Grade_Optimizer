#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression tests for the Maya Exporter's client-model replacement inventory."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types


def _load_exporter_with_maya_stubs():
    """The inventory and manifest helpers do not need a running Maya session."""
    maya_package = types.ModuleType("maya")
    maya_package.__path__ = []
    cmds_module = types.ModuleType("maya.cmds")
    mel_module = types.ModuleType("maya.mel")
    api_package = types.ModuleType("maya.api")
    api_package.__path__ = []
    open_maya_module = types.ModuleType("maya.api.OpenMaya")

    maya_package.cmds = cmds_module
    maya_package.mel = mel_module
    maya_package.api = api_package
    api_package.OpenMaya = open_maya_module
    sys.modules.update({
        "maya": maya_package,
        "maya.cmds": cmds_module,
        "maya.mel": mel_module,
        "maya.api": api_package,
        "maya.api.OpenMaya": open_maya_module,
    })

    exporter_path = Path(__file__).resolve().parents[1] / "maya" / "grade_optimizer_exporter.py"
    spec = importlib.util.spec_from_file_location("grade_optimizer_exporter_test", str(exporter_path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    cmds_module.currentUnit = lambda **kwargs: "cm"
    cmds_module.file = lambda **kwargs: "stage1_replacement.ma"
    cmds_module.about = lambda **kwargs: "2026"
    module._selected_transforms = lambda: []
    return module


def _write_bytes(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def main():
    exporter = _load_exporter_with_maya_stubs()
    with tempfile.TemporaryDirectory(prefix="go-maya-replacement-") as temp_root:
        repo = Path(temp_root)
        client_dir = repo / "clients" / "test-resort"
        models = client_dir / "models"
        models.mkdir(parents=True)
        scene_path = client_dir / "scene.json"

        glb_payload = b"glb-source-model"
        old_fbx_payload = b"old-fbx-model-for-replacement"
        regular_fbx_payload = b"existing-fbx-model"
        _write_bytes(models / "slopes_stage1.glb", glb_payload)
        _write_bytes(models / "slopes_stage1.fbx", old_fbx_payload)
        _write_bytes(models / "station.fbx", regular_fbx_payload)
        _write_bytes(models / "unsupported.obj", b"obj-model")

        manifest = {
            "schemaVersion": "1.0",
            "clientId": "test-resort",
            "assets": [
                {
                    "id": "slopes_stage1",
                    "name": "Slopes_Stage1",
                    "file": "models/slopes_stage1.glb",
                    "category": "slope",
                    "phase": "stage_1",
                    "activeTerrain": False,
                    "visible": True,
                    "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]},
                    "collision": False,
                    "forestBlocker": True,
                    "nodeVisibility": [],
                    "nodeMetadata": [],
                },
                {
                    "id": "station",
                    "name": "Station",
                    "file": "models/station.fbx",
                    "category": "building",
                    "phase": "always",
                },
                {
                    "id": "unsupported",
                    "name": "Unsupported",
                    "file": "models/unsupported.obj",
                    "category": "prop",
                },
                {
                    "id": "missing",
                    "name": "Missing FBX",
                    "file": "models/missing.fbx",
                    "category": "prop",
                },
            ],
        }
        scene_path.write_text(json.dumps(manifest), encoding="utf-8")

        client_slug, assets, unsupported_count, missing_count = exporter.list_replaceable_client_assets(str(repo))
        assert client_slug == "test-resort"
        assert {asset["id"] for asset in assets} == {"slopes_stage1", "station"}
        assert unsupported_count == 1, "unsupported formats should be counted but excluded"
        assert missing_count == 1, "missing source models should be counted but excluded"

        stage1 = next(asset for asset in assets if asset["id"] == "slopes_stage1")
        assert stage1["_relative_file"] == "models/slopes_stage1.glb"
        assert stage1["_replacement_relative_file"] == "models/slopes_stage1.fbx"
        assert stage1["_format_conversion"] == "GLB → FBX"
        assert stage1["_model_path"] == str(models / "slopes_stage1.glb")
        assert stage1["_replacement_model_path"] == str(models / "slopes_stage1.fbx")
        assert stage1["_size_bytes"] == len(glb_payload)
        assert "GLB → FBX" in stage1["_label"]

        station = next(asset for asset in assets if asset["id"] == "station")
        assert station["_relative_file"] == "models/station.fbx"
        assert station["_replacement_relative_file"] == "models/station.fbx"
        assert station["_format_conversion"] == ""

        # A GLB replacement keeps the same asset ID and Web Editor settings,
        # writes a same-stem FBX, and changes only the manifest's file pointer.
        export_info = exporter.prepare_client_asset_export(
            str(repo),
            [{"name": "New_Stage1_Root", "materials": ["Snow_MAT"]}],
            [],
            replace_asset_id="slopes_stage1",
        )
        assert export_info["asset_id"] == "slopes_stage1"
        assert export_info["source_relative_file"] == "models/slopes_stage1.glb"
        assert export_info["relative_file"] == "models/slopes_stage1.fbx"
        assert export_info["format_conversion"] == "GLB → FBX"
        assert export_info["model_path"] == str(models / "slopes_stage1.fbx")
        assert export_info["existing_size_bytes"] == len(old_fbx_payload)
        assert export_info["source_size_bytes"] == len(glb_payload)
        stage1_entry = next(asset for asset in export_info["manifest"]["assets"] if asset["id"] == "slopes_stage1")
        assert stage1_entry["file"] == "models/slopes_stage1.fbx"
        assert stage1_entry["name"] == "Slopes_Stage1"
        assert stage1_entry["category"] == "slope"
        assert stage1_entry["phase"] == "stage_1"
        assert stage1_entry["activeTerrain"] is False
        assert stage1_entry["forestBlocker"] is True
        assert stage1_entry["transform"]["scale"] == [0.01, 0.01, 0.01]
        assert (models / "slopes_stage1.glb").read_bytes() == glb_payload, "the original GLB must be preserved"
        assert export_info["temporary_model_path"].endswith(".fbx.exporting.fbx")

        # An ordinary FBX target retains its existing output path.
        station_info = exporter.prepare_client_asset_export(
            str(repo),
            [{"name": "New_Station_Root", "materials": []}],
            [],
            replace_asset_id="station",
        )
        assert station_info["relative_file"] == "models/station.fbx"
        assert station_info["format_conversion"] == ""
        assert station_info["model_path"] == str(models / "station.fbx")

        # Paths outside the client models directory must remain rejected.
        try:
            exporter._resolve_replacement_fbx_target(str(client_dir), "../outside.glb")
        except RuntimeError:
            pass
        else:
            raise AssertionError("path traversal must be rejected")

    print("✓ Maya exporter: GLB assets appear in replacement inventory and convert safely to sibling FBX")
    print("✓ Maya exporter: Stage1 ID, phase, placement and Web Editor flags survive GLB→FBX replacement")
    print("✓ Maya exporter: original GLB remains available as rollback; FBX replacements keep their path")


if __name__ == "__main__":
    main()
