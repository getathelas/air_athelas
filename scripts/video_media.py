#!/usr/bin/env python3
"""Media helpers for turning a screen recording into docs.athelas.com assets.

The workflow lives in .cursor/rules/video_to_doc.mdc; this script only does the
mechanical parts. It needs ffmpeg/ffprobe (brew install ffmpeg) and, for stills,
cwebp/dwebp (brew install webp).

Rectangles are always x,y,w,h. Everything except the share rectangle itself is
measured in *share space*: pixels of the recording after it has been cropped to
the shared-screen rectangle, so a coordinate read off an extracted frame can be
pasted straight into a spec.

  probe   VIDEO                           streams, duration, fps
  region  VIDEO --at T                    estimate the shared-screen rectangle
  sheet   VIDEO --out PNG (--every S | --times T,T,...) [--share R] [--from A --to B]
  outline VIDEO --at T --boxes JSON --out PNG [--share R] [--crop R]
  still   SPEC --out DIR [--only a,b]     cropped, pixelated stills -> .webp + check .png
  clip    SPEC --out DIR [--only a,b]     silent, multi-segment, variable-speed .mp4
  scan    VIDEO [--from A --to B] [--share R] [--region R]
                                          scene changes and region-brightness jumps
  gate    CLIP --out DIR [--every S]      review sheets and flagged frames for a finished clip

A SPEC is JSON, one per recording:

  {
    "video": "~/Desktop/Lunch & Learn ... - Recording.mp4",
    "share": [0, 147, 1440, 786],
    "stills": {
      "landing": {"t": 290, "crop": [8, 74, 1424, 648], "boxes": [[290, 42, 142, 34]]}
    },
    "clips": {
      "open_builder": {"segments": [[1065.7, 1069.1, 1.0]], "hold": 1.5,
                       "boxes": [[14, 37, 84, 29, 1065.7, 1068.36]]}
    }
  }

Clip segments are [start, end, speed] in source seconds, joined in order, so a
gap between two segments is a jump cut. Clip boxes may carry absolute source
times [x, y, w, h, t0, t1]; without them a box covers the whole clip. Optional
per-still/per-clip keys: "crop" (share space), and for clips "hold" (seconds to
freeze the last frame), "fps", "crf".
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HINTS = {
    "ffmpeg": "brew install ffmpeg",
    "ffprobe": "brew install ffmpeg",
    "cwebp": "brew install webp",
    "dwebp": "brew install webp",
}
CELL = "pad=iw+4:ih+4:2:2:red"


def need(*tools):
    missing = [t for t in tools if shutil.which(t) is None]
    if missing:
        sys.exit("missing tools: " + ", ".join(f"{t} ({HINTS[t]})" for t in missing))


def run(args):
    subprocess.run(args, check=True)


def output(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def rect(value):
    """Parse 'x,y,w,h' or a 4-item list into four ints."""
    parts = value if isinstance(value, (list, tuple)) else value.replace(" ", "").split(",")
    if len(parts) != 4:
        sys.exit(f"expected x,y,w,h, got {value!r}")
    return [int(round(float(p))) for p in parts]


def ffcrop(r):
    x, y, w, h = r
    return f"crop={w}:{h}:{x}:{y}"


def probe(path):
    info = json.loads(output(["ffprobe", "-v", "error", "-print_format", "json",
                              "-show_format", "-show_streams", path]))
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    num, den = (int(n) for n in video["r_frame_rate"].split("/"))
    return info, video, (num / den if den else 0.0)


def seek_args(start, end):
    start = start or 0.0
    return start, ["-ss", f"{start}"] + (["-t", f"{end - start}"] if end else [])


def metadata_values(text, key):
    """Pair each `key=value` line from ffmpeg's metadata=print with its pts_time."""
    t, values = None, []
    for line in text.splitlines():
        m = re.search(r"pts_time:([-0-9.]+)", line)
        if m:
            t = float(m.group(1))
        elif line.startswith(key + "=") and t is not None:
            values.append((t, float(line.split("=", 1)[1])))
    return values


def pixelate(label, boxes, prefix, block, window=None):
    """Filter fragments that pixelate each box on stream `label`.

    `window(box)` returns "" (always on), an enable clause, or False (skip)."""
    parts, cur = [], label
    for i, b in enumerate(boxes):
        en = window(b) if window else ""
        if en is False:
            continue
        x, y, w, h = (int(v) for v in b[:4])
        bw, bh = max(1, w // block), max(1, h // block)
        nxt = f"{prefix}o{i}"
        parts.append(
            f"[{cur}]split[{prefix}m{i}][{prefix}c{i}];"
            f"[{prefix}c{i}]crop={w}:{h}:{x}:{y},scale={bw}:{bh}:flags=area,"
            f"scale={w}:{h}:flags=neighbor[{prefix}p{i}];"
            f"[{prefix}m{i}][{prefix}p{i}]overlay={x}:{y}{en}[{nxt}]"
        )
        cur = nxt
    return parts, cur


def load_spec(path):
    with open(path) as f:
        spec = json.load(f)
    spec["video"] = os.path.expanduser(spec["video"])
    if not os.path.exists(spec["video"]):
        sys.exit(f"video not found: {spec['video']}")
    return spec


def parent_dir(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)


def pick(items, only):
    if not only:
        return items
    names = [n for n in only.split(",") if n]
    missing = [n for n in names if n not in items]
    if missing:
        sys.exit("not in spec: " + ", ".join(missing))
    return {n: items[n] for n in names}


def cmd_probe(a):
    need("ffprobe")
    info, _, fps = probe(a.video)
    dur = float(info["format"].get("duration", 0))
    size = int(info["format"].get("size", 0)) // 1024
    print(f"duration {dur:.1f}s ({int(dur // 60)}:{int(dur % 60):02d})  size {size} KB")
    for s in info["streams"]:
        if s["codec_type"] == "video":
            print(f"video  {s['codec_name']} {s['width']}x{s['height']} @ {fps:g} fps")
        else:
            print(f"{s['codec_type']:6} {s.get('codec_name', '?')}")


def cmd_region(a):
    need("ffmpeg", "ffprobe")
    _, video, _ = probe(a.video)
    w, h = int(video["width"]), int(video["height"])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a.at}", "-i", a.video, "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         check=True, capture_output=True).stdout
    cols, rows = [0] * w, [0] * h
    for y in range(h):
        n = 0
        for x, px in enumerate(raw[y * w:(y + 1) * w]):
            if px > a.threshold:
                cols[x] += 1
                n += 1
        rows[y] = n

    def longest_run(counts, total):
        best, start = (0, -1), None
        for i, c in enumerate(counts + [0]):
            if c > total * a.fraction:
                start = i if start is None else start
            elif start is not None:
                if i - 1 - start > best[1] - best[0]:
                    best = (start, i - 1)
                start = None
        return best

    x0, x1 = longest_run(cols, h)
    y0, y1 = longest_run(rows, w)
    if x1 < x0 or y1 < y0:
        sys.exit("no bright region found; try another --at, or lower --threshold / --fraction")
    share = [x0, y0, (x1 - x0 + 1) // 2 * 2, (y1 - y0 + 1) // 2 * 2]
    print(f"share {','.join(map(str, share))}   (ffmpeg {ffcrop(share)})")
    print("Confirm it on an extracted frame before using it; dark UIs and full-screen shares need a check.")


def cmd_sheet(a):
    need("ffmpeg")
    parent_dir(a.out)
    pre = f"{ffcrop(rect(a.share))}," if a.share else ""
    cell = f"scale={a.width}:-2,{CELL}"
    if a.times:
        times = [float(t) for t in a.times.split(",") if t]
        with tempfile.TemporaryDirectory() as tmp:
            for i, t in enumerate(times):
                run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t}", "-i", a.video, "-frames:v", "1",
                     "-vf", pre + cell, os.path.join(tmp, f"{i:04d}.png")])
            rows = -(-len(times) // a.cols)
            run(["ffmpeg", "-v", "error", "-y", "-framerate", "1", "-i", os.path.join(tmp, "%04d.png"),
                 "-vf", f"tile={a.cols}x{rows}", "-frames:v", "1", a.out])
        print(a.out)
        for i, t in enumerate(times):
            print(f"  row {i // a.cols + 1} col {i % a.cols + 1}: {t:.2f}s")
        return
    start, seek = seek_args(a.start, a.end)
    pattern = a.out if "%" in a.out else re.sub(r"(\.png)?$", "_%02d.png", a.out, count=1)
    run(["ffmpeg", "-v", "error", "-y", *seek, "-i", a.video,
         "-vf", f"fps=1/{a.every},{pre}{cell},tile={a.cols}x{a.rows}", pattern])
    per = a.cols * a.rows
    print(f"{pattern}\n  sheet k (from 1), cell i (from 0, row by row) = "
          f"{start:g}s + ((k - 1) * {per} + i) * {a.every:g}s")


def cmd_outline(a):
    need("ffmpeg")
    parent_dir(a.out)
    vf = [ffcrop(rect(a.share))] if a.share else []
    vf += [f"drawbox={b[0]}:{b[1]}:{b[2]}:{b[3]}:red:1" for b in json.loads(a.boxes)]
    if a.crop:
        vf.append(ffcrop(rect(a.crop)))
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a.at}", "-i", a.video, "-frames:v", "1",
         "-vf", ",".join(vf), a.out])
    print(a.out)


def cmd_still(a):
    need("ffmpeg", "cwebp", "dwebp")
    spec = load_spec(a.spec)
    share = rect(spec["share"])
    check_dir = os.path.join(a.out, "check")
    os.makedirs(check_dir, exist_ok=True)
    for name, s in pick(spec.get("stills", {}), a.only).items():
        parts, last = pixelate("v0", s.get("boxes", []), "", a.block)
        x, y, w, h = rect(s["crop"]) if s.get("crop") else [0, 0, share[2], share[3]]
        graph = f"[0:v]{ffcrop(share)}[v0];" + "".join(p + ";" for p in parts) + f"[{last}]crop={w}:{h}:{x}:{y}[out]"
        png, webp = os.path.join(a.out, name + ".png"), os.path.join(a.out, name + ".webp")
        check = os.path.join(check_dir, name + ".png")
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(s["t"]), "-i", spec["video"], "-frames:v", "1",
             "-filter_complex", graph, "-map", "[out]", png])
        run(["cwebp", "-quiet", "-q", str(a.quality), png, "-o", webp])
        run(["dwebp", "-quiet", webp, "-o", check])
        print(f"{webp}  {os.path.getsize(webp) // 1024} KB  review: {check}")


def cmd_clip(a):
    need("ffmpeg", "ffprobe")
    spec = load_spec(a.spec)
    share = ffcrop(rect(spec["share"]))
    _, _, src_fps = probe(spec["video"])
    os.makedirs(a.out, exist_ok=True)
    for name, c in pick(spec.get("clips", {}), a.only).items():
        fps = c.get("fps") or min(round(src_fps) or 24, 30)
        args, graph, labels = ["ffmpeg", "-v", "error", "-y"], [], []
        for i, (t0, t1, speed) in enumerate(c["segments"]):
            length = t1 - t0
            args += ["-ss", f"{t0}", "-t", f"{length:.3f}", "-i", spec["video"]]
            graph.append(f"[{i}:v]{share},setpts=PTS-STARTPTS[s{i}c]")

            def window(b, t0=t0, length=length):
                if len(b) < 6:
                    return ""
                r0, r1 = max(0, b[4] - t0), min(length, b[5] - t0)
                if r1 <= 0 or r0 >= length:
                    return False
                return f":enable='between(t,{r0:.3f},{r1:.3f})'"

            parts, cur = pixelate(f"s{i}c", c.get("boxes", []), f"s{i}", a.block, window)
            graph += parts
            crop = f"{ffcrop(rect(c['crop']))}," if c.get("crop") else ""
            graph.append(f"[{cur}]{crop}setpts=(PTS-STARTPTS)/{speed},fps={fps},format=yuv420p[v{i}]")
            labels.append(f"[v{i}]")
        hold = c.get("hold", 0)
        tail = f"tpad=stop_mode=clone:stop_duration={hold}," if hold else ""
        graph.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0,{tail}setsar=1[out]")
        out = os.path.join(a.out, name + ".mp4")
        run(args + ["-filter_complex", ";".join(graph), "-map", "[out]", "-an",
                    "-c:v", "libx264", "-crf", str(c.get("crf", 24)), "-preset", "slow",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", out])
        info, video, _ = probe(out)
        print(f"{out}  {float(info['format']['duration']):.1f}s  "
              f"{int(info['format']['size']) // 1024} KB  {video['width']}x{video['height']}")


def cmd_scan(a):
    need("ffmpeg")
    start, seek = seek_args(a.start, a.end)
    pre = f"{ffcrop(rect(a.share))}," if a.share else ""
    text = output(["ffmpeg", "-v", "error", *seek, "-i", a.video, "-vf",
                   f"{pre}select='gt(scene,{a.scene})',metadata=print:file=-", "-f", "null", "-"])
    for t, score in metadata_values(text, "lavfi.scene_score"):
        print(f"scene   {start + t:10.3f}s  score {score:.3f}")
    if a.region:
        text = output(["ffmpeg", "-v", "error", *seek, "-i", a.video, "-vf",
                       f"{pre}{ffcrop(rect(a.region))},signalstats,"
                       "metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"])
        values = metadata_values(text, "lavfi.signalstats.YAVG")
        jumps = 0
        for (t0, y0), (t1, y1) in zip(values, values[1:]):
            if abs(y1 - y0) > a.jump:
                jumps += 1
                print(f"region  {start + t0:10.3f}s {y0:6.1f} -> {start + t1:10.3f}s {y1:6.1f}")
        print(f"region  {len(values)} frames traced, {jumps} jump(s) over {a.jump:g}")


def cmd_gate(a):
    need("ffmpeg", "ffprobe")
    os.makedirs(a.out, exist_ok=True)
    name = os.path.splitext(os.path.basename(a.clip))[0]
    info, _, _ = probe(a.clip)
    dur = float(info["format"]["duration"])
    pattern = os.path.join(a.out, f"{name}_sheet_%02d.png")
    run(["ffmpeg", "-v", "error", "-y", "-i", a.clip, "-vf",
         f"fps=1/{a.every},scale={a.width}:-2,{CELL},tile={a.cols}x{a.rows}", pattern])
    run(["ffmpeg", "-v", "error", "-y", "-i", a.clip, "-frames:v", "1",
         os.path.join(a.out, f"{name}_first.png")])
    run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.1", "-i", a.clip, "-frames:v", "1", "-update", "1",
         os.path.join(a.out, f"{name}_last.png")])
    text = output(["ffmpeg", "-v", "error", "-i", a.clip, "-vf",
                   f"select='gt(scene,{a.scene})',metadata=print:file=-", "-f", "null", "-"])
    scenes = metadata_values(text, "lavfi.scene_score")
    for t, score in scenes:
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", a.clip, "-frames:v", "1",
             os.path.join(a.out, f"{name}_scene_{t:07.3f}.png")])
        print(f"scene   {t:8.3f}s  score {score:.3f}")
    print(f"{dur:.1f}s clip: sheets every {a.every:g}s -> {pattern}")
    print(f"read every sheet, then the first, last and {len(scenes)} scene-change frame(s) in {a.out}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("probe", help="streams, duration, fps")
    s.add_argument("video")

    s = sub.add_parser("region", help="estimate the shared-screen rectangle")
    s.add_argument("video")
    s.add_argument("--at", type=float, required=True, help="a time when the shared screen is showing")
    s.add_argument("--threshold", type=int, default=60, help="gray level that counts as lit (0-255)")
    s.add_argument("--fraction", type=float, default=0.5, help="share of a row/column that must be lit")

    s = sub.add_parser("sheet", help="contact sheet(s) of a video")
    s.add_argument("video")
    s.add_argument("--out", required=True)
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--every", type=float, help="seconds between cells")
    g.add_argument("--times", help="comma-separated source times")
    s.add_argument("--share", help="x,y,w,h to crop first")
    s.add_argument("--from", dest="start", type=float)
    s.add_argument("--to", dest="end", type=float)
    s.add_argument("--width", type=int, default=400)
    s.add_argument("--cols", type=int, default=4)
    s.add_argument("--rows", type=int, default=4)

    s = sub.add_parser("outline", help="draw planned pixelation boxes on a frame")
    s.add_argument("video")
    s.add_argument("--at", type=float, required=True)
    s.add_argument("--boxes", required=True, help="JSON list of [x,y,w,h] in share space")
    s.add_argument("--out", required=True)
    s.add_argument("--share", help="x,y,w,h")
    s.add_argument("--crop", help="x,y,w,h in share space, applied after drawing")

    for name, text in (("still", "render stills from a spec"), ("clip", "render clips from a spec")):
        s = sub.add_parser(name, help=text)
        s.add_argument("spec")
        s.add_argument("--out", required=True)
        s.add_argument("--only", help="comma-separated names from the spec")
        s.add_argument("--block", type=int, default=8, help="pixelation block size")
        if name == "still":
            s.add_argument("--quality", type=int, default=88)

    s = sub.add_parser("scan", help="scene changes and region-brightness jumps")
    s.add_argument("video")
    s.add_argument("--from", dest="start", type=float)
    s.add_argument("--to", dest="end", type=float)
    s.add_argument("--share", help="x,y,w,h")
    s.add_argument("--region", help="x,y,w,h in share space to trace frame by frame")
    s.add_argument("--scene", type=float, default=0.02)
    s.add_argument("--jump", type=float, default=15, help="brightness change that counts as a jump")

    s = sub.add_parser("gate", help="review material for a finished clip")
    s.add_argument("clip")
    s.add_argument("--out", required=True)
    s.add_argument("--every", type=float, default=0.5)
    s.add_argument("--scene", type=float, default=0.02)
    s.add_argument("--width", type=int, default=400)
    s.add_argument("--cols", type=int, default=4)
    s.add_argument("--rows", type=int, default=4)

    a = p.parse_args()
    {"probe": cmd_probe, "region": cmd_region, "sheet": cmd_sheet, "outline": cmd_outline,
     "still": cmd_still, "clip": cmd_clip, "scan": cmd_scan, "gate": cmd_gate}[a.cmd](a)


if __name__ == "__main__":
    main()
