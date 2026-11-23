# -*- coding: utf-8 -*-
"""
Build a deterministic Maya scene for validating Grade Optimizer FBX export.
This intentionally replaces the current Maya scene after explicit confirmation.
"""
import maya.cmds as cmds


CONFIRM_BUTTON = "Create test scene"


def _group(name, parent=None):
    node = cmds.group(empty=True, name=name)
    if parent:
        node = cmds.parent(node, parent, absolute=True)[0]
    return node


def _parent(node, parent):
    return cmds.parent(node, parent, absolute=True)[0]


def _place(node, position):
    cmds.xform(node, worldSpace=True, translation=position)
    return node


def _material(name, color):
    shader = cmds.shadingNode("lambert", asShader=True, name=name)
    shading_group = cmds.sets(
        renderable=True,
        noSurfaceShader=True,
        empty=True,
        name=name + "SG"
    )
    cmds.connectAttr(shader + ".outColor", shading_group + ".surfaceShader", force=True)
    cmds.setAttr(shader + ".color", color[0], color[1], color[2], type="double3")
    cmds.setAttr(shader + ".diffuse", 0.8)
    return shading_group


def _assign(shading_group, node):
    cmds.sets(node, edit=True, forceElement=shading_group)


def _add_string(node, attribute, value):
    if not cmds.attributeQuery(attribute, node=node, exists=True):
        cmds.addAttr(node, longName=attribute, dataType="string")
    cmds.setAttr(node + "." + attribute, value, type="string")


def _metadata(node, role="", tags=""):
    # Collision and Forest blocker are configured later in the Web Editor.
    _add_string(node, "goRole", role)
    _add_string(node, "goTags", tags)


def _cube(name, parent, size, position, shading_group=None):
    node = cmds.polyCube(
        name=name,
        width=size[0],
        height=size[1],
        depth=size[2]
    )[0]
    node = _parent(node, parent)
    _place(node, position)
    if shading_group:
        _assign(shading_group, node)
    return node


def create_test_scene():
    """Create a compact but feature-rich FBX export fixture."""
    choice = cmds.confirmDialog(
        title="Grade Optimizer · Create FBX Test Scene",
        message=(
            "Это заменит текущую сцену Maya новой тестовой сценой.\n\n"
            "Внутри будут вложенные группы, общие материалы, два material slots, "
            "скрытый узел и повторяющиеся имена в разных ветках.\n\n"
            "Продолжить?"
        ),
        button=[CONFIRM_BUTTON, "Cancel"],
        defaultButton="Cancel",
        cancelButton="Cancel",
        dismissString="Cancel"
    )
    if choice != CONFIRM_BUTTON:
        return None

    cmds.file(new=True, force=True)
    # Use metres so the sample's dimensions are predictable in the web editor.
    cmds.currentUnit(linear="m")

    root = _group("GO_Test_Resort_GRP")
    terrain_group = _group("01_Terrain_GRP", root)
    lift_group = _group("02_Lift_GRP", root)
    station_group = _group("03_Stations_GRP", root)
    blocker_group = _group("04_Forest_Blockers_GRP", root)
    hidden_group = _group("05_Hidden_Test_Nodes_GRP", root)

    snow_sg = _material("GO_Shared_Snow_MAT", (0.82, 0.88, 0.94))
    concrete_sg = _material("GO_Concrete_MAT", (0.38, 0.42, 0.46))
    glass_sg = _material("GO_Glass_MAT", (0.12, 0.28, 0.36))
    metal_sg = _material("GO_Lift_Metal_MAT", (0.18, 0.2, 0.22))

    terrain = cmds.polyPlane(
        name="Terrain_Surface",
        width=80,
        height=60,
        subdivisionsX=8,
        subdivisionsY=8
    )[0]
    terrain = _parent(terrain, terrain_group)
    _place(terrain, (0, -0.5, 0))
    _assign(snow_sg, terrain)
    _metadata(terrain_group, "terrain", "test,ground")

    north_group = _group("North_Row_GRP", lift_group)
    south_group = _group("South_Row_GRP", lift_group)
    north_pylon = _cube(
        "Pylon_North_TEMP", north_group, (1.2, 6, 1.2), (-8, 3, -10), metal_sg
    )
    north_pylon = cmds.rename(north_pylon, "Pylon")
    south_pylon = _cube(
        "Pylon_South_TEMP", south_group, (1.2, 6, 1.2), (-8, 3, 10), metal_sg
    )
    # The same leaf name in separate DAG branches checks namePath metadata matching.
    south_pylon = cmds.rename(south_pylon, "Pylon")
    _metadata(lift_group, "lift", "test,gondola")
    _metadata(north_pylon, "lift-support", "test,north")
    _metadata(south_pylon, "lift-support", "test,south")

    upper_station_group = _group("Upper_Station_GRP", station_group)
    station_body = _cube(
        "Station_Building", upper_station_group,
        (9, 4, 7), (13, 2, 0), concrete_sg
    )
    # Give one mesh two real shading assignments / material slots.
    cmds.sets(station_body + ".f[0:2]", edit=True, forceElement=glass_sg)
    station_roof = _cube(
        "Station_Roof", upper_station_group,
        (9.5, 0.5, 7.5), (13, 4.25, 0), snow_sg
    )
    _metadata(station_group, "station", "test,architecture")
    _metadata(station_body, "station-building", "test,multi-material")
    _metadata(station_roof, "station-roof", "test,shared-snow")

    blocker = _cube(
        "Forest_Blocker_Test_Mesh", blocker_group,
        (2.5, 2, 2.5), (4, 1, 12), concrete_sg
    )
    _metadata(blocker_group, "forest-blockers", "test,environment")
    _metadata(blocker, "rock-obstacle", "test,forest-blocker")

    hidden_marker = cmds.polySphere(
        name="Hidden_Survey_Marker",
        radius=0.55,
        subdivisionsX=12,
        subdivisionsY=8
    )[0]
    hidden_marker = _parent(hidden_marker, hidden_group)
    _place(hidden_marker, (25, 1, 0))
    _assign(metal_sg, hidden_marker)
    cmds.setAttr(hidden_marker + ".visibility", False)
    _metadata(hidden_group, "test-hidden-branch", "test,visibility")
    _metadata(hidden_marker, "survey-marker", "test,hidden")

    _metadata(root, "resort", "grade-optimizer,test-scene")
    try:
        cmds.viewFit("persp", all=True)
    except Exception:
        pass
    cmds.select(terrain_group, replace=True)

    message = (
        "Тестовая сцена создана.\n\n"
        "Проверь в Outliner: GO_Test_Resort_GRP.\n"
        "Затем открой Grade Optimizer → Open Exporter… и экспортируй всю сцену "
        "с Client ID: maya-fbx-test.\n\n"
        "Ожидается: 5 верхнеуровневых веток, 7 mesh objects, "
        "общий GO_Shared_Snow_MAT на двух mesh, 2 slots на Station_Building, "
        "скрытый Hidden_Survey_Marker и два узла Pylon с разными namePath."
    )
    cmds.confirmDialog(
        title="Grade Optimizer · Test Scene Ready",
        message=message,
        button=["OK"]
    )
    print("[Grade Optimizer] " + message.replace("\n", " | "))
    return root
