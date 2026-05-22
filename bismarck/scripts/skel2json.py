#!/usr/bin/env python3
"""
将 Spine 3.6.52 二进制 .skel 文件转换为 .json 格式

3.6 二进制格式特点:
- 字符串: [1字节长度(含不存在的null)] [length-1字节数据]
  即长度包含 null 但文件中没有 null 字节
- 头部: hash, version, 然后直接是 bones 数据 (无 x/y/width/height)
- 使用 varint 优化整数编码 (与 3.8 相同)
"""

import struct, json, os, shutil
from pathlib import Path

class BinaryReader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def read_byte(self) -> int:
        b = self.data[self.pos]
        self.pos += 1
        return b

    def read_bool(self) -> bool:
        return self.read_byte() != 0

    def read_float(self) -> float:
        v = struct.unpack('<f', self.data[self.pos:self.pos+4])[0]
        self.pos += 4
        return v

    def read_int(self) -> int:
        """7-bit 优化整数编码 (与 3.8 相同)"""
        b = self.read_byte()
        result = b & 0x7F
        if (b & 0x80) != 0:
            b = self.read_byte()
            result |= (b & 0x7F) << 7
            if (b & 0x80) != 0:
                b = self.read_byte()
                result |= (b & 0x7F) << 14
                if (b & 0x80) != 0:
                    b = self.read_byte()
                    result |= (b & 0x7F) << 21
                    if (b & 0x80) != 0:
                        b = self.read_byte()
                        result |= (b & 0x7F) << 28
        return result

    def read_string(self) -> str:
        """3.6 格式: [1字节长度(含null)] [length-1字节数据]"""
        length = self.read_byte()
        if length == 0:
            return None
        if length == 1:
            return ""
        # 长度包含不存在的 null，实际数据是 length-1 字节
        raw = self.data[self.pos:self.pos + length - 1]
        self.pos += length - 1
        return raw.decode('utf-8', errors='replace')

    def read_color_rgba(self) -> str:
        """RGBA8888 → hex string"""
        c = struct.unpack('<I', self.data[self.pos:self.pos+4])[0]
        self.pos += 4
        a = (c >> 24) & 0xff
        b = (c >> 16) & 0xff
        g = (c >> 8) & 0xff
        r = c & 0xff
        return f"{r:02x}{g:02x}{b:02x}{a:02x}"

    def read_color_rgb(self) -> str:
        """RGB8888 → hex"""
        c = struct.unpack('<i', self.data[self.pos:self.pos+4])[0]
        self.pos += 4
        if c == -1:
            return None
        b = (c >> 16) & 0xff
        g = (c >> 8) & 0xff
        r = c & 0xff
        return f"{r:02x}{g:02x}ff"


def convert_skel_to_json(data: bytes) -> dict:
    r = BinaryReader(data)

    result = {"skeleton": {}}
    skel = result["skeleton"]

    # hash
    skel["hash"] = r.read_string()
    # version
    skel["spine"] = r.read_string()

    # 3.6 格式没有 x/y/width/height/nonessential
    # 直接跳到骨骼数据
    skel["x"] = 0.0
    skel["y"] = 0.0
    skel["width"] = 0.0
    skel["height"] = 0.0

    # 字符串表 (3.6 格式可能没有，但为了兼容性读取)
    # 尝试检测：下一个字节是 varint
    # 实际上在 3.6 中，骨骼数量直接跟在版本后面

    # 直接读取骨骼数量 (用 varint)
    bones = []
    n_bones = r.read_int()

    for i in range(n_bones):
        name = r.read_string()
        parent_idx = None if i == 0 else r.read_int()
        bone = {
            "name": name,
            "parent": parent_idx,
            "x": r.read_float(),
            "y": r.read_float(),
            "rotation": r.read_float(),
            "scaleX": r.read_float(),
            "scaleY": r.read_float(),
            "shearX": r.read_float(),
            "shearY": r.read_float(),
            "length": r.read_float(),
            "transform": _get_transform_mode(r.read_int()),
            "skin": r.read_bool(),
            "color": "ffffffff",
        }
        bones.append(bone)

    # Fix parent references
    for i, bone in enumerate(bones):
        if bone["parent"] is not None and 0 <= bone["parent"] < len(bones):
            bone["parent"] = bones[bone["parent"]]["name"]
        elif i > 0:
            bone["parent"] = None

    skel["bones"] = bones

    # 插槽
    slots = []
    n_slots = r.read_int()
    for i in range(n_slots):
        name = r.read_string()
        bone_idx = r.read_int()
        slot = {
            "name": name,
            "bone": bones[bone_idx]["name"] if bone_idx < len(bones) else "root",
            "color": r.read_color_rgba(),
        }
        dark = r.read_color_rgb()
        if dark:
            slot["dark"] = dark
        att = r.read_string()
        if att:
            slot["attachment"] = att
        slot["blend"] = _get_blend_mode(r.read_int())
        slots.append(slot)
    skel["slots"] = slots

    # IK 约束
    ik_list = []
    n_ik = r.read_int()
    for _ in range(n_ik):
        name = r.read_string()
        order = r.read_int()
        skin_req = r.read_bool()
        n_bones = r.read_int()
        ik_bones = [bones[r.read_int()]["name"] for _ in range(n_bones)]
        target = bones[r.read_int()]["name"]
        ik_list.append({
            "name": name,
            "order": order,
            "bones": ik_bones,
            "target": target,
            "mix": r.read_float(),
            "softness": r.read_float(),
            "bendPositive": r.read_byte() > 0,
            "compress": r.read_bool(),
            "stretch": r.read_bool(),
            "uniform": r.read_bool(),
        })
        if skin_req:
            ik_list[-1]["skin"] = True
    if ik_list:
        skel["ik"] = ik_list

    # Transform 约束
    transform_list = []
    n_t = r.read_int()
    for _ in range(n_t):
        name = r.read_string()
        order = r.read_int()
        skin_req = r.read_bool()
        n_bones = r.read_int()
        t_bones = [bones[r.read_int()]["name"] for _ in range(n_bones)]
        target = bones[r.read_int()]["name"]
        transform_list.append({
            "name": name,
            "order": order,
            "bones": t_bones,
            "target": target,
            "rotation": r.read_float(),
            "x": r.read_float(),
            "y": r.read_float(),
            "scaleX": r.read_float(),
            "scaleY": r.read_float(),
            "shearY": r.read_float(),
            "rotateMix": r.read_float(),
            "translateMix": r.read_float(),
            "scaleMix": r.read_float(),
            "shearMix": r.read_float(),
            "local": r.read_bool(),
            "relative": r.read_bool(),
        })
        if skin_req:
            transform_list[-1]["skin"] = True
    if transform_list:
        skel["transform"] = transform_list

    # Path 约束
    path_list = []
    n_p = r.read_int()
    for _ in range(n_p):
        name = r.read_string()
        order = r.read_int()
        skin_req = r.read_bool()
        n_bones = r.read_int()
        p_bones = [bones[r.read_int()]["name"] for _ in range(n_bones)]
        target = bones[r.read_int()]["name"]
        path_list.append({
            "name": name,
            "order": order,
            "bones": p_bones,
            "target": target,
            "positionMode": _get_position_mode(r.read_int()),
            "spacingMode": _get_spacing_mode(r.read_int()),
            "rotateMode": _get_rotate_mode(r.read_int()),
            "offsetRotation": r.read_float(),
            "position": r.read_float(),
            "spacing": r.read_float(),
            "rotateMix": r.read_float(),
            "translateMix": r.read_float(),
        })
    if path_list:
        skel["path"] = path_list

    # 皮肤
    skins = {"default": {}}
    n_skins = r.read_int()
    for _ in range(n_skins):
        skin_name = r.read_string()
        attachments = {}
        n_slots_skin = r.read_int()
        for _ in range(n_slots_skin):
            slot_idx = r.read_int()
            slot_name = slots[slot_idx]["name"] if slot_idx < len(slots) else f"slot{slot_idx}"
            n_att = r.read_int()
            for _ in range(n_att):
                att_name = r.read_string()
                att_type = r.read_int()
                att = _read_attachment(r, att_type)
                if slot_name not in attachments:
                    attachments[slot_name] = {}
                attachments[slot_name][att_name] = att

        if skin_name == "default":
            skins["default"] = attachments
        else:
            skins[skin_name] = attachments
    skel["skins"] = skins

    # 事件
    events = {}
    n_ev = r.read_int()
    for _ in range(n_ev):
        name = r.read_string()
        events[name] = {
            "int": r.read_int(),
            "float": r.read_float(),
            "string": r.read_string() or "",
        }
    if events:
        skel["events"] = events

    # 动画
    animations = {}
    n_anim = r.read_int()
    for _ in range(n_anim):
        name = r.read_string()
        anim = _read_animation(r, bones, slots, ik_list, transform_list, path_list)
        if anim:
            animations[name] = anim
    skel["animations"] = animations

    return result


def _read_attachment(r, att_type):
    if att_type == 0:  # region
        return {
            "type": "region",
            "x": r.read_float(),
            "y": r.read_float(),
            "rotation": r.read_float(),
            "scaleX": r.read_float(),
            "scaleY": r.read_float(),
            "width": r.read_float(),
            "height": r.read_float(),
            "color": r.read_color_rgba(),
            "path": r.read_string(),
        }
    elif att_type == 1:  # boundingbox
        n = r.read_int()
        verts = [r.read_float() for _ in range(n * 2)]
        return {
            "type": "boundingbox",
            "vertexCount": n,
            "vertices": verts,
            "color": r.read_color_rgba(),
        }
    elif att_type == 2:  # mesh
        path = r.read_string()
        n_uvs = r.read_int()
        uvs = [r.read_float() for _ in range(n_uvs * 2)]
        n_tris = r.read_int()
        tris = [r.read_int() for _ in range(n_tris * 3)]
        n_verts = r.read_int()
        verts = [r.read_float() for _ in range(n_verts * 2)]
        n_hull = r.read_int()
        hull = [r.read_int() for _ in range(n_hull * 2)]
        n_edges = r.read_int()
        edges = [r.read_int() for _ in range(n_edges * 2)]
        return {
            "type": "mesh",
            "path": path,
            "uvs": uvs,
            "triangles": tris,
            "vertices": verts,
            "hull": hull,
            "edges": edges,
            "color": r.read_color_rgba(),
        }
    elif att_type == 3:  # linkedmesh
        return {
            "type": "linkedmesh",
            "skin": r.read_string(),
            "parent": r.read_string(),
            "path": r.read_string(),
        }
    elif att_type == 4:  # path
        return {"type": "path"}
    elif att_type == 5:  # point
        return {
            "type": "point",
            "x": r.read_float(),
            "y": r.read_float(),
            "rotation": r.read_float(),
            "color": r.read_color_rgba(),
        }
    elif att_type == 6:  # clipping
        end = r.read_string()
        n = r.read_int()
        verts = [r.read_float() for _ in range(n * 2)]
        return {
            "type": "clipping",
            "end": end,
            "vertexCount": n,
            "vertices": verts,
            "color": r.read_color_rgba(),
        }
    return {"type": "unknown"}


def _read_animation(r, bones, slots, ik, transform, path):
    anim = {}

    # Slot timelines
    slot_tl = []
    n = r.read_int()
    for _ in range(n):
        slot_idx = r.read_int()
        slot_name = slots[slot_idx]["name"] if slot_idx < len(slots) else f"slot{slot_idx}"
        tl = {"slot": slot_name, "frames": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            typ = r.read_int()
            n_vals = r.read_int()
            if typ == 0:  # color
                tl["frames"].append({
                    "time": r.read_float(),
                    "color": r.read_color_rgba(),
                    **({"dark": r.read_color_rgb()} if n_vals > 1 else {})
                })
            elif typ == 1:  # attachment
                tl["frames"].append({
                    "time": r.read_float(),
                    "name": r.read_string(),
                })
        if tl["frames"]:
            slot_tl.append(tl)
    if slot_tl:
        anim["slots"] = slot_tl

    # Bone timelines
    bone_tl = []
    n = r.read_int()
    for _ in range(n):
        bone_idx = r.read_int()
        bone_name = bones[bone_idx]["name"] if bone_idx < len(bones) else f"bone{bone_idx}"
        tl = {"bone": bone_name, "frames": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            typ = r.read_int()
            n_vals = r.read_int()
            frame = {"time": r.read_float()}
            if typ == 0:
                frame["angle"] = r.read_float()
            elif typ == 1:
                frame["x"] = r.read_float()
                frame["y"] = r.read_float()
            elif typ == 2:
                frame["x"] = r.read_float()
                frame["y"] = r.read_float()
            elif typ == 3:
                frame["x"] = r.read_float()
                frame["y"] = r.read_float()
            tl["frames"].append(frame)
        if tl["frames"]:
            bone_tl.append(tl)
    if bone_tl:
        anim["bones"] = bone_tl

    # IK timelines
    ik_tl = []
    n = r.read_int()
    for _ in range(n):
        ik_idx = r.read_int()
        name = ik[ik_idx]["name"] if ik_idx < len(ik) else f"ik{ik_idx}"
        tl = {"ik": name, "frames": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            tl["frames"].append({
                "time": r.read_float(),
                "mix": r.read_float(),
                "softness": r.read_float(),
                "bendPositive": r.read_byte() > 0,
                "compress": r.read_bool(),
                "stretch": r.read_bool(),
            })
        if tl["frames"]:
            ik_tl.append(tl)
    if ik_tl:
        anim["ik"] = ik_tl

    # Transform timelines
    t_tl = []
    n = r.read_int()
    for _ in range(n):
        t_idx = r.read_int()
        name = transform[t_idx]["name"] if t_idx < len(transform) else f"t{t_idx}"
        tl = {"transform": name, "frames": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            tl["frames"].append({
                "time": r.read_float(),
                "rotateMix": r.read_float(),
                "translateMix": r.read_float(),
                "scaleMix": r.read_float(),
                "shearMix": r.read_float(),
            })
        if tl["frames"]:
            t_tl.append(tl)
    if t_tl:
        anim["transform"] = t_tl

    # Deform timelines
    deform_tl = []
    n = r.read_int()
    for _ in range(n):
        r.read_int()  # skin index
        slot_idx = r.read_int()
        att_name = r.read_string()
        slot_name = slots[slot_idx]["name"] if slot_idx < len(slots) else f"slot{slot_idx}"
        tl = {"slot": slot_name, "attachment": att_name, "frames": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            frame = {"time": r.read_float()}
            n_verts = r.read_int()
            frame["vertices"] = [r.read_float() for _ in range(n_verts)]
            tl["frames"].append(frame)
        if tl["frames"]:
            deform_tl.append(tl)
    if deform_tl:
        anim["deform"] = deform_tl

    # Draw order timelines
    draw_tl = []
    n = r.read_int()
    for _ in range(n):
        tl = {"drawOrder": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            frame = {"time": r.read_float(), "offsets": []}
            n_offsets = r.read_int()
            for _ in range(n_offsets):
                sidx = r.read_int()
                off = r.read_int()
                sname = slots[sidx]["name"] if sidx < len(slots) else f"slot{sidx}"
                frame["offsets"].append({"slot": sname, "offset": off})
            tl["drawOrder"].append(frame)
        if tl["drawOrder"]:
            draw_tl.append(tl)
    if draw_tl:
        anim["drawOrder"] = draw_tl

    # Event timelines
    event_tl = []
    n = r.read_int()
    for _ in range(n):
        tl = {"events": []}
        n_frames = r.read_int()
        for _ in range(n_frames):
            tl["events"].append({
                "time": r.read_float(),
                "name": r.read_string(),
                "int": r.read_int(),
                "float": r.read_float(),
                "string": r.read_string() or "",
            })
        if tl["events"]:
            event_tl.append(tl)
    if event_tl:
        anim["events"] = event_tl

    return anim


def _get_transform_mode(idx):
    return ["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"][idx] if 0 <= idx < 5 else "normal"

def _get_blend_mode(idx):
    return ["normal", "additive", "multiply", "screen"][idx] if 0 <= idx < 4 else "normal"

def _get_position_mode(idx):
    return ["fixed", "percent"][idx] if 0 <= idx < 2 else "fixed"

def _get_spacing_mode(idx):
    return ["length", "fixed", "percent"][idx] if 0 <= idx < 3 else "length"

def _get_rotate_mode(idx):
    return ["tangent", "chain", "chainScale"][idx] if 0 <= idx < 3 else "tangent"


def main():
    base_dir = Path(__file__).parent.parent / "public" / "spine"
    ship_dirs = sorted(d for d in base_dir.iterdir() if d.is_dir())

    for ship_dir in ship_dirs:
        skel_files = list(ship_dir.glob("*.skel"))
        # 使用 .bak 备份 (原始文件)
        bak_files = list(ship_dir.glob("*.skel.bak"))
        use_file = bak_files[0] if bak_files else (skel_files[0] if skel_files else None)
        if not use_file:
            continue

        json_path = ship_dir / (use_file.stem.replace('.skel', '') + '.json')
        # 如果 .skel.bak 存在，去掉 .bak 后缀的 stem
        if use_file.suffix == '.bak':
            json_path = ship_dir / (use_file.stem.replace('.skel', '') + '.json')

        print(f"Converting {use_file.name} ...")
        try:
            with open(use_file, 'rb') as f:
                data = f.read()

            result = convert_skel_to_json(data)

            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False)

            bones = len(result["skeleton"].get("bones", []))
            anims = len(result["skeleton"].get("animations", {}))
            slots = len(result["skeleton"].get("slots", []))
            print(f"  → {json_path.name}: {bones} bones, {slots} slots, {anims} animations")
        except Exception as e:
            print(f"  ✗ Error: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()
