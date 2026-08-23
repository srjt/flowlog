#!/usr/bin/env python3
"""Transcribe video/audio to .txt using whisper.cpp with Metal GPU acceleration.

Extracts audio with ffmpeg, runs whisper-cli on the GPU, writes a .txt beside
the input with the same basename. Everything stays on this machine.

    scripts/transcribe.py "video.mp4"                 # -> video.txt
    scripts/transcribe.py ~/Documents/Instructionals  # batch, recursive
    scripts/transcribe.py video.mp4 --model large-v3 --timestamps

Only the Python standard library is required; whisper-cli and ffmpeg come from
Homebrew (`brew install whisper-cpp ffmpeg`).

NOTE: this deliberately does NOT pass whisper-cli's -nt/--no-timestamps flag.
In whisper.cpp 1.9.2 that flag makes the writer silently drop words at some
segment boundaries. We read the JSON output instead, which is complete.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

MODEL_DIR = Path(os.environ.get("WHISPER_MODEL_DIR",
                                Path.home() / ".cache" / "whisper-cpp" / "models"))
MODEL_REPO = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
VAD_REPO = "https://huggingface.co/ggml-org/whisper-vad/resolve/main"
VAD_MODEL = "ggml-silero-v5.1.2.bin"

# Anything ffmpeg can demux; extend freely.
MEDIA_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm", ".flv", ".ts",
              ".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus", ".aiff"}


def die(msg: str) -> "typing.NoReturn":  # noqa: F821
    sys.exit(f"error: {msg}")


def hms(seconds: float) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _download(url: str, path: Path, label: str) -> Path:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"{label} not found locally. Downloading from {url}", file=sys.stderr)
    tmp = path.with_suffix(".part")
    try:
        with urllib.request.urlopen(url) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length", 0))
            done = 0
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done/1e9:.2f}/{total/1e9:.2f} GB "
                          f"({100*done/total:.0f}%)", end="", file=sys.stderr)
        print(file=sys.stderr)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        die(f"could not download {label}: {exc}")
    tmp.rename(path)
    return path


def resolve_vad() -> Path:
    """Silero VAD model. Without it whisper hallucinates over silent stretches."""
    path = MODEL_DIR / VAD_MODEL
    return path if path.exists() else _download(f"{VAD_REPO}/{VAD_MODEL}", path, "VAD model")


def resolve_model(name: str) -> Path:
    """Return the ggml model path, downloading it once if absent."""
    path = MODEL_DIR / f"ggml-{name}.bin"
    if path.exists():
        return path
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    url = f"{MODEL_REPO}/ggml-{name}.bin"
    print(f"Model '{name}' not found locally. Downloading from {url}", file=sys.stderr)
    tmp = path.with_suffix(".part")
    try:
        with urllib.request.urlopen(url) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length", 0))
            done = 0
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if total:
                    pct = 100 * done / total
                    print(f"\r  {done/1e9:.2f}/{total/1e9:.2f} GB ({pct:.0f}%)",
                          end="", file=sys.stderr)
        print(file=sys.stderr)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        die(f"could not download model '{name}': {exc}")
    tmp.rename(path)
    return path


def media_duration(src: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
        capture_output=True, text=True)
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def extract_audio(src: Path, dst: Path) -> None:
    """Decode any container to the 16 kHz mono WAV whisper expects."""
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(dst)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.strip()[:400]}")
    if not dst.exists() or dst.stat().st_size <= 44:  # 44 = empty wav header
        raise RuntimeError("no audio track found")


def run_whisper(wav: Path, model: Path, language: str, threads: int,
                prompt: str | None, workdir: Path,
                vad_model: Path | None = None) -> list[dict]:
    """Run whisper-cli and return its JSON segments."""
    stem = workdir / "out"
    cmd = ["whisper-cli", "-m", str(model), "-f", str(wav), "-l", language,
           "-t", str(threads), "-np", "-oj", "-of", str(stem)]
    if vad_model:
        cmd += ["--vad", "--vad-model", str(vad_model)]
    if prompt:
        cmd += ["--prompt", prompt, "--carry-initial-prompt"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    js = stem.with_suffix(".json")
    if proc.returncode != 0 or not js.exists():
        raise RuntimeError(f"whisper-cli failed: {proc.stderr.strip()[-400:]}")
    return json.loads(js.read_text())["transcription"]


def render(segments: list[dict], timestamps: bool) -> str:
    lines = []
    for seg in segments:
        text = seg["text"].strip()
        if not text:
            continue
        if timestamps:
            off = seg["offsets"]
            lines.append(f"[{hms(off['from']/1000)} -> {hms(off['to']/1000)}] {text}")
        else:
            lines.append(text)
    return ("\n".join(lines) if timestamps else " ".join(lines)) + "\n"


def transcribe_one(src: Path, out: Path, model: Path, args) -> tuple[bool, str]:
    """Returns (ok, note). Never raises — batch mode keeps going on failure."""
    dur = media_duration(src)
    started = time.time()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            wav = tmpdir / "audio.wav"
            extract_audio(src, wav)
            segments = run_whisper(wav, model, args.language, args.threads,
                                   args.prompt, tmpdir, args._vad_model)
    except RuntimeError as exc:
        return False, str(exc)

    out.write_text(render(segments, args.timestamps), encoding="utf-8")
    elapsed = time.time() - started
    speed = f"{dur/elapsed:.1f}x realtime" if elapsed > 0 and dur else "?"
    return True, f"{len(segments)} segments, {hms(dur)} audio in {elapsed:.0f}s ({speed})"


def collect_inputs(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    files = [p for p in sorted(target.rglob("*"))
             if p.is_file() and p.suffix.lower() in MEDIA_EXTS
             and not p.name.startswith("._")
             # skip bookkeeping dirs like _corrupt-originals/ and dot-dirs
             and not any(part.startswith(("_", ".")) for part in p.relative_to(target).parts[:-1])]
    return files


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path,
                        help="media file, or a directory to batch through recursively")
    parser.add_argument("-o", "--output", type=Path,
                        help="output .txt path (single-file mode only; "
                             "default is <input>.txt beside the input)")
    parser.add_argument("-m", "--model", default="large-v3-turbo",
                        help="ggml model name (default: large-v3-turbo; "
                             "large-v3 is ~2x slower for a small accuracy gain)")
    parser.add_argument("-l", "--language", default="en",
                        help="language code, or 'auto' to detect (default: en)")
    parser.add_argument("-t", "--threads", type=int,
                        default=min(8, os.cpu_count() or 4),
                        help="CPU threads for the non-GPU stages")
    parser.add_argument("--timestamps", action="store_true",
                        help="prefix each segment with [hh:mm:ss -> hh:mm:ss]")
    parser.add_argument("--prompt", default=None,
                        help="vocabulary priming, e.g. domain jargon and proper nouns")
    parser.add_argument("--overwrite", action="store_true",
                        help="batch mode: redo files whose .txt already exists")
    parser.add_argument("--no-vad", action="store_true",
                        help="disable voice-activity detection. NOT recommended: "
                             "without VAD whisper invents subtitle boilerplate "
                             "over silent stretches of audio")
    parser.add_argument("--dry-run", action="store_true",
                        help="list what would be transcribed, then exit")
    args = parser.parse_args()

    for tool in ("ffmpeg", "ffprobe", "whisper-cli"):
        if shutil.which(tool) is None:
            die(f"{tool} not on PATH. Install with: brew install whisper-cpp ffmpeg")
    if not args.input.exists():
        die(f"no such file or directory: {args.input}")

    batch = args.input.is_dir()
    if batch and args.output:
        die("--output is only valid for a single file; batch writes beside each input")

    inputs = collect_inputs(args.input)
    if not inputs:
        die(f"no media files found under {args.input}")

    jobs: list[tuple[Path, Path]] = []
    skipped = 0
    for src in inputs:
        out = args.output if (args.output and not batch) else src.with_suffix(".txt")
        if batch and out.exists() and not args.overwrite:
            skipped += 1
            continue
        jobs.append((src, out))

    args._vad_model = None
    if args.dry_run:
        for src, out in jobs:
            print(f"{src}  ->  {out}")
        print(f"\n{len(jobs)} to transcribe, {skipped} already done", file=sys.stderr)
        return
    if not jobs:
        print(f"Nothing to do — all {skipped} file(s) already have a .txt "
              f"(use --overwrite to redo).", file=sys.stderr)
        return

    model = resolve_model(args.model)
    args._vad_model = None if args.no_vad else resolve_vad()
    print(f"Model: {model.name}   VAD: {'off' if args.no_vad else 'on'}   Files: {len(jobs)}"
          + (f"   Skipped (already done): {skipped}" if skipped else ""), file=sys.stderr)

    failures: list[tuple[Path, str]] = []
    for i, (src, out) in enumerate(jobs, 1):
        print(f"\n[{i}/{len(jobs)}] {src.name}", file=sys.stderr)
        ok, note = transcribe_one(src, out, model, args)
        if ok:
            print(f"    -> {out.name}  ({note})", file=sys.stderr)
        else:
            print(f"    !! FAILED: {note}", file=sys.stderr)
            failures.append((src, note))

    done = len(jobs) - len(failures)
    print(f"\nDone: {done}/{len(jobs)} transcribed.", file=sys.stderr)
    if failures:
        print("Failed:", file=sys.stderr)
        for src, note in failures:
            print(f"  {src}: {note}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
