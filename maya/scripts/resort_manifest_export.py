# -*- coding: utf-8 -*-
"""Resort Scene Manifest Helper — Maya MVP 0.1. Adds metadata and exports JSON only."""
import json, os, re
try:
    import maya.cmds as cmds
except ImportError:
    cmds = None

WINDOW_NAME = "resortSceneManifestHelper"
CATEGORIES = ("terrain","slope","forest","building","lift","infrastructure","vegetation","prop","lighting")
PHASES = ("always","stage_1","stage_2")
UNIT_SCALE = {"mm":0.001,"cm":0.01,"m":1.0,"km":1000.0,"in":0.0254,"ft":0.3048,"yd":0.9144}

def _maya():
    if cmds is None:
        raise RuntimeError("Run this script inside Autodesk Maya.")

def _slug(value):
    text = re.sub(r"[^A-Za-z0-9_.-]+","_",value.strip("|").replace("|","_"))
    return re.sub(r"_+","_",text).strip("_.-") or "resort_asset"

def _add_string(node,name,value):
    if not cmds.attributeQuery(name,node=node,exists=True):
        cmds.addAttr(node,longName=name,dataType="string")
        cmds.setAttr(node+"."+name,str(value),type="string")

def _add_bool(node,name,value):
    if not cmds.attributeQuery(name,node=node,exists=True):
        cmds.addAttr(node,longName=name,attributeType="bool",defaultValue=bool(value))
        cmds.setAttr(node+"."+name,bool(value))

def _add_double(node,name,value):
    if not cmds.attributeQuery(name,node=node,exists=True):
        cmds.addAttr(node,longName=name,attributeType="double",defaultValue=float(value))
        cmds.setAttr(node+"."+name,float(value))

def _short(node):
    return node.rsplit("|",1)[-1]

def _selected_transforms():
    result=[]
    for node in cmds.ls(selection=True,long=True) or []:
        if cmds.nodeType(node)=="transform":
            result.append(node)
        else:
            result.extend(cmds.listRelatives(node,parent=True,fullPath=True,type="transform") or [])
    return sorted(set(result))

def add_metadata_to_selection():
    _maya()
    roots=_selected_transforms()
    if not roots:
        cmds.warning("Select one or more Maya transforms first.")
        return
    candidates=set(roots)
    for root in roots:
        candidates.update(cmds.listRelatives(root,allDescendents=True,type="transform",fullPath=True) or [])
    nodes=[]
    for node in sorted(candidates):
        shapes=cmds.listRelatives(node,shapes=True,noIntermediate=True,fullPath=True) or []
        if any(cmds.nodeType(shape) in ("mesh","nurbsSurface") for shape in shapes):
            nodes.append(node)
    if not nodes:
        cmds.warning("The selected group contains no mesh/NURBS transforms.")
        return
    for node in nodes:
        _add_string(node,"web_id",_slug(node))
        _add_string(node,"web_category","prop")
        _add_string(node,"web_phase","always")
        _add_string(node,"web_material_profile","")
        _add_string(node,"web_asset_uri","")
        _add_bool(node,"web_visible",True)
        _add_bool(node,"web_collision",False)
        _add_bool(node,"web_forest_blocker",False)
        _add_double(node,"web_depth_bias_factor",-1.0)
        _add_double(node,"web_depth_bias_units",-1.0)
    cmds.inViewMessage(amg="Web metadata added to <hl>{}</hl> transform(s).".format(len(nodes)),pos="topCenter",fade=True)

def _has_shape(node):
    shapes=cmds.listRelatives(node,shapes=True,noIntermediate=True,fullPath=True) or []
    return any(cmds.nodeType(s) in ("mesh","nurbsSurface") for s in shapes)

def _candidates():
    roots=_selected_transforms()
    if roots:
        nodes=set(roots)
        for root in roots:
            nodes.update(cmds.listRelatives(root,allDescendents=True,type="transform",fullPath=True) or [])
    else:
        nodes=set(cmds.ls(type="transform",long=True) or [])
    return sorted(n for n in nodes if _has_shape(n))

def _get(node,attr,default=None):
    if not cmds.attributeQuery(attr,node=node,exists=True):
        return default
    value=cmds.getAttr(node+"."+attr)
    return default if value is None else value

def build_manifest():
    _maya()
    assets=[]
    seen=set()
    for node in _candidates():
        asset_id=str(_get(node,"web_id",_slug(node)))
        category=str(_get(node,"web_category","prop"))
        phase=str(_get(node,"web_phase","always"))
        if category not in CATEGORIES:
            raise RuntimeError("{}: invalid web_category '{}'".format(node,category))
        if phase not in PHASES:
            raise RuntimeError("{}: invalid web_phase '{}'".format(node,phase))
        if asset_id in seen:
            raise RuntimeError("Duplicate web_id '{}'. IDs must be unique.".format(asset_id))
        seen.add(asset_id)
        uri=str(_get(node,"web_asset_uri","") or "").strip() or "assets/resort/{}.glb".format(asset_id)
        item={"id":asset_id,"name":_short(node),"nodeName":_short(node),"sourcePath":node,
              "category":category,"uri":uri.replace("\\","/"),"phase":phase,
              "visible":bool(_get(node,"web_visible",True)),
              "collision":bool(_get(node,"web_collision",False)),
              "forestBlocker":bool(_get(node,"web_forest_blocker",False))}
        profile=str(_get(node,"web_material_profile","") or "").strip()
        if profile:
            item["materialProfile"]=profile
        if category=="slope":
            item["renderDepthBias"]={"factor":float(_get(node,"web_depth_bias_factor",-1.0)),
                                     "units":float(_get(node,"web_depth_bias_units",-1.0))}
        assets.append(item)
    assets.sort(key=lambda a:(a["category"],a["id"]))
    if not assets:
        raise RuntimeError("No mesh/NURBS transforms found under selected root(s).")
    source_unit=cmds.currentUnit(query=True,linear=True)
    scene_file=cmds.file(query=True,sceneName=True) or "Resort Scene"
    scene_name=os.path.splitext(os.path.basename(scene_file))[0]
    return {"schemaVersion":"1.0",
      "scene":{"id":_slug(scene_name),"name":scene_name,"units":"meters","sourceUnits":source_unit,
       "unitScaleToMeters":UNIT_SCALE.get(source_unit,1.0),
       "coordinateSystem":{"upAxis":"Y","forwardAxis":"-Z","handedness":"right"},"defaultPhase":"stage_1"},
      "assets":assets,"forestMasks":[],"materialProfiles":[]}

def export_scene_manifest():
    _maya()
    try:
        data=build_manifest()
    except Exception as exc:
        cmds.confirmDialog(title="Manifest validation",message=str(exc),button=["OK"],defaultButton="OK")
        return
    paths=cmds.fileDialog2(fileMode=0,caption="Export Resort Scene Manifest",fileFilter="JSON (*.json)",dialogStyle=2)
    if not paths:
        return
    path=paths[0]
    if not path.lower().endswith(".json"):
        path += ".json"
    with open(path,"w",encoding="utf-8") as stream:
        json.dump(data,stream,ensure_ascii=False,indent=2)
        stream.write("\n")
    cmds.inViewMessage(amg="Manifest exported: <hl>{}</hl>".format(path),pos="topCenter",fade=True)
    return path

def show_ui():
    _maya()
    if cmds.window(WINDOW_NAME,exists=True):
        cmds.deleteUI(WINDOW_NAME)
    win=cmds.window(WINDOW_NAME,title="Resort Export Helper · Manifest MVP 0.1",sizeable=False,widthHeight=(370,190))
    cmds.columnLayout(adjustableColumn=True,rowSpacing=8,columnAttach=("both",12))
    cmds.text(label="Select mesh transforms or a parent group. Add metadata, edit web_category / web_phase in Attribute Editor, then export the sidecar.",align="left",wordWrap=True,height=70)
    cmds.button(label="ADD WEB METADATA TO SELECTION",height=38,command=lambda *_:add_metadata_to_selection())
    cmds.button(label="EXPORT scene-manifest.json",height=42,backgroundColor=(0.24,0.46,0.34),command=lambda *_:export_scene_manifest())
    cmds.text(label="MVP: metadata only. Batch GLB export is the next milestone.",align="left",wordWrap=True,height=34)
    cmds.showWindow(win)

if __name__=="__main__" and cmds is not None:
    show_ui()
