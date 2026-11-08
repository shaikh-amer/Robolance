# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenLance
#
# Blender -> robot simulation. Run as
#   blender -b scene.blend --factory-startup --python-exit-code 1 -P export_scene.py -- '<json>'
# with {"mode": "mjcf" | "obstacles", "out": ..., ...}. Prints one line,
# ROBOLANCE_RESULT {json}, with what it wrote and any warnings.
#
# mjcf: every mesh object becomes a MuJoCo body (Blender parents become
#   body parents), with its full mesh for the eye and a convex hull (or a
#   box, or one hull per loose part) for collisions and inertia. Custom
#   properties on an object set the physics:
#     joint        "hinge" | "slide" | "ball" | "free"   (none: fixed to its parent)
#     joint_axis   "x" | "y" | "z" in the object's own axes (default "z")
#     joint_range  "lo,hi" (degrees for a hinge, metres for a slide)
#     joint_damping, joint_armature   numbers
#     actuator     "motor" | "position" | "velocity" on a jointed object
#     gear, kp, kv, ctrl_range ("lo,hi")
#     mass (kg) or density (kg/m^3, default the export's density)
#     collision    "hull" (default) | "parts" | "box" | "none"
#     skip         true: leave the object out
# obstacles: every mesh object's loose parts that reach below max_height
#   become boxes for the Microduck pitch (field.obstacles): x, y, width
#   (along the heading), depth, height, heading.

import bmesh
import bpy
import json
import math
import os
import re
import struct
import sys
from mathutils import Matrix, Vector

RESULT_MARK = "ROBOLANCE_RESULT "


def args():
    argv = sys.argv
    return json.loads(argv[argv.index("--") + 1]) if "--" in argv else {}


A = args()
warnings = []


def warn(msg):
    if len(warnings) < 50:
        warnings.append(msg)


def objects():
    coll = A.get("collection")
    if coll:
        c = bpy.data.collections.get(coll)
        if c is None:
            raise SystemExit("no collection named %r in the file" % coll)
        pool = c.all_objects
    else:
        pool = bpy.context.scene.objects
    out = []
    for o in pool:
        if o.type != "MESH" or o.hide_render or o.get("skip"):
            continue
        out.append(o)
    return out


def rigid(m):
    loc, rot, _scale = m.decompose()
    return Matrix.Translation(loc) @ rot.to_matrix().to_4x4()


def evaluated_bmesh(obj, transform, max_faces=0):
    """Triangulated geometry of obj after modifiers, in `transform` space."""
    dg = bpy.context.evaluated_depsgraph_get()
    added = None
    faces = len(obj.data.polygons)
    if max_faces and faces > max_faces:
        added = obj.modifiers.new("robolance_decimate", "DECIMATE")
        added.ratio = max(0.01, max_faces / faces)
        dg.update()
        warn("%s: %d faces simplified to about %d" % (obj.name, faces, max_faces))
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    ev.to_mesh_clear()
    if added is not None:
        obj.modifiers.remove(added)
        dg.update()
    bm.transform(transform)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def write_stl(path, bm):
    tris = [f for f in bm.faces if len(f.verts) == 3]
    with open(path, "wb") as fh:
        fh.write(b"robolance".ljust(80, b" "))
        fh.write(struct.pack("<I", len(tris)))
        for f in tris:
            n = f.normal
            fh.write(struct.pack("<3f", n.x, n.y, n.z))
            for v in f.verts:
                fh.write(struct.pack("<3f", v.co.x, v.co.y, v.co.z))
            fh.write(b"\0\0")
    return len(tris)


def hull_of(verts):
    bm = bmesh.new()
    for co in verts:
        bm.verts.new(co)
    if len(bm.verts) < 4:
        bm.free()
        return None, 0.0
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.delete(bm, geom=list(set(res["geom_interior"]) | set(res["geom_unused"])), context="VERTS")
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    vol = abs(bm.calc_volume()) if bm.faces else 0.0
    return bm, vol


def islands(bm):
    seen = set()
    parts = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, verts = [f], set()
        seen.add(f.index)
        while stack:
            g = stack.pop()
            for v in g.verts:
                verts.add(v)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        parts.append([v.co.copy() for v in verts])
    return parts


def bounds(verts):
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def fmt(*vals):
    return " ".join("%.6g" % (0.0 if abs(v) < 1e-12 else v) for v in vals)


def pair(value, what):
    if value is None:
        return None
    if isinstance(value, str):
        bits = [b for b in re.split(r"[,\s]+", value.strip()) if b]
    else:
        bits = list(value)
    try:
        lo, hi = float(bits[0]), float(bits[1])
    except (IndexError, ValueError, TypeError):
        warn("%s: %r is not 'lo,hi'" % (what, value))
        return None
    return (lo, hi) if lo < hi else (hi, lo)


def material_rgba(obj):
    for slot in obj.material_slots:
        m = slot.material
        if m is None:
            continue
        if m.use_nodes and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    c = n.inputs["Base Color"].default_value
                    a = n.inputs["Alpha"].default_value if "Alpha" in n.inputs else 1.0
                    return (c[0], c[1], c[2], a)
        c = m.diffuse_color
        return (c[0], c[1], c[2], c[3])
    return None


names = {}


def unique(name):
    base = re.sub(r"[^A-Za-z0-9_\-]+", "_", name).strip("_") or "part"
    n, i = base, 2
    while n in names:
        n = "%s_%d" % (base, i)
        i += 1
    names[n] = True
    return n


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


# ---------------------------------------------------------------- mjcf ----
def export_mjcf():
    out = A["out"]
    mesh_dir = os.path.join(out, "meshes")
    os.makedirs(mesh_dir, exist_ok=True)
    density = float(A.get("density") or 1000.0)
    max_faces = int(A.get("maxFaces") or 50000)
    objs = objects()
    if not objs:
        raise SystemExit("no visible mesh objects to export")
    included = set(objs)

    def parent_of(o):
        p = o.parent
        while p is not None and p not in included:
            p = p.parent
        return p

    children = {}
    roots = []
    for o in objs:
        p = parent_of(o)
        if p is None:
            roots.append(o)
        else:
            children.setdefault(p, []).append(o)

    assets, bodies, actuators, materials, excludes = [], [], [], {}, []
    stats = {"bodies": 0, "joints": 0, "actuators": 0, "triangles": 0, "hulls": 0}
    body_names = {}
    lo_all, hi_all = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))

    def body_xml(o, parent_rigid, depth, parent_name=None):
        ind = "  " * depth
        name = unique(o.name)
        body_names[o.name] = name
        world_rigid = rigid(o.matrix_world)
        local = parent_rigid.inverted() @ world_rigid
        loc, rot, _ = local.decompose()
        lines = ['%s<body name="%s" pos="%s" quat="%s">' % (ind, esc(name), fmt(*loc), fmt(rot.w, rot.x, rot.y, rot.z))]

        joint = str(o.get("joint", "")).strip().lower()
        jname = None
        if joint == "free":
            if parent_of(o) is not None:
                warn("%s: a free joint only works on a top-level object; ignored" % o.name)
            else:
                jname = name + "_free"
                lines.append('%s  <freejoint name="%s"/>' % (ind, esc(jname)))
                stats["joints"] += 1
        elif joint in ("hinge", "slide", "ball"):
            jname = name + "_joint"
            attrs = ['name="%s"' % esc(jname), 'type="%s"' % joint]
            if joint != "ball":
                axis = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}.get(str(o.get("joint_axis", "z")).lower())
                if axis is None:
                    warn("%s: joint_axis must be x, y or z; using z" % o.name)
                    axis = (0, 0, 1)
                attrs.append('axis="%s"' % fmt(*axis))
                rng = pair(o.get("joint_range"), o.name + " joint_range")
                if rng:
                    attrs.append('range="%s" limited="true"' % fmt(*rng))
            attrs.append('damping="%s"' % fmt(float(o.get("joint_damping", 0.05))))
            if o.get("joint_armature") is not None:
                attrs.append('armature="%s"' % fmt(float(o.get("joint_armature"))))
            lines.append("%s  <joint %s/>" % (ind, " ".join(attrs)))
            stats["joints"] += 1
            if parent_name:
                # A joint's two sides touch where they meet; MuJoCo does not
                # filter that contact when the parent is fixed to the world,
                # and the friction would hold the joint still.
                excludes.append('    <exclude body1="%s" body2="%s"/>' % (esc(parent_name), esc(name)))
        elif joint:
            warn("%s: joint %r is not hinge, slide, ball or free; fixed" % (o.name, joint))

        act = str(o.get("actuator", "")).strip().lower()
        if act:
            if not jname or joint in ("free", "ball"):
                warn("%s: an actuator needs a hinge or slide joint; ignored" % o.name)
            elif act not in ("motor", "position", "velocity"):
                warn("%s: actuator %r is not motor, position or velocity; ignored" % (o.name, act))
            else:
                attrs = ['name="%s"' % esc(name), 'joint="%s"' % esc(jname)]
                cr = pair(o.get("ctrl_range"), o.name + " ctrl_range")
                if cr:
                    attrs.append('ctrlrange="%s" ctrllimited="true"' % fmt(*cr))
                if act == "motor":
                    attrs.append('gear="%s"' % fmt(float(o.get("gear", 1.0))))
                elif act == "position":
                    attrs.append('kp="%s"' % fmt(float(o.get("kp", 10.0))))
                else:
                    attrs.append('kv="%s"' % fmt(float(o.get("kv", 1.0))))
                actuators.append("    <%s %s/>" % (act, " ".join(attrs)))
                stats["actuators"] += 1

        # Geometry in the body's frame (scale and shear baked in).
        to_body = world_rigid.inverted() @ o.matrix_world
        bm = evaluated_bmesh(o, to_body, max_faces)
        if not bm.faces:
            warn("%s: no faces" % o.name)
        else:
            vis = name + "_visual"
            stats["triangles"] += write_stl(os.path.join(mesh_dir, vis + ".stl"), bm)
            # Visual geoms weigh nothing, but MuJoCo still measures every
            # mesh: "shell" works for open and flat ones too (a sign, a leaf).
            assets.append('    <mesh name="%s" file="meshes/%s.stl" inertia="shell"/>' % (esc(vis), esc(vis)))
            rgba = material_rgba(o)
            mat = ""
            if rgba:
                key = "%s" % fmt(*rgba)
                if key not in materials:
                    materials[key] = "mat%d" % (len(materials) + 1)
                mat = ' material="%s"' % materials[key]
            lines.append('%s  <geom name="%s" class="visual" type="mesh" mesh="%s"%s/>' % (ind, esc(vis), esc(vis), mat))
            wverts = [o.matrix_world @ (to_body.inverted() @ v.co) for v in bm.verts]
            lo, hi = bounds(wverts)
            for i in range(3):
                lo_all[i] = min(lo_all[i], lo[i])
                hi_all[i] = max(hi_all[i], hi[i])

            mode = str(o.get("collision", "hull")).strip().lower()
            if mode not in ("hull", "parts", "box", "none"):
                warn("%s: collision %r is not hull, parts, box or none; using hull" % (o.name, mode))
                mode = "hull"
            groups = []
            if mode == "parts":
                groups = islands(bm)
                if len(groups) > 64:
                    warn("%s: %d loose parts; using one hull (split the object for finer collisions)" % (o.name, len(groups)))
                    groups = [[v.co.copy() for v in bm.verts]]
            elif mode in ("hull", "box"):
                groups = [[v.co.copy() for v in bm.verts]]
            shapes = []  # (xml without mass, volume)
            for gi, verts in enumerate(groups):
                cname = "%s_collision%s" % (name, "" if len(groups) == 1 else str(gi + 1))
                hull, vol = (None, 0.0) if mode == "box" else hull_of(verts)
                if hull is not None and vol > 1e-9:
                    stats["hulls"] += 1
                    write_stl(os.path.join(mesh_dir, cname + ".stl"), hull)
                    hull.free()
                    assets.append('    <mesh name="%s" file="meshes/%s.stl"/>' % (esc(cname), esc(cname)))
                    shapes.append(('type="mesh" mesh="%s"' % esc(cname), vol, cname))
                    continue
                if hull is not None:
                    hull.free()
                # Flat or tiny: a box, at least 1 mm thick.
                lo, hi = bounds(verts)
                half = [max((hi[i] - lo[i]) / 2, 0.0005) for i in range(3)]
                c = (lo + hi) / 2
                if mode != "box":
                    warn("%s: flat or open shape, colliding as a box" % o.name)
                shapes.append(('type="box" size="%s" pos="%s"' % (fmt(*half), fmt(*c)), 8 * half[0] * half[1] * half[2], cname))
            total = sum(v for _, v, _ in shapes) or 1.0
            mass = o.get("mass")
            for shape, vol, cname in shapes:
                if mass is not None:
                    weight = 'mass="%s"' % fmt(float(mass) * vol / total)
                else:
                    weight = 'density="%s"' % fmt(float(o.get("density", density)))
                lines.append('%s  <geom name="%s" class="collision" %s %s/>' % (ind, esc(cname), shape, weight))
        bm.free()
        stats["bodies"] += 1
        for ch in children.get(o, []):
            lines.extend(body_xml(ch, world_rigid, depth + 1, name))
        lines.append("%s</body>" % ind)
        return lines

    for r in roots:
        bodies.extend(body_xml(r, Matrix.Identity(4), 2))

    model = re.sub(r"[^A-Za-z0-9_\-]+", "_", A.get("model") or os.path.splitext(os.path.basename(bpy.data.filepath))[0] or "scene")
    xml = ['<mujoco model="%s">' % esc(model),
           '  <compiler angle="degree" meshdir="."/>',
           '  <option timestep="0.002"/>',
           "  <default>",
           '    <default class="visual"><geom contype="0" conaffinity="0" group="2" density="0"/></default>',
           '    <default class="collision"><geom group="3" condim="3" friction="0.8 0.02 0.002"/></default>',
           "  </default>",
           "  <asset>"]
    if A.get("floor", True):
        xml.append('    <texture name="grid" type="2d" builtin="checker" rgb1=".85 .85 .85" rgb2=".75 .75 .75" width="512" height="512"/>')
        xml.append('    <material name="floor" texture="grid" texrepeat="8 8"/>')
    for key, mname in materials.items():
        xml.append('    <material name="%s" rgba="%s"/>' % (mname, key))
    xml.extend(assets)
    xml.append("  </asset>")
    xml.append("  <worldbody>")
    if A.get("floor", True):
        size = max(2.0, (hi_all - lo_all).length) if lo_all.x < 1e8 else 5.0
        xml.append('    <light pos="0 0 %s" dir="0 0 -1" directional="true"/>' % fmt(max(3.0, hi_all.z + 2) if lo_all.x < 1e8 else 3.0))
        xml.append('    <geom name="floor" type="plane" size="%s %s 0.05" material="floor"/>' % (fmt(size), fmt(size)))
        if lo_all.x < 1e8 and lo_all.z < -1e-3:
            warn("parts reach %.3f m below the floor (z=0); move the model up in Blender" % lo_all.z)
    xml.extend(bodies)
    xml.append("  </worldbody>")
    if excludes:
        xml.append("  <contact>")
        xml.extend(excludes)
        xml.append("  </contact>")
    if actuators:
        xml.append("  <actuator>")
        xml.extend(actuators)
        xml.append("  </actuator>")
    xml.append("</mujoco>")
    scene = os.path.join(out, A.get("sceneName") or "scene.xml")
    with open(scene, "w") as fh:
        fh.write("\n".join(xml) + "\n")
    return {"scene": os.path.basename(scene), **stats, "meshes": len(assets), "materials": len(materials),
            "size": [round(v, 4) for v in (hi_all - lo_all)] if lo_all.x < 1e8 else None}


# ----------------------------------------------------------- obstacles ----
def export_obstacles():
    max_height = float(A.get("maxHeight") or 0.3)
    min_size = float(A.get("minSize") or 0.01)
    ox, oy = float(A.get("offsetX") or 0.0), float(A.get("offsetY") or 0.0)
    obstacles = []
    for o in objects():
        yaw = o.matrix_world.to_euler("XYZ").z
        # The object's yaw frame, so boxes follow the furniture's own axes.
        unyaw = Matrix.Rotation(-yaw, 4, "Z")
        bm = evaluated_bmesh(o, o.matrix_world, 0)
        parts = islands(bm)
        bm.free()
        name = o.name
        kept = 0
        if parts and min(min(v.z for v in verts) for verts in parts) < -0.01:
            warn("%s: reaches below the floor (z=0)" % name)
        for verts in parts:
            lo_z = min(v.z for v in verts)
            hi_z = max(v.z for v in verts)
            if lo_z >= max_height:
                continue  # above the duck: a table top, a shelf board
            if hi_z <= 0.002:
                continue  # a rug flat on the floor
            local = [unyaw @ v for v in verts]
            lo, hi = bounds(local)
            w, d = hi.x - lo.x, hi.y - lo.y
            if w < min_size and d < min_size:
                continue
            c = Matrix.Rotation(yaw, 4, "Z") @ Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0))
            kept += 1
            obstacles.append({
                "name": name if len(parts) == 1 else "%s %d" % (name, kept),
                "x": round(c.x + ox, 4), "y": round(c.y + oy, 4),
                "width": round(max(w, min_size), 4), "depth": round(max(d, min_size), 4),
                "height": round(max(hi_z, 0.01), 4),
                "heading": round(math.degrees(yaw), 2),
            })
        if kept == 0:
            warn("%s: nothing below %.2f m, left out" % (name, max_height))
    if len(obstacles) > 200:
        warn("%d obstacles; kept the 200 largest" % len(obstacles))
        obstacles.sort(key=lambda b: -b["width"] * b["depth"])
        obstacles = obstacles[:200]
    out = A.get("out")
    if out:
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        with open(out, "w") as fh:
            json.dump({"obstacles": obstacles}, fh, indent=1)
    return {"obstacles": obstacles}


try:
    mode = A.get("mode", "mjcf")
    if mode == "mjcf":
        result = export_mjcf()
    elif mode == "obstacles":
        result = export_obstacles()
    else:
        raise SystemExit("mode must be mjcf or obstacles")
    result["warnings"] = warnings
    print(RESULT_MARK + json.dumps(result), flush=True)
except SystemExit as e:
    print(RESULT_MARK + json.dumps({"error": str(e), "warnings": warnings}), flush=True)
    sys.exit(1)
