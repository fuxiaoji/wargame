/**
 * Standalone Spine 3.6 .skel → .json converter.
 * Extracted from AzurLaneSpineCharacterDecoder, stripped of libgdx.
 *
 * Usage: java Skel2Json.java <input.skel> <input.atlas> <input.png> [output.json]
 *
 * Compile: javac -d . Skel2Json.java
 * Run:     java Skel2Json in.skel in.atlas in.png out.json
 */
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class Skel2Json {

    // ---- Binary reader ----
    static class BinInput {
        byte[] data;
        int pos;
        List<String> strings = new ArrayList<>();
        BinInput(byte[] data) { this.data = data; }

        int read() { return data[pos++] & 0xff; }
        boolean readBoolean() { return read() != 0; }
        byte readByte() { return data[pos++]; }

        int readInt(boolean optimizePositive) {
            int b = read();
            int result = b & 0x7F;
            if ((b & 0x80) != 0) { b = read(); result |= (b & 0x7F) << 7;
            if ((b & 0x80) != 0) { b = read(); result |= (b & 0x7F) << 14;
            if ((b & 0x80) != 0) { b = read(); result |= (b & 0x7F) << 21;
            if ((b & 0x80) != 0) { b = read(); result |= (b & 0x7F) << 28; }}}}
            return optimizePositive ? result : ((result >>> 1) ^ -(result & 1));
        }

        float readFloat() {
            int bits = (read() & 0xff) | ((read() & 0xff) << 8) | ((read() & 0xff) << 16) | ((read() & 0xff) << 24);
            return Float.intBitsToFloat(bits);
        }

        String readString() {
            int byteCount = readInt(true);
            if (byteCount == 0) return null;
            if (byteCount == 1) return "";
            byteCount--;
            char[] chars = new char[byteCount];
            int charCount = 0;
            for (int i = 0; i < byteCount; ) {
                int b = read();
                switch (b >> 4) {
                    case 12: case 13:
                        chars[charCount++] = (char)((b & 0x1F) << 6 | read() & 0x3F); i += 2; break;
                    case 14:
                        chars[charCount++] = (char)((b & 0x0F) << 12 | (read() & 0x3F) << 6 | read() & 0x3F); i += 3; break;
                    default:
                        chars[charCount++] = (char)b; i++;
                }
            }
            return new String(chars, 0, charCount);
        }

        String readStringRef() {
            int index = readInt(true);
            return index == 0 ? null : strings.get(index - 1);
        }
    }

    // ---- JSON Builder (pure Java) ----
    static class Json {
        StringBuilder sb = new StringBuilder();

        static class Obj {
            StringBuilder sb = new StringBuilder("{");
            void put(String k, String v) { sb.append("\"").append(k).append("\":").append(v == null ? "null" : "\"" + v + "\"").append(","); }
            void put(String k, float v) { sb.append("\"").append(k).append("\":").append(v).append(","); }
            void put(String k, int v) { sb.append("\"").append(k).append("\":").append(v).append(","); }
            void put(String k, boolean v) { sb.append("\"").append(k).append("\":").append(v).append(","); }
            void putArr(String k, String json) { sb.append("\"").append(k).append("\":").append(json).append(","); }
            Obj obj(String k) { sb.append("\"").append(k).append("\":{"); return new Obj(); }
            Arr arr(String k) { sb.append("\"").append(k).append("\":["); return new Arr(); }
            String done() {
                int i = sb.lastIndexOf(",");
                if (i >= 0) sb.deleteCharAt(i);
                return sb.append("}").toString();
            }
        }

        static class Arr {
            StringBuilder sb = new StringBuilder("[");
            void val(String v) { sb.append(v == null ? "null" : "\"" + v + "\"").append(","); }
            void val(float v) { sb.append(v).append(","); }
            void val(int v) { sb.append(v).append(","); }
            Obj obj() { sb.append("{"); return new Obj(); }
            Arr arr() { sb.append("["); return new Arr(); }
            void addObj(String json) { sb.append(json).append(","); }
            void addArr(String json) { sb.append(json).append(","); }
            String done() {
                int i = sb.lastIndexOf(",");
                if (i >= 0) sb.deleteCharAt(i);
                return sb.append("]").toString();
            }
        }
    }

    // ---- Constants ----
    static final int BONE_ROTATE = 0, BONE_TRANSLATE = 1, BONE_SCALE = 2, BONE_SHEAR = 3;
    static final int SLOT_ATTACHMENT = 0, SLOT_COLOR = 1, SLOT_TWO_COLOR = 2;
    static final int ATTACH_REGION = 0, ATTACH_BOUNDINGBOX = 1, ATTACH_MESH = 2,
                     ATTACH_LINKEDMESH = 3, ATTACH_PATH = 4, ATTACH_POINT = 5, ATTACH_CLIPPING = 6;
    static final String[] TRANSFORM_MODE = {"normal","onlyTranslation","noRotationOrReflection","noScale","noScaleOrReflection"};
    static final String[] BLEND_MODE = {"normal","additive","multiply","screen"};
    static final String[] POSITION_MODE = {"fixed","percent"};
    static final String[] SPACING_MODE = {"length","fixed","percent"};
    static final String[] ROTATE_MODE = {"tangent","chain","chainScale"};

    // ---- State ----
    Map<Integer, String> bonesName = new HashMap<>();
    Map<Integer, String> slotsName = new HashMap<>();
    Map<Integer, String> skinsName = new HashMap<>();
    Map<Integer, String> ikName = new HashMap<>();
    Map<Integer, String> transformName = new HashMap<>();
    Map<Integer, String> pathName = new HashMap<>();
    Map<Integer, String> eventName = new HashMap<>();
    Map<String, List<Float>> attachVertices = new HashMap<>();
    Map<String, String> slotAttach = new HashMap<>();
    String name;
    float scale = 1.0f;

    String decode(byte[] skelData, Map<String, int[]> atlas) throws IOException {
        name = "skeleton";

        BinInput input = new BinInput(skelData);

        // == Read skeleton ==
        String hash = input.readString();
        String version = input.readString();
        float width = input.readFloat();
        float height = input.readFloat();

        Json.Obj skeleton = new Json.Obj();
        skeleton.put("hash", hash != null ? hash : "null");
        skeleton.put("spine", version != null ? version : "null");
        skeleton.put("width", width);
        skeleton.put("height", height);

        boolean nonessential = input.readBoolean();
        if (nonessential) {
            skeleton.put("fps", input.readFloat());
            skeleton.put("images", input.readString());
        }

        // == Bones ==
        int n = input.readInt(true);
        Json.Arr bonesArr = new Json.Arr();
        for (int i = 0; i < n; i++) {
            String boneName = input.readString();
            bonesName.put(i, boneName);
            Json.Obj bone = new Json.Obj();
            bone.put("name", boneName);
            if (i != 0) {
                bone.put("parent", bonesName.get(input.readInt(true)));
            }
            bone.put("rotation", input.readFloat());
            bone.put("x", input.readFloat() * scale);
            bone.put("y", input.readFloat() * scale);
            bone.put("scaleX", input.readFloat());
            bone.put("scaleY", input.readFloat());
            bone.put("shearX", input.readFloat());
            bone.put("shearY", input.readFloat());
            bone.put("length", input.readFloat() * scale);
            int tm = input.readInt(true);
            bone.put("transform", tm < TRANSFORM_MODE.length ? TRANSFORM_MODE[tm] : "normal");
            bone.put("skin", input.readBoolean());
            if (nonessential) {
                bone.put("color", rgbaToHex(input.readByte(), input.readByte(), input.readByte(), input.readByte()));
            } else {
                bone.put("color", "ffffffff");
            }
            bonesArr.addObj(bone.done());
        }
        skeleton.putArr("bones", bonesArr.done());

        // == Slots ==
        n = input.readInt(true);
        Json.Arr slotsArr = new Json.Arr();
        for (int i = 0; i < n; i++) {
            String slotName = input.readString();
            slotsName.put(i, slotName);
            int bi = input.readInt(true);
            Json.Obj slot = new Json.Obj();
            slot.put("name", slotName);
            if (bi < bonesName.size()) slot.put("bone", bonesName.get(bi));
            int color = readColor(input);
            slot.put("color", rgbaHex(color));

            int dark = readColor(input);
            if (dark != -1) {
                slot.put("dark", rgbaHex(dark));
            }
            String att = input.readStringRef();
            if (att != null) {
                slot.put("attachment", att);
                slotAttach.put(slotName, att);
            }
            int bm = input.readInt(true);
            slot.put("blend", bm < BLEND_MODE.length ? BLEND_MODE[bm] : "normal");
            slotsArr.addObj(slot.done());
        }
        skeleton.putArr("slots", slotsArr.done());

        // == IK constraints ==
        n = input.readInt(true);
        Json.Arr ikArr = new Json.Arr();
        for (int i = 0; i < n; i++) {
            String ikname = input.readString();
            ikName.put(i, ikname);
            Json.Obj ik = new Json.Obj();
            ik.put("name", ikname);
            ik.put("order", input.readInt(true));
            boolean skinReq = input.readBoolean();
            int nb = input.readInt(true);
            Json.Arr ikBones = new Json.Arr();
            for (int j = 0; j < nb; j++) ikBones.val(bonesName.get(input.readInt(true)));
            ik.putArr("bones", ikBones.done());
            ik.put("target", bonesName.get(input.readInt(true)));
            ik.put("mix", input.readFloat());
            ik.put("softness", input.readFloat() * scale);
            ik.put("bendPositive", input.readByte() > 0);
            ik.put("compress", input.readBoolean());
            ik.put("stretch", input.readBoolean());
            ik.put("uniform", input.readBoolean());
            if (skinReq) ik.put("skin", true);
            ikArr.addObj(ik.done());
        }
        if (n > 0) skeleton.putArr("ik", ikArr.done());

        // == Transform constraints ==
        n = input.readInt(true);
        Json.Arr trArr = new Json.Arr();
        for (int i = 0; i < n; i++) {
            String trname = input.readString();
            transformName.put(i, trname);
            Json.Obj tr = new Json.Obj();
            tr.put("name", trname);
            tr.put("order", input.readInt(true));
            boolean skinReq = input.readBoolean();
            int nb = input.readInt(true);
            Json.Arr trBones = new Json.Arr();
            for (int j = 0; j < nb; j++) trBones.val(bonesName.get(input.readInt(true)));
            tr.putArr("bones", trBones.done());
            tr.put("target", bonesName.get(input.readInt(true)));
            tr.put("rotation", input.readFloat());
            tr.put("x", input.readFloat() * scale);
            tr.put("y", input.readFloat() * scale);
            tr.put("scaleX", input.readFloat());
            tr.put("scaleY", input.readFloat());
            tr.put("shearY", input.readFloat());
            tr.put("rotateMix", input.readFloat());
            tr.put("translateMix", input.readFloat());
            tr.put("scaleMix", input.readFloat());
            tr.put("shearMix", input.readFloat());
            tr.put("local", input.readBoolean());
            tr.put("relative", input.readBoolean());
            if (skinReq) tr.put("skin", true);
            trArr.addObj(tr.done());
        }
        if (n > 0) skeleton.putArr("transform", trArr.done());

        // == Path constraints ==
        n = input.readInt(true);
        Json.Arr pathArr = new Json.Arr();
        for (int i = 0; i < n; i++) {
            String pname = input.readString();
            pathName.put(i, pname);
            Json.Obj path = new Json.Obj();
            path.put("name", pname);
            path.put("order", input.readInt(true));
            boolean skinReq = input.readBoolean();
            int nb = input.readInt(true);
            Json.Arr pBones = new Json.Arr();
            for (int j = 0; j < nb; j++) pBones.val(bonesName.get(input.readInt(true)));
            path.putArr("bones", pBones.done());
            path.put("target", bonesName.get(input.readInt(true)));
            path.put("positionMode", POSITION_MODE[input.readInt(true)]);
            path.put("spacingMode", SPACING_MODE[input.readInt(true)]);
            path.put("rotateMode", ROTATE_MODE[input.readInt(true)]);
            path.put("offsetRotation", input.readFloat());
            path.put("position", input.readFloat());
            path.put("spacing", input.readFloat());
            path.put("rotateMix", input.readFloat());
            path.put("translateMix", input.readFloat());
            if (skinReq) path.put("skin", true);
            pathArr.addObj(path.done());
        }
        if (n > 0) skeleton.putArr("path", pathArr.done());

        // == Skins ==
        Json.Obj skins = new Json.Obj();
        n = input.readInt(true);
        for (int i = 0; i < n; i++) {
            String skinName = input.readString();
            Json.Obj skinObj = new Json.Obj();
            int slotCount = input.readInt(true);
            for (int j = 0; j < slotCount; j++) {
                int slotIdx = input.readInt(true);
                String sName = slotsName.get(slotIdx);
                Json.Obj slotAttachments = new Json.Obj();
                int attCount = input.readInt(true);
                for (int k = 0; k < attCount; k++) {
                    String attName = input.readString();
                    readAttachment(input, slotAttachments, attName, nonessential, atlas);
                }
                skinObj.putArr(sName, slotAttachments.done());
            }
            skins.putArr(skinName, skinObj.done());
        }
        skeleton.putArr("skins", skins.done());

        // == Events ==
        n = input.readInt(true);
        if (n > 0) {
            Json.Obj events = new Json.Obj();
            for (int i = 0; i < n; i++) {
                String evName = input.readString();
                eventName.put(i, evName);
                Json.Obj ev = new Json.Obj();
                ev.put("int", input.readInt(true));
                ev.put("float", input.readFloat());
                ev.put("string", input.readString());
                if (nonessential) {
                    input.readString(); // audio path
                    input.readFloat();  // volume
                    input.readFloat();  // balance
                }
                events.putArr(evName, ev.done());
            }
            skeleton.putArr("events", events.done());
        }

        // == Animations ==
        n = input.readInt(true);
        Json.Obj animations = new Json.Obj();
        for (int i = 0; i < n; i++) {
            String animName = input.readString();
            readAnimation(input, animations, animName, nonessential);
        }
        skeleton.putArr("animations", animations.done());

        // Build final JSON
        Json.Obj root = new Json.Obj();
        root.putArr("skeleton", skeleton.done());
        return root.done();
    }

    void readAttachment(BinInput input, Json.Obj parent, String attName, boolean nonessential, Map<String, int[]> atlas) throws IOException {
        int type = input.readInt(true);
        Json.Obj att = new Json.Obj();

        switch (type) {
            case ATTACH_REGION:
                att.put("type", "region");
                att.put("x", input.readFloat() * scale);
                att.put("y", input.readFloat() * scale);
                att.put("rotation", input.readFloat());
                att.put("scaleX", input.readFloat());
                att.put("scaleY", input.readFloat());
                att.put("width", input.readFloat() * scale);
                att.put("height", input.readFloat() * scale);
                att.put("color", rgbaHex(readColor(input)));
                att.put("path", input.readString());
                break;
            case ATTACH_BOUNDINGBOX:
                att.put("type", "boundingbox");
                int vc = input.readInt(true);
                att.put("vertexCount", vc);
                att.put("color", rgbaHex(readColor(input)));
                readVertices(input, vc, att.arr("vertices"), attName);
                att.putArr("vertices", att.arr("vertices").done());
                break;
            case ATTACH_MESH:
                att.put("type", "mesh");
                att.put("path", input.readString());
                int uvsLen = input.readInt(true);
                float[] uvs = readFloatArray(input, uvsLen * 2, 1.0f);
                Json.Arr uvsArr = att.arr("uvs"); for (float f : uvs) uvsArr.val(f); att.putArr("uvs", uvsArr.done());

                int triCount = input.readInt(true);
                Json.Arr trisArr = att.arr("triangles");
                for (int j = 0; j < triCount * 3; j++) trisArr.val(input.readInt(true));
                att.putArr("triangles", trisArr.done());

                int vertCount = input.readInt(true);
                readVertices(input, vertCount, att.arr("vertices"), attName);
                att.putArr("vertices", att.arr("vertices").done());

                int hullLen = input.readInt(true);
                Json.Arr hullArr = att.arr("hull");
                for (int j = 0; j < hullLen * 2; j++) hullArr.val(input.readInt(true));
                att.putArr("hull", hullArr.done());

                int edgesCount = input.readInt(true);
                Json.Arr edgesArr = att.arr("edges");
                for (int j = 0; j < edgesCount * 2; j++) edgesArr.val(input.readInt(true));
                att.putArr("edges", edgesArr.done());

                att.put("color", rgbaHex(readColor(input)));
                if (nonessential) {
                    input.readInt(true); // hullLen2
                    readShortArray(input, hullArr);
                    readShortArray(input, edgesArr);
                }
                break;
            case ATTACH_LINKEDMESH:
                att.put("type", "linkedmesh");
                att.put("skin", input.readString());
                att.put("parent", input.readString());
                att.put("path", input.readString());
                break;
            case ATTACH_PATH:
                att.put("type", "path");
                // Path attachment parsing would go here
                break;
            case ATTACH_POINT:
                att.put("type", "point");
                att.put("x", input.readFloat() * scale);
                att.put("y", input.readFloat() * scale);
                att.put("rotation", input.readFloat());
                att.put("color", rgbaHex(readColor(input)));
                break;
            case ATTACH_CLIPPING:
                att.put("type", "clipping");
                att.put("end", input.readString());
                int cc = input.readInt(true);
                att.put("vertexCount", cc);
                att.put("color", rgbaHex(readColor(input)));
                readVertices(input, cc, att.arr("vertices"), attName);
                att.putArr("vertices", att.arr("vertices").done());
                break;
        }
        if (type >= 0 && type <= 6) {
            parent.putArr(attName, att.done());
        }
    }

    void readAnimation(BinInput input, Json.Obj animations, String animName, boolean nonessential) throws IOException {
        Json.Obj anim = new Json.Obj();

        // Slot timelines
        int n = input.readInt(true);
        Json.Arr slotTL = new Json.Arr();
        for (int i = 0; i < n; i++) {
            int slotIdx = input.readInt(true);
            String sName = slotsName.get(slotIdx);
            Json.Obj tl = new Json.Obj();
            tl.put("slot", sName);
            int nf = input.readInt(true);
            Json.Arr frames = new Json.Arr();
            for (int j = 0; j < nf; j++) {
                int type = input.readInt(true);
                int nv = input.readInt(true);
                if (type == SLOT_COLOR || type == SLOT_TWO_COLOR) {
                    Json.Obj f = new Json.Obj();
                    f.put("time", input.readFloat());
                    f.put("color", rgbaHex(readColor(input)));
                    if (type == SLOT_TWO_COLOR) f.put("dark", rgbaHex(readColor(input)));
                    frames.addObj(f.done());
                } else if (type == SLOT_ATTACHMENT) {
                    Json.Obj f = new Json.Obj();
                    f.put("time", input.readFloat());
                    f.put("name", input.readString());
                    frames.addObj(f.done());
                }
            }
            tl.putArr("frames", frames.done());
            slotTL.addObj(tl.done());
        }
        if (n > 0) anim.putArr("slots", slotTL.done());

        // Bone timelines
        n = input.readInt(true);
        Json.Arr boneTL = new Json.Arr();
        for (int i = 0; i < n; i++) {
            int boneIdx = input.readInt(true);
            String bName = bonesName.get(boneIdx);
            Json.Obj tl = new Json.Obj();
            tl.put("bone", bName);
            int nf = input.readInt(true);
            Json.Arr frames = new Json.Arr();
            for (int j = 0; j < nf; j++) {
                int type = input.readInt(true);
                int nv = input.readInt(true);
                Json.Obj f = new Json.Obj();
                f.put("time", input.readFloat());
                switch (type) {
                    case BONE_ROTATE: f.put("angle", input.readFloat()); break;
                    case BONE_TRANSLATE: f.put("x", input.readFloat() * scale); f.put("y", input.readFloat() * scale); break;
                    case BONE_SCALE: f.put("x", input.readFloat()); f.put("y", input.readFloat()); break;
                    case BONE_SHEAR: f.put("x", input.readFloat()); f.put("y", input.readFloat()); break;
                }
                frames.addObj(f.done());
                if (type == BONE_TRANSLATE || type == BONE_SCALE || type == BONE_SHEAR) {
                    // Read curve
                    readCurve(input, f);
                }
            }
            tl.putArr("frames", frames.done());
            boneTL.addObj(tl.done());
        }
        if (n > 0) anim.putArr("bones", boneTL.done());

        // IK timelines
        n = input.readInt(true);
        Json.Arr ikTL = new Json.Arr();
        for (int i = 0; i < n; i++) {
            int ikIdx = input.readInt(true);
            Json.Obj tl = new Json.Obj();
            tl.put("ik", ikName.get(ikIdx));
            int nf = input.readInt(true);
            Json.Arr frames = new Json.Arr();
            for (int j = 0; j < nf; j++) {
                Json.Obj f = new Json.Obj();
                f.put("time", input.readFloat());
                f.put("mix", input.readFloat());
                f.put("softness", input.readFloat() * scale);
                f.put("bendPositive", input.readByte() > 0);
                f.put("compress", input.readBoolean());
                f.put("stretch", input.readBoolean());
                readCurve(input, f);
                frames.addObj(f.done());
            }
            tl.putArr("frames", frames.done());
            ikTL.addObj(tl.done());
        }
        if (n > 0) anim.putArr("ik", ikTL.done());

        // Transform timelines
        n = input.readInt(true);
        Json.Arr trTL = new Json.Arr();
        for (int i = 0; i < n; i++) {
            int trIdx = input.readInt(true);
            Json.Obj tl = new Json.Obj();
            tl.put("transform", transformName.get(trIdx));
            int nf = input.readInt(true);
            Json.Arr frames = new Json.Arr();
            for (int j = 0; j < nf; j++) {
                Json.Obj f = new Json.Obj();
                f.put("time", input.readFloat());
                f.put("rotateMix", input.readFloat());
                f.put("translateMix", input.readFloat());
                f.put("scaleMix", input.readFloat());
                f.put("shearMix", input.readFloat());
                readCurve(input, f);
                frames.addObj(f.done());
            }
            tl.putArr("frames", frames.done());
            trTL.addObj(tl.done());
        }
        if (n > 0) anim.putArr("transform", trTL.done());

        // Deform timelines
        n = input.readInt(true);
        Json.Arr deformTL = new Json.Arr();
        for (int i = 0; i < n; i++) {
            int skinIdx = input.readInt(true);
            int slotIdx = input.readInt(true);
            String attName = input.readString();
            Json.Obj tl = new Json.Obj();
            tl.put("skin", skinsName.get(skinIdx));
            tl.put("slot", slotsName.get(slotIdx));
            tl.put("attachment", attName);
            int nf = input.readInt(true);
            Json.Arr frames = new Json.Arr();
            for (int j = 0; j < nf; j++) {
                Json.Obj f = new Json.Obj();
                f.put("time", input.readFloat());
                int vc = input.readInt(true);
                float[] verts = readFloatArray(input, vc, scale);
                Json.Arr vertArr = f.arr("vertices");
                for (float vt : verts) vertArr.val(vt);
                f.putArr("vertices", vertArr.done());
                readCurve(input, f);
                frames.addObj(f.done());
            }
            tl.putArr("frames", frames.done());
            deformTL.addObj(tl.done());
        }
        if (n > 0) anim.putArr("deform", deformTL.done());

        // Draw order timelines
        n = input.readInt(true);
        if (n > 0) {
            Json.Arr drawTL = new Json.Arr();
            for (int i = 0; i < n; i++) {
                Json.Obj tl = new Json.Obj();
                int nf = input.readInt(true);
                Json.Arr frames = new Json.Arr();
                for (int j = 0; j < nf; j++) {
                    Json.Obj f = new Json.Obj();
                    f.put("time", input.readFloat());
                    int no = input.readInt(true);
                    Json.Arr offsets = f.arr("offsets");
                    for (int k = 0; k < no; k++) {
                        Json.Obj off = new Json.Obj();
                        off.put("slot", slotsName.get(input.readInt(true)));
                        int o = input.readInt(true);
                        off.put("offset", o);
                        offsets.addObj(off.done());
                    }
                    f.putArr("offsets", offsets.done());
                    frames.addObj(f.done());
                }
                tl.putArr("frames", frames.done());
                drawTL.addObj(tl.done());
            }
            anim.putArr("drawOrder", drawTL.done());
        }

        // Event timelines
        n = input.readInt(true);
        Json.Arr evTL = new Json.Arr();
        for (int i = 0; i < n; i++) {
            Json.Obj tl = new Json.Obj();
            int nf = input.readInt(true);
            Json.Arr frames = new Json.Arr();
            for (int j = 0; j < nf; j++) {
                Json.Obj f = new Json.Obj();
                f.put("time", input.readFloat());
                f.put("name", input.readString());
                f.put("int", input.readInt(true));
                f.put("float", input.readFloat());
                f.put("string", input.readString());
                frames.addObj(f.done());
            }
            tl.putArr("frames", frames.done());
            evTL.addObj(tl.done());
        }
        if (n > 0) anim.putArr("events", evTL.done());

        animations.putArr(animName, anim.done());
    }

    void readCurve(BinInput input, Json.Obj f) {
        int type = input.readInt(true);
        if (type == 2) { // bezier
            f.put("curve", input.readFloat());
            f.put("c2", input.readFloat());
            f.put("c3", input.readFloat());
            f.put("c4", input.readFloat());
        } else if (type == 1) { // stepped
            f.put("stepped", true);
        }
    }

    void readVertices(BinInput input, int vertexCount, Json.Arr verticesArr, String attachName) throws IOException {
        int verticesLength = vertexCount * 2;
        List<Float> array = new ArrayList<>(); float[] tmpArr2;
        float[] tmpArr = readFloatArray(input, verticesLength, 1.0f); for (float f : tmpArr) array.add(f);
        for (float f : array) verticesArr.val(f);
    }

    float[] readFloatArray(BinInput input, int n, float scale) {
        float[] array = new float[n];
        for (int i = 0; i < n; i++) array[i] = input.readFloat() * scale;
        return array;
    }

    List<Float> readFloatArray(BinInput input, int n, float scale, Json.Arr unused) {
        List<Float> array = new ArrayList<>(); float[] tmpArr2;
        for (int i = 0; i < n; i++) array.add(input.readFloat() * scale);
        return array;
    }

    void readShortArray(BinInput input, Json.Arr shortArr) throws IOException {
        int n = input.readInt(true);
        for (int i = 0; i < n; i++) shortArr.val(input.readInt(true));
    }

    static int readColor(BinInput input) {
        return (input.read() << 24) | (input.read() << 16) | (input.read() << 8) | input.read();
    }

    static String rgbaHex(int color) {
        int a = (color >> 24) & 0xff;
        int b = (color >> 16) & 0xff;
        int g = (color >> 8) & 0xff;
        int r = color & 0xff;
        return String.format("%02x%02x%02x%02x", r, g, b, a);
    }

    static String rgbaToHex(int r, int g, int b, int a) {
        return String.format("%02x%02x%02x%02x", r, g, b, a);
    }

    // ---- Main ----
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.out.println("Usage: java Skel2Json <input.skel> [input.atlas] [input.png] [output.json]");
            System.out.println("   or: java Skel2Json --batch <dir-with-skel-atlas-png> <outdir>");
            System.exit(1);
        }

        if (args[0].equals("--batch")) {
            File inDir = new File(args[1]);
            File outDir = new File(args[2]);
            outDir.mkdirs();

            // Group files by prefix
            Map<String, File[]> groups = new HashMap<>();
            for (File f : inDir.listFiles()) {
                String name = f.getName();
                String prefix = name.replaceAll("\\.(skel|atlas|png)$", "");
                if (!groups.containsKey(prefix)) groups.put(prefix, new File[3]);
                File[] arr = groups.get(prefix);
                if (name.endsWith(".skel")) arr[0] = f;
                else if (name.endsWith(".atlas")) arr[1] = f;
                else if (name.endsWith(".png")) arr[2] = f;
            }

            for (Map.Entry<String, File[]> e : groups.entrySet()) {
                File[] arr = e.getValue();
                if (arr[0] == null || arr[1] == null || arr[2] == null) {
                    System.out.println("Skipping " + e.getKey() + " (missing files)");
                    continue;
                }
                File outFile = new File(outDir, e.getKey() + ".json");
                convert(arr[0], arr[1], arr[2], outFile);
            }
        } else {
            File skelFile = new File(args[0]);
            File atlasFile = args.length > 1 ? new File(args[1]) : null;
            File pngFile = args.length > 2 ? new File(args[2]) : null;
            File outFile = args.length > 3 ? new File(args[3]) :
                new File(skelFile.getParent(), skelFile.getName().replaceAll("\\.skel$", "") + ".json");
            convert(skelFile, atlasFile, pngFile, outFile);
        }
    }

    static void convert(File skelFile, File atlasFile, File pngFile, File outFile) throws Exception {
        System.out.print(skelFile.getName() + " → " + outFile.getName() + " ... ");

        byte[] skelData = Files.readAllBytes(skelFile.toPath());

        // Parse atlas
        Map<String, int[]> atlas = new HashMap<>();
        if (atlasFile != null && atlasFile.exists()) {
            String atext = new String(Files.readAllBytes(atlasFile.toPath())).replace("\r\n", "\n");
            String[] lines = atext.split("\n");
            for (int i = 0; i < lines.length; i++) {
                String name = lines[i].trim();
                if (name.isEmpty()) continue;
                if (i + 4 >= lines.length) break;
                // Check if this is a region entry
                if (lines[i+1].trim().startsWith("rotate:") && lines[i+2].trim().startsWith("xy:")) {
                    String xyLine = lines[i+2].trim();
                    String sizeLine = lines[i+3].trim();
                    String[] xyParts = xyLine.substring(3).trim().split(",");
                    String[] sizeParts = sizeLine.substring(5).trim().split(",");
                    try {
                        int x = Integer.parseInt(xyParts[0].trim());
                        int y = Integer.parseInt(xyParts[1].trim());
                        int w = Integer.parseInt(sizeParts[0].trim());
                        int h = Integer.parseInt(sizeParts[1].trim());
                        atlas.put(name, new int[]{x, y, w, h});
                    } catch(NumberFormatException ex) {}
                    i += 3;
                }
            }
        }

        try {
            Skel2Json converter = new Skel2Json();
            if (atlasFile != null) converter.scale = 1.0f;
            String json = converter.decode(skelData, atlas);
            Files.writeString(outFile.toPath(), json);
            System.out.println("OK (" + (json.length() / 1024) + "KB)");
        } catch (Exception e) {
            System.out.println("FAILED: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
