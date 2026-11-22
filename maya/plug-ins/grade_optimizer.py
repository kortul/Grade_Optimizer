# -*- coding: utf-8 -*-
"""Grade Optimizer Maya plug-in entry point.

Install the containing module, then load this file from Maya Plug-in Manager.
It adds a Grade Optimizer menu and the gradeOptimizerOpen command.
"""
import importlib
import os
import sys

import maya.cmds as cmds
import maya.utils as maya_utils
import maya.api.OpenMaya as om

VERSION = "0.2.0"
COMMAND_NAME = "gradeOptimizerOpen"
MENU_NAME = "gradeOptimizerMenu"
MENU_LABEL = "Grade Optimizer"


def _module_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _show_exporter():
    root = _module_root()
    if root not in sys.path:
        sys.path.insert(0, root)
    module = importlib.import_module("grade_optimizer_exporter")
    module = importlib.reload(module)
    module.show()


class GradeOptimizerOpenCommand(om.MPxCommand):
    @staticmethod
    def creator():
        return GradeOptimizerOpenCommand()

    def doIt(self, args):
        _show_exporter()


def _build_menu():
    try:
        if cmds.menu(MENU_NAME, exists=True):
            cmds.deleteUI(MENU_NAME)
        menu = cmds.menu(
            MENU_NAME,
            label=MENU_LABEL,
            parent="MayaWindow",
            tearOff=True
        )
        cmds.menuItem(
            label="Open Exporter…",
            parent=menu,
            command=lambda *_: cmds.gradeOptimizerOpen()
        )
        cmds.menuItem(divider=True, parent=menu)
        cmds.menuItem(label="Grade Optimizer " + VERSION, parent=menu, enable=False)
    except Exception as exc:
        om.MGlobal.displayWarning(
            "Grade Optimizer plug-in loaded, but menu creation failed: " + str(exc)
        )


def initializePlugin(plugin_object):
    plugin = om.MFnPlugin(plugin_object, "Grade Optimizer", VERSION, "Any")
    plugin.registerCommand(COMMAND_NAME, GradeOptimizerOpenCommand.creator)
    try:
        maya_utils.executeDeferred(_build_menu)
    except Exception:
        _build_menu()
    om.MGlobal.displayInfo("Grade Optimizer Maya plug-in " + VERSION + " loaded.")


def uninitializePlugin(plugin_object):
    try:
        if cmds.menu(MENU_NAME, exists=True):
            cmds.deleteUI(MENU_NAME)
    except Exception:
        pass
    plugin = om.MFnPlugin(plugin_object)
    plugin.deregisterCommand(COMMAND_NAME)
    om.MGlobal.displayInfo("Grade Optimizer Maya plug-in unloaded.")
