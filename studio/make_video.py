#!/usr/bin/env python3
"""차트분석 영상 자동 편집기

녹화한 차트 화면(목소리 없음) + 직접 쓴 대본  →  TTS 내레이션, 컷편집, 자막, 하이라이트,
배경음악, 효과음, 채널 브랜딩(로고·색·폰트·인트로/아웃트로)이 들어간 완성 영상.

    python3 studio/make_video.py 녹화.mp4 대본.txt
    python3 studio/make_video.py 녹화.mp4 대본.txt --shorts      # 쇼츠도 같이
    python3 studio/make_video.py 녹화.mp4 대본.txt --preview     # 빠른 저화질 미리보기

필요: ffmpeg, python3, `pip install edge-tts pyyaml`
"""

import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("pyyaml 이 없습니다:  python3 -m pip install --user pyyaml edge-tts")

HERE = Path(__file__).resolve().parent
SR = 48000


# ───────────────────────────── 공통 ─────────────────────────────

def log(msg):
    print(msg, flush=True)


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        sys.stderr.write("\n$ " + " ".join(str(c) for c in cmd) + "\n")
        sys.stderr.write(r.stderr[-3000:])
        sys.exit("ffmpeg 실행 실패 (위 오류 참고)")
    return r.stdout


def ffmpeg(*args, cwd=None):
    return run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *map(str, args)], cwd=cwd)


def probe_duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(out.strip())


def has_audio(path):
    out = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
               "-of", "csv=p=0", str(path)])
    return bool(out.strip())


def deep_merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = deep_merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def ass_color(hex_rgb, alpha=0):
    h = hex_rgb.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(t):
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def srt_time(t):
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def yt_time(t):
    t = int(t)
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def ass_escape(s):
    return s.replace("\\", "＼").replace("{", "(").replace("}", ")")


def count_chars(s):
    """타이밍 맞추기용 글자 수: 공백·문장부호 빼고 글자/숫자만."""
    return sum(1 for ch in s if ch.isalnum())


# ───────────────────────────── 브랜드 ─────────────────────────────

def load_brand(path):
    default = yaml.safe_load((HERE / "brand.yaml").read_text(encoding="utf-8"))
    brand = default
    base = HERE
    if path:
        path = Path(path).resolve()
        brand = deep_merge(default, yaml.safe_load(path.read_text(encoding="utf-8")) or {})
        base = path.parent

    def resolve(p):
        if not p:
            return None
        p = Path(os.path.expanduser(p))
        p = p if p.is_absolute() else base / p
        if not p.exists():
            log(f"  ! 브랜드 파일을 찾을 수 없음: {p} (건너뜀)")
            return None
        return p

    brand["_logo"] = resolve(brand["logo"].get("file"))
    brand["_fontdir"] = resolve(brand["font"].get("dir"))
    brand["_intro"] = resolve(brand.get("intro"))
    brand["_outro"] = resolve(brand.get("outro"))
    brand["_bgm"] = resolve(brand["music"].get("bgm"))
    pr = brand.get("presenter") or {}
    brand["_presenter_photo"] = resolve(pr.get("photo")) if pr.get("enabled") and pr.get("mode") == "photo" else None
    brand["_presenter_dir"] = resolve(pr.get("images")) if pr.get("enabled") else None
    if brand["_presenter_photo"] and not brand["_presenter_dir"]:
        brand["_presenter_dir"] = brand["_presenter_photo"].parent
    if pr.get("enabled") and not brand["_presenter_photo"] and brand["_presenter_dir"] \
            and not (brand["_presenter_dir"] / "mouth0.png").exists():
        log(f"  ! 진행자 폴더에 mouth0.png 가 없습니다: {brand['_presenter_dir']} (진행자 끔)")
        brand["_presenter_dir"] = None
    brand["_sfx_files"] = {k: resolve(v) for k, v in (brand["sfx"].get("files") or {}).items()}
    return brand


# ───────────────────────────── 대본 ─────────────────────────────

TS = r"(?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?"
LINE_RE = re.compile(rf"^({TS})(?:\s*[-~]\s*({TS}))?\s*(.*)$")
TAG_RE = re.compile(r"\[([^\]]+)\]")
VOICE_TAG_RE = re.compile(r"\{([^}]*)\}")   # {숨} {한숨} {웃음} — 목소리 표현 (자막에는 안 나옴)
KNOWN_TAGS = {"컷", "끝", "강조", "하이라이트", "효과음", "줌", "챕터", "원속도"}


def parse_ts(s):
    sec = 0.0
    for part in s.split(":"):
        sec = sec * 60 + float(part)
    return sec


@dataclass
class Seg:
    src_start: float
    src_end: float = None
    display: str = ""          # *강조* 표시가 남아있는 자막용 글
    voice: str = ""            # TTS에 보낼 글 ({숨} 같은 목소리 표시 포함)
    tags: dict = field(default_factory=dict)
    # 계산 결과
    tts: Path = None
    tts_dur: float = 0.0
    words: list = None         # [(시작초, 끝초, 글)]
    speed: float = 1.0
    used_src: float = 0.0
    frames: int = 0
    out_start: float = 0.0
    out_len: float = 0.0

    @property
    def spoken(self):
        return re.sub(r"\s+", " ", self.display.replace("*", "")).strip()

    @property
    def voice_text(self):
        return re.sub(r"\s+", " ", (self.voice or self.display).replace("*", "")).strip()


def parse_script(path):
    title = ""
    events = []      # ("seg", Seg) | ("cut", a, b) | ("end", t)
    last = None
    for n, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        mt = re.match(r"^(제목|title)\s*:\s*(.+)$", line, re.I)
        if mt:
            title = mt.group(2).strip()
            continue
        m = LINE_RE.match(line)
        if not m:
            if last is None:
                sys.exit(f"대본 {n}번째 줄: 시간으로 시작해야 합니다 → {line}")
            last.voice += " " + line            # 이어지는 줄
            last.display = re.sub(r"\s+", " ", VOICE_TAG_RE.sub("", last.voice)).strip()
            continue
        start, end, rest = parse_ts(m.group(1)), (parse_ts(m.group(2)) if m.group(2) else None), m.group(3)
        tags = {}
        for t in TAG_RE.findall(rest):
            name, _, val = t.partition(":")
            name = name.strip()
            if name not in KNOWN_TAGS:
                log(f"  ! 대본 {n}번째 줄: 모르는 태그 [{t}] (무시)")
                continue
            tags[name] = val.strip()
        text = TAG_RE.sub("", rest).strip()
        if "끝" in tags:
            events.append(("end", start))
            last = None
            continue
        if "컷" in tags:
            if end is None:
                sys.exit(f"대본 {n}번째 줄: [컷] 은 0:20-0:28 처럼 범위를 써야 합니다")
            events.append(("cut", start, end))
            last = None
            continue
        seg = Seg(src_start=start, display=re.sub(r"\s+", " ", VOICE_TAG_RE.sub("", text)).strip(),
                  voice=text, tags=tags)
        events.append(("seg", seg))
        if end is not None:
            events.append(("cut", end, None))   # 범위 끝 이후는 다음 시간까지 잘라냄
        last = seg
    return title, events


def build_segments(events, video_dur):
    """시간 순서로 구간을 만들고, 각 구간의 끝(다음 경계)을 정한다."""
    points = []   # (시간, 종류, 데이터)
    for ev in events:
        if ev[0] == "seg":
            points.append((ev[1].src_start, 1, ev[1]))
        elif ev[0] == "cut":
            points.append((ev[1], 0, None))                     # 여기서 앞 구간 끝
            if ev[2] is not None:
                points.append((ev[2], 1, Seg(src_start=ev[2])))  # 컷 뒤 이어지는 무음 구간
        elif ev[0] == "end":
            points.append((ev[1], 0, None))
            points.append((math.inf, 0, None))
    points.sort(key=lambda p: (p[0], p[1]))
    segs = []
    cur = None
    for t, kind, seg in points:
        if cur is not None:
            cur.src_end = min(t, video_dur)
            if cur.src_end - cur.src_start > 0.05:
                segs.append(cur)
            cur = None
        if t == math.inf:
            break
        if kind == 1:
            cur = seg
    if cur is not None:
        cur.src_end = video_dur
        if cur.src_end - cur.src_start > 0.05:
            segs.append(cur)
    # [끝] 이후 구간 제거
    ends = [ev[1] for ev in events if ev[0] == "end"]
    if ends:
        segs = [s for s in segs if s.src_start < min(ends)]
    for s in segs:
        if s.src_start >= video_dur:
            sys.exit(f"대본 시간 {yt_time(s.src_start)} 이 영상 길이({yt_time(video_dur)})보다 깁니다")
    return segs


# ───────────────────────────── TTS ─────────────────────────────

def tts_edge(text, voice, out_mp3):
    import edge_tts

    async def go():
        c = edge_tts.Communicate(text, voice["name"], rate=voice["rate"], pitch=voice["pitch"],
                                 volume=voice["volume"], boundary="WordBoundary",
                                 proxy=os.environ.get("HTTPS_PROXY") or None)
        words = []
        with open(out_mp3, "wb") as f:
            async for chunk in c.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    st = chunk["offset"] / 1e7
                    words.append((st, st + chunk["duration"] / 1e7, chunk["text"]))
        return words

    for attempt in range(3):
        try:
            return asyncio.run(go())
        except Exception as e:  # 네트워크 일시 오류
            if attempt == 2:
                sys.exit(f"Edge TTS 실패: {e}\n인터넷 연결을 확인하거나, brand.yaml 에서 voice.engine: test 로 점검해 보세요.")
            log(f"  TTS 재시도 ({e})")


def _decode(path, rate):
    """오디오 파일 → float32 mono numpy."""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(rate),
                          "-f", "f32le", "-"], stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def _breath(rate, dur, rnd, level=0.035):
    """들숨 소리 합성: 걸러낸 잡음 + 들이쉬는 모양의 크기 변화."""
    import numpy as np
    n = int(rate * dur)
    noise = np.random.default_rng(rnd.randrange(1 << 30)).standard_normal(n)
    spec = np.fft.rfft(noise)
    f = np.fft.rfftfreq(n, 1 / rate)
    band = np.exp(-((np.log(np.maximum(f, 1)) - np.log(1400)) / 0.75) ** 2)   # 1.4kHz 근처 숨결
    sig = np.fft.irfft(spec * band, n)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * np.clip(t / 0.85, 0, 1)) ** 1.5 * (0.6 + 0.4 * t)
    sig = sig / (np.abs(sig).max() + 1e-9) * env * level
    return sig.astype(np.float32)


def _write_mp3(samples, rate, out_mp3, af=None):
    import numpy as np
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-"]
    if af:
        cmd += ["-af", af]
    cmd += ["-c:a", "libmp3lame", "-q:a", "2", str(out_mp3)]
    subprocess.run(cmd, input=np.asarray(samples, np.float32).tobytes(), check=True)


def _split_phrases(text):
    """문장·쉼표 단위로 나누기. [(구절, 끝종류)] 끝종류: ',' '.' '?' '!' 'breath'"""
    out = []
    for part in re.split(r"(\{[^}]*\})", text):
        if not part.strip():
            continue
        m = VOICE_TAG_RE.fullmatch(part.strip())
        if m:
            out.append(("", "breath" if m.group(1).strip() in ("숨", "한숨") else "tag"))
            continue
        for ph in re.findall(r"[^,.?!。…]+[,.?!。…]*", part):
            ph = ph.strip()
            if ph:
                end = ph[-1] if ph[-1] in ",.?!" else ("." if ph[-1] in "。…" else "")
                out.append((ph, end))
    return out


def tts_edge_human(text, voice, out_mp3):
    """무료 Edge 목소리를 사람처럼: 구절마다 속도·높낮이 변화, 자연스러운 쉼, 숨소리."""
    import numpy as np
    import random
    rate_sr = 24000
    rnd = random.Random(int(hashlib.sha1(text.encode()).hexdigest(), 16))
    h = voice.get("humanize") or {}
    base_rate = int(str(voice["rate"]).replace("%", "") or 0)
    base_pitch = int(str(voice["pitch"]).replace("Hz", "") or 0)
    phrases = _split_phrases(text)
    pieces, words, t = [], [], 0.0
    tmp = Path(str(out_mp3) + ".part.mp3")
    spoken_count = 0
    for k, (ph, end) in enumerate(phrases):
        if not ph:
            if end == "breath":
                b = _breath(rate_sr, rnd.uniform(0.38, 0.5), rnd, float(h.get("breath_level", 0.035)) * 1.3)
                pieces.append(b)
                pieces.append(np.zeros(int(rate_sr * 0.08), np.float32))
                t += (len(b) + int(rate_sr * 0.08)) / rate_sr
            continue
        # 구절마다 조금씩 다른 속도·높낮이 (문장 끝은 살짝 느리게, 질문은 끝을 올림)
        r = base_rate + rnd.randint(-4, 4) - (3 if end in ".!" else 0) + (2 if spoken_count == 0 else 0)
        pt = base_pitch + rnd.randint(-5, 5) + (10 if end == "?" else 0) - (2 if end == "." else 0)
        v = dict(voice, rate=f"{r:+d}%", pitch=f"{pt:+d}Hz")
        w = tts_edge(ph, v, tmp)
        a = _decode(tmp, rate_sr)
        # 앞뒤 무음 다듬기
        thr = 0.01 * (np.abs(a).max() + 1e-9)
        idx = np.where(np.abs(a) > thr)[0]
        s0, s1 = (max(0, idx[0] - int(rate_sr * 0.02)), min(len(a), idx[-1] + int(rate_sr * 0.06))) if len(idx) else (0, len(a))
        a = a[s0:s1]
        off = t - s0 / rate_sr
        words += [(max(0.0, float(ws + off)), float(we + off), wt) for ws, we, wt in w]
        pieces.append(a)
        t += len(a) / rate_sr
        spoken_count += 1
        if k == len(phrases) - 1:
            break
        # 쉼 + 숨소리
        if end == ",":
            gap = rnd.uniform(0.14, 0.26)
        elif end in ".?!":
            gap = rnd.uniform(0.38, 0.55)
        else:
            gap = rnd.uniform(0.06, 0.12)
        nxt = phrases[k + 1]
        if h.get("breaths", True) and end in ".?!" and nxt[1] != "breath" and len(ph) >= 10:
            b = _breath(rate_sr, min(gap + 0.05, rnd.uniform(0.32, 0.45)), rnd, float(h.get("breath_level", 0.035)))
            pre = np.zeros(int(rate_sr * 0.06), np.float32)
            seg = np.concatenate([pre, b])
            rest = int(rate_sr * gap) - len(seg)
            if rest > 0:
                seg = np.concatenate([seg, np.zeros(rest, np.float32)])
        else:
            seg = np.zeros(int(rate_sr * gap), np.float32)
        pieces.append(seg)
        t += len(seg) / rate_sr
    tmp.unlink(missing_ok=True)
    audio = np.concatenate(pieces) if pieces else np.zeros(rate_sr // 2, np.float32)
    # 살짝 따뜻하고 가까운 소리로 (저음 약간↑, 쏘는 고음 약간↓)
    _write_mp3(audio, rate_sr, out_mp3, af="equalizer=f=200:t=q:w=1:g=2,equalizer=f=7000:t=q:w=1.4:g=-2.5")
    return words


ELEVEN_TAGS = {"숨": "[breathes]", "한숨": "[sighs]", "웃음": "[laughs]", "속삭임": "[whispers]", "놀람": "[surprised]"}


def tts_elevenlabs(text, voice, out_mp3):
    """ElevenLabs: 가장 사람 같은 목소리. 키는 환경변수 ELEVENLABS_API_KEY (클라우드에서는 자동 주입)."""
    import base64
    import urllib.request
    el = voice.get("elevenlabs") or {}
    model = el.get("model", "eleven_v3")
    vid = el.get("voice_id")
    if not vid:
        sys.exit("brand.yaml 의 voice.elevenlabs.voice_id 를 정해주세요 (python3 studio/make_video.py --list-voices 로 목록 확인)")
    tagged = VOICE_TAG_RE.sub(lambda m: (ELEVEN_TAGS.get(m.group(1).strip(), "") if model == "eleven_v3" else "") + " ", text)
    body = {"text": re.sub(r"\s+", " ", tagged).strip(), "model_id": model,
            "voice_settings": {"stability": float(el.get("stability", 0.4)),
                               "similarity_boost": float(el.get("similarity", 0.8)),
                               "style": float(el.get("style", 0.35)), "use_speaker_boost": True}}
    if model == "eleven_v3":
        body["voice_settings"]["stability"] = min([0.0, 0.5, 1.0], key=lambda v: abs(v - body["voice_settings"]["stability"]))
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{vid}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps(body).encode(), method="POST",
        headers={"xi-api-key": os.environ.get("ELEVENLABS_API_KEY", "injected-by-proxy"),
                 "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                res = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:500]
            if e.code in (401, 403):
                sys.exit(f"ElevenLabs 인증 실패 ({e.code}): API 키를 확인하세요.\n{msg}")
            if attempt == 2:
                sys.exit(f"ElevenLabs 실패 ({e.code}): {msg}")
        except Exception as e:
            if attempt == 2:
                sys.exit(f"ElevenLabs 실패: {e}")
        log("  ElevenLabs 재시도")
    Path(out_mp3).write_bytes(base64.b64decode(res["audio_base64"]))
    al = res.get("normalized_alignment") or res.get("alignment") or {}
    chars = al.get("characters", [])
    st, en = al.get("character_start_times_seconds", []), al.get("character_end_times_seconds", [])
    words, cur, c0, c1, depth = [], "", None, None, 0
    for ch, a, b in zip(chars, st, en):
        if ch == "[":
            depth += 1
        if depth:
            if ch == "]":
                depth -= 1
            continue
        if ch.isspace():
            if cur:
                words.append((c0, c1, cur))
            cur, c0 = "", None
            continue
        if c0 is None:
            c0 = a
        cur += ch
        c1 = b
    if cur:
        words.append((c0, c1, cur))
    return words


def list_eleven_voices():
    import urllib.request
    req = urllib.request.Request("https://api.elevenlabs.io/v2/voices?page_size=100",
                                 headers={"xi-api-key": os.environ.get("ELEVENLABS_API_KEY", "injected-by-proxy")})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    for v in data.get("voices", []):
        lab = v.get("labels") or {}
        print(f"{v['voice_id']}  {v.get('name')}  {lab.get('gender', '')} {lab.get('accent', '')} {lab.get('language', '')}")


def tts_test(text, out_mp3):
    """인터넷 없이 파이프라인 점검용: 글자 수만큼 길이의 부드러운 소리."""
    dur = 0.3 + 0.13 * count_chars(text)
    ffmpeg("-f", "lavfi", "-i", f"sine=frequency=330:sample_rate={SR}:duration={dur:.3f}",
           "-af", "volume=0.15,afade=t=in:d=0.05,afade=t=out:st=%.3f:d=0.1" % (dur - 0.1),
           "-c:a", "libmp3lame", "-q:a", "4", out_mp3)
    return []


def synthesize(seg, brand, work):
    text = seg.voice_text
    voice = brand["voice"]
    key = hashlib.sha1(json.dumps([text, voice], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    mp3, meta = work / "tts" / f"{key}.mp3", work / "tts" / f"{key}.json"
    mp3.parent.mkdir(parents=True, exist_ok=True)
    if not (mp3.exists() and meta.exists()):
        eng = voice["engine"]
        if eng == "elevenlabs":
            words = tts_elevenlabs(text, voice, mp3)
        elif eng == "edge" and (voice.get("humanize") or {}).get("enabled", True):
            words = tts_edge_human(text, voice, mp3)
        elif eng == "edge":
            words = tts_edge(VOICE_TAG_RE.sub(" ", text), voice, mp3)
        else:
            words = tts_test(seg.spoken, mp3)
        meta.write_text(json.dumps(words, ensure_ascii=False))
    seg.tts = mp3
    seg.tts_dur = probe_duration(mp3)
    seg.words = json.loads(meta.read_text())


# ───────────────────────────── 타임라인 (컷편집) ─────────────────────────────

def plan_timeline(segs, brand, fps):
    p = brand["pacing"]
    t_frames = 0
    for s in segs:
        src_len = s.src_end - s.src_start
        if s.tts:
            target = p["lead"] + s.tts_dur + p["gap"]
            if "원속도" in s.tags:
                s.speed, s.used_src, out = 1.0, src_len, max(src_len, target)
            elif src_len >= target:
                s.speed = min(src_len / target, float(p["max_speed"]))
                s.used_src, out = target * s.speed, target            # 남는 뒷부분은 컷
            else:
                s.speed, s.used_src, out = 1.0, src_len, target       # 모자라면 마지막 장면 정지
        else:
            s.speed = float(p["silent_speed"])
            s.used_src, out = src_len, src_len / s.speed
        s.frames = max(1, round(out * fps))
        s.out_start = t_frames / fps
        s.out_len = s.frames / fps
        t_frames += s.frames
    return t_frames / fps


# ───────────────────────────── 영상 ─────────────────────────────

def render_segments(segs, src, brand, work, W, H, fps, fast):
    bg = brand["colors"]["background"].lstrip("#")
    files = []
    for i, s in enumerate(segs):
        out = work / f"seg_{i:03d}.mp4"
        vf = [f"setpts=(PTS-STARTPTS)/{s.speed:.5f}", f"fps={fps}",
              f"scale={W}:{H}:force_original_aspect_ratio=decrease",
              f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x{bg}", "setsar=1"]
        if "줌" in s.tags:
            # [줌:x,y,배율] — 화면의 x%, y% 지점을 그 자리에 둔 채 확대 (기본 50,50,1.4)
            vals = [v.strip() for v in (s.tags["줌"] or "").split(",") if v.strip()]
            try:
                zx = float(vals[0]) / 100 if len(vals) > 0 else 0.5
                zy = float(vals[1]) / 100 if len(vals) > 1 else 0.5
                z = float(vals[2]) if len(vals) > 2 else 1.4
            except ValueError:
                zx, zy, z = 0.5, 0.5, 1.4
            ramp = fps * 0.8
            zexpr = f"min(1+{z - 1}*on/{ramp},{z})"
            vf.append(f"zoompan=z='{zexpr}':d=1:s={W}x{H}:fps={fps}"
                      f":x='{zx}*(iw-iw/zoom)':y='{zy}*(ih-ih/zoom)'")
        vf.append(f"tpad=stop_mode=clone:stop_duration={s.out_len + 1:.3f}")
        ffmpeg("-ss", f"{s.src_start:.3f}", "-t", f"{s.used_src + 0.1:.3f}", "-i", src,
               "-vf", ",".join(vf), "-frames:v", s.frames, "-an",
               "-c:v", "libx264", "-preset", "ultrafast" if fast else "veryfast", "-crf", "16",
               "-pix_fmt", "yuv420p", out)
        files.append(out)
        log(f"  구간 {i + 1}/{len(segs)}  원본 {yt_time(s.src_start)}~{yt_time(s.src_end)}"
            f"  → {s.out_len:.1f}초" + (f"  ({s.speed:.2f}배속)" if abs(s.speed - 1) > 0.01 else ""))
    lst = work / "segments.txt"
    lst.write_text("".join(f"file '{f.name}'\n" for f in files))
    ffmpeg("-f", "concat", "-safe", "0", "-i", lst.name, "-c", "copy", "clean.mp4", cwd=work)
    return work / "clean.mp4"


# ───────────────────────────── 오디오 ─────────────────────────────

SFX_SYNTH = {
    "pop": "sine=frequency=1100:duration=0.09,volume=0.6,afade=t=out:st=0.02:d=0.07",
    "ding": "sine=frequency=1568:duration=0.9,volume=0.35,afade=t=out:st=0.05:d=0.85",
    "whoosh": "anoisesrc=color=pink:duration=0.55:amplitude=0.5,highpass=f=600,lowpass=f=5000,"
              "afade=t=in:d=0.3:curve=qsin,afade=t=out:st=0.3:d=0.25,volume=0.5",
}


def sfx_file(name, brand, work):
    if brand["_sfx_files"].get(name):
        return brand["_sfx_files"][name]
    if name not in SFX_SYNTH:
        log(f"  ! 효과음 '{name}' 이 없습니다 (brand.yaml 의 sfx.files 에 추가하세요)")
        return None
    out = work / f"sfx_{name}.wav"
    if not out.exists():
        ffmpeg("-f", "lavfi", "-i", SFX_SYNTH[name] + f",aresample={SR}", "-ac", "2", out)
    return out


def pick_bgm(brand, seed):
    p = brand["_bgm"]
    if not p:
        return None
    if p.is_dir():
        files = sorted(f for f in p.iterdir() if f.suffix.lower() in {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"})
        if not files:
            return None
        return files[int(hashlib.sha1(seed.encode()).hexdigest(), 16) % len(files)]
    return p


def build_audio(segs, total, brand, work, seed):
    lead = brand["pacing"]["lead"]
    inputs, nar, fx = [], [], []

    def add(path):
        inputs.extend(["-i", str(path)])
        return len(inputs) // 2 - 1

    for s in segs:
        if s.tts:
            nar.append((add(s.tts), s.out_start + lead))
        sounds = []
        if "강조" in s.tags and brand["sfx"]["emphasis"]:
            sounds.append(brand["sfx"]["emphasis"])
        if "챕터" in s.tags and brand["sfx"]["chapter"]:
            sounds.append(brand["sfx"]["chapter"])
        if "하이라이트" in s.tags and brand["sfx"]["highlight"]:
            sounds.append(brand["sfx"]["highlight"])
        if s.tags.get("효과음"):
            sounds.append(s.tags["효과음"])
        for name in sounds:
            f = sfx_file(name, brand, work)
            if f:
                fx.append((add(f), s.out_start))

    fc = [f"anullsrc=r={SR}:cl=stereo,atrim=0:{total:.3f}[base]"]

    def place(lst, label, vol):
        parts = []
        for k, (idx, at) in enumerate(lst):
            ms = int(at * 1000)
            fc.append(f"[{idx}:a]aresample={SR},aformat=channel_layouts=stereo,volume={vol},"
                      f"adelay={ms}|{ms}[{label}{k}]")
            parts.append(f"[{label}{k}]")
        return parts

    nar_parts = place(nar, "n", 1.0)
    fx_parts = place(fx, "x", brand["sfx"]["volume"])
    mix = ["[base]"]
    if nar_parts:
        fc.append("[base]" + "".join(nar_parts) + f"amix=inputs={len(nar_parts) + 1}:normalize=0:duration=first[nar]")
        mix = ["[nar]"]

    bgm = pick_bgm(brand, seed)
    if bgm:
        log(f"  배경음악: {bgm.name}")
        m = brand["music"]
        bi = add(bgm)
        inputs[-2:-2] = ["-stream_loop", "-1"]
        fo = float(m["fade_out"])
        fc.append(f"[{bi}:a]aresample={SR},aformat=channel_layouts=stereo,atrim=0:{total:.3f},"
                  f"volume={m['volume']},afade=t=in:d=1,afade=t=out:st={max(0, total - fo):.3f}:d={fo}[bgm]")
        if m["duck"] and nar_parts:
            fc.append("[nar]asplit[nar_a][nar_b]")
            fc.append("[bgm][nar_b]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=500[bgmd]")
            mix = ["[nar_a]", "[bgmd]"]
        else:
            mix.append("[bgm]")
    mix += fx_parts
    fc.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=first,"
              f"loudnorm=I=-14:TP=-1.5:LRA=11,aresample={SR}[out]")
    script = work / "audio_filter.txt"
    script.write_text(";\n".join(fc))
    ffmpeg(*inputs, "-filter_complex_script", script, "-map", "[out]", "-t", f"{total:.3f}",
           "-c:a", "pcm_s16le", work / "mix.wav")
    return work / "mix.wav"


# ───────────────────────────── 자막 ─────────────────────────────

def chunk_text(display, max_chars):
    """자막 한 줄씩 나누기. 문장부호에서 먼저 끊고, 길면 띄어쓰기에서 끊는다."""
    sentences = [x.strip() for x in re.split(r"(?<=[.?!。])\s+|(?<=,)\s+", display) if x.strip()]
    chunks = []
    for sent in sentences:
        line = ""
        for w in sent.split():
            cand = (line + " " + w).strip()
            if line and len(cand.replace("*", "")) > max_chars:
                chunks.append(line)
                line = w
            else:
                line = cand
        if line:
            chunks.append(line)
    # 너무 짧은 마지막 조각은 앞에 붙이기
    if len(chunks) >= 2 and len(chunks[-1].replace("*", "")) <= 3 and \
            len((chunks[-2] + chunks[-1]).replace("*", "")) <= max_chars + 4:
        chunks[-2:] = [chunks[-2] + " " + chunks[-1]]
    return chunks


def wrap_words(text, width):
    """띄어쓰기 기준으로 width 글자 안쪽으로 줄바꿈 (제목용)."""
    lines, line = [], ""
    for w in text.split():
        cand = (line + " " + w).strip()
        if line and len(cand) > width:
            lines.append(line)
            line = w
        else:
            line = cand
    return lines + ([line] if line else [])


def caption_events(segs, brand, max_chars):
    """[(시작, 끝, 표시글, 강조여부, 구간번호)] — 출력 영상 기준 시간."""
    lead, events = brand["pacing"]["lead"], []
    for si, s in enumerate(segs):
        if not s.tts or not s.display:
            continue
        chunks = chunk_text(s.display, max_chars)
        sizes = [count_chars(c) for c in chunks]
        total = sum(sizes) or 1
        words = s.words or []
        wchars = [count_chars(w[2]) for w in words]
        use_words = words and abs(sum(wchars) - total) <= max(2, total * 0.1)
        starts, c0 = [], 0
        for n in sizes:
            if use_words:
                acc, st = 0, words[-1][0]
                for (ws, we, wt), wc in zip(words, wchars):
                    if acc + wc > c0:
                        st = ws
                        break
                    acc += wc
            else:
                st = s.tts_dur * c0 / total
            starts.append(st)
            c0 += n
        for k, chunk in enumerate(chunks):
            a = s.out_start + lead + starts[k]
            b = s.out_start + lead + (starts[k + 1] if k + 1 < len(chunks) else s.tts_dur + 0.25)
            b = min(b, s.out_start + s.out_len)
            events.append((a, b, chunk, "강조" in s.tags, si))
    return events


def styled(chunk, brand, emphasis, state):
    """*강조* → 강조색. 강조 상태는 줄을 넘어 이어질 수 있음."""
    acc = ass_color(brand["colors"]["accent"])
    base = acc if emphasis else ass_color(brand["colors"]["text"])
    out = f"{{\\c{acc if (state['on'] or emphasis) else base}}}"
    for part in re.split(r"(\*)", ass_escape(chunk)):
        if part == "*":
            state["on"] = not state["on"]
            out += f"{{\\c{acc}}}" if state["on"] else f"{{\\c{base}}}"
        else:
            out += part
    return out


def write_ass(path, brand, W, H, total, captions, title, chapters, sub_size, vertical=False):
    # 가로 영상에서 오른쪽 아래 진행자가 있으면 자막을 왼쪽으로 비켜 가운데 정렬
    cap_mr = 60
    if brand.get("_presenter_dir") and not vertical:
        S, tag, px, py = presenter_box(brand, W, H, vertical)
        cap_mr = W - px + 20
    c, f, sub = brand["colors"], brand["font"], brand["subtitle"]
    bold = -1 if f["bold"] else 0
    white, black = ass_color(c["text"]), ass_color(c["outline"])
    box = sub["box"]
    scale = H / 1080 if not vertical else W / 1080
    cap_style = (f"Style: Cap,{f['name']},{sub_size},{white},{white},{black},"
                 f"{ass_color('#000000', 0x60) if box else ass_color(c['outline'], 0x40)},{bold},0,0,0,100,100,0,0,"
                 f"{3 if box else 1},{sub['outline']},{sub['shadow']},2,60,{cap_mr},"
                 f"{int(H * 0.35) if vertical else sub['margin_bottom']},1")
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
        "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        cap_style,
        f"Style: Title,{f['name']},{int((70 if vertical else 78) * scale)},{white},{white},{black},{ass_color('#000000', 0x40)},"
        f"-1,0,0,0,100,100,0,0,1,5,2,{8 if vertical else 5},80,80,{int(H * 0.07) if vertical else 0},1",
        f"Style: Chapter,{f['name']},{int(40 * scale)},{ass_color('#111111')},{white},{ass_color(c['main'])},"
        f"{ass_color(c['main'])},-1,0,0,0,100,100,0,0,3,14,0,{9 if vertical else 7},60,60,60,1",
        f"Style: Mark,{f['name']},{int(30 * scale)},{ass_color(c['text'], 0x55)},{white},{ass_color('#000000', 0x80)},"
        f"{ass_color('#000000', 0xFF)},-1,0,0,0,100,100,0,0,1,2,0,9,40,40,36,1",
        f"Style: Note,{f['name']},{int(26 * scale)},{ass_color('#DDDDDD')},{white},{ass_color('#000000', 0x50)},"
        f"{ass_color('#000000', 0x80)},0,0,0,0,100,100,0,0,1,2,0,{2 if vertical else 8},40,40,{int(H * 0.105) if vertical else 24},1",
        f"Style: Bar,{f['name']},10,{ass_color(c['main'])},{white},{ass_color(c['main'])},{ass_color(c['main'])},"
        f"0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    def ev(a, b, style, text, layer=0):
        if b - a > 0.02:
            lines.append(f"Dialogue: {layer},{ass_time(a)},{ass_time(b)},{style},,0,0,0,,{text}")

    # 자막
    state, prev_seg = {"on": False}, None
    for a, b, chunk, emph, si in captions:
        if si != prev_seg:
            state = {"on": False}
            prev_seg = si
        txt = styled(chunk, brand, emph, state)
        if emph and sub["emphasis_pop"]:
            txt = "{\\fscx70\\fscy70\\t(0,140,\\fscx108\\fscy108)\\t(140,220,\\fscx100\\fscy100)}" + txt
        ev(a, b, "Cap", txt, 2)

    # 제목
    if title and brand["title_card"]["show"]:
        # 세로 영상은 제목을 끝까지 띄워둠 (쇼츠 헤드라인)
        d = total if vertical else float(brand["title_card"]["seconds"])
        main = ass_color(c["main"])
        head = "\\N".join(ass_escape(x) for x in wrap_words(title, 15)) if vertical else ass_escape(title)
        ch_line = f"{{\\c{main}}}{ass_escape(brand['channel']['name'])}{{\\c{white}}}\\N" if brand["channel"]["name"] else ""
        ev(0, min(d, total), "Title", f"{{\\fad(300,{0 if vertical else 400})}}{ch_line}{head}", 3)

    # 챕터 라벨
    for at, name in chapters:
        if vertical:
            y = int(H * 0.285)
            mv = f"\\move({W + 400},{y},{W - 50},{y},0,250)"
        else:
            mv = "\\move(-400,60,60,60,0,250)"
        ev(at, min(at + 3.2, total), "Chapter", f"{{{mv}\\fad(0,300)}} {ass_escape(name)} ", 3)

    # 워터마크 (로고 이미지가 없을 때)
    if not brand["_logo"] and brand["channel"]["name"] and not (vertical and title):
        ev(0, total, "Mark", ass_escape(brand["channel"]["name"]), 1)

    # 면책 문구
    ds = float(brand["channel"].get("disclaimer_seconds") or 0)
    if brand["channel"].get("disclaimer") and ds > 0:
        ev(0, min(ds, total), "Note", "{\\fad(200,400)}" + ass_escape(brand["channel"]["disclaimer"]), 1)

    # 진행바
    if brand["progress_bar"]["show"]:
        h = int(brand["progress_bar"]["height"])
        ms = int(total * 1000)
        ev(0, total, "Bar",
           f"{{\\pos(0,{H - h})\\clip(0,0,0,{H})\\t(0,{ms},\\clip(0,0,{W},{H}))\\p1}}m 0 0 l {W} 0 {W} {h} 0 {h}{{\\p0}}", 4)

    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_srt(path, captions):
    out = []
    for i, (a, b, chunk, _, _) in enumerate(captions, 1):
        out.append(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{chunk.replace('*', '')}\n")
    Path(path).write_text("\n".join(out), encoding="utf-8")


# ───────────────────────────── 진행자 (SENA) ─────────────────────────────

def presenter_box(brand, W, H, vertical):
    """원형 진행자 화면의 크기·위치 (화면 오른쪽 아래)."""
    pr = brand["presenter"]
    lay = pr["vertical" if vertical else "landscape"]
    k = W / 1080 if vertical else W / 1920
    S = int(lay["size"] * k)
    tag = int(S * 0.16) if pr.get("name_tag", True) and pr.get("name") else 0
    x = W - S - int(lay["margin_right"] * k)
    y = H - S - tag // 2 - int(lay["margin_bottom"] * k)
    return S, tag, x, y


def font_path(name, bold=True):
    try:
        out = subprocess.run(["fc-match", "-f", "%{file}", f"{name}:{'bold' if bold else 'regular'}"],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout.strip()
        return out or None
    except FileNotFoundError:
        return None


def speech_levels(segs, total, brand, fps):
    """프레임마다 내레이션 소리 크기(0~1 정도). 입 모양을 고르는 데 씀."""
    from array import array
    n = int(round(total * fps)) + 1
    lv = [0.0] * n
    rate = 16000
    win = rate // fps
    lead = brand["pacing"]["lead"]
    for s in segs:
        if not s.tts:
            continue
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(s.tts), "-ac", "1", "-ar", str(rate),
                              "-f", "s16le", "-"], stdout=subprocess.PIPE).stdout
        a = array("h", raw[: len(raw) // 2 * 2])
        f0 = int(round((s.out_start + lead) * fps))
        for j in range(len(a) // win):
            chunk = a[j * win:(j + 1) * win]
            rms = math.sqrt(sum(v * v for v in chunk) / len(chunk)) / 32768
            if 0 <= f0 + j < n:
                lv[f0 + j] = rms
    voiced = sorted(v for v in lv if v > 0.005)
    ref = voiced[int(len(voiced) * 0.9)] if voiced else 1.0
    return [min(1.5, v / ref) for v in lv]


def render_presenter(segs, total, brand, work, W, H, fps, vertical, name):
    """진행자 원형 화면을 투명 배경 영상(.mov)으로 만든다.
    mode: photo  → 사진 1장의 입·턱을 목소리에 맞춰 움직이고 숨쉬기·고개 움직임 (실사)
          images → 입 모양 그림 3장 + 눈 깜빡임 그림 (일러스트)"""
    import random
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    pr = brand["presenter"]
    S, tag, x, y = presenter_box(brand, W, H, vertical)
    ring = max(2, int(S * float(pr.get("ring", 0.035))))
    pad = int(S * 0.08)                      # 말할 때 빛나는 테두리 여유
    BW, BH = S + pad * 2, S + tag // 2 + pad * 2
    cx, cy = BW // 2, pad + S // 2
    main = tuple(int(brand["colors"]["main"].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    D = S - ring * 2
    mask = Image.new("L", (D, D), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, D - 1, D - 1], fill=255)

    photo = brand.get("_presenter_photo")
    if photo:
        sys.path.insert(0, str(HERE / "presenter"))
        from photo_face import PhotoFace
        pf = PhotoFace(photo, D, crop=pr.get("crop") or None, mouth=pr.get("mouth") or None,
                       motion=float(pr.get("motion", 1.0)))
    else:
        d = brand["_presenter_dir"]
        faces = {}
        for kind in ("mouth", "blink"):
            for m in range(3):
                f = d / f"{kind}{m}.png"
                if not f.exists():
                    f = d / f"mouth{m}.png" if (d / f"mouth{m}.png").exists() else d / "mouth0.png"
                im = Image.open(f).convert("RGBA")
                w, h = im.size
                side = min(w, h)
                im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
                faces[(kind, m)] = im.resize((D, D), Image.LANCZOS)

    # 고정 레이어: 테두리(빛남 있/없), 이름표
    bgs = {}
    for glow in (False, True):
        im = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
        if glow:
            g = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
            ImageDraw.Draw(g).ellipse([cx - S // 2 - pad // 2, cy - S // 2 - pad // 2,
                                       cx + S // 2 + pad // 2, cy + S // 2 + pad // 2], fill=main + (150,))
            im = Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(pad / 2.5)))
        ImageDraw.Draw(im).ellipse([cx - S // 2, cy - S // 2, cx + S // 2, cy + S // 2], fill=main + (255,))
        bgs[glow] = im
    tag_layer = None
    if tag:
        fp = font_path(brand["font"]["name"])
        try:
            font = ImageFont.truetype(fp, int(tag * 0.62)) if fp else ImageFont.load_default(int(tag * 0.62))
        except Exception:
            font = ImageFont.load_default()
        tag_layer = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
        dr = ImageDraw.Draw(tag_layer)
        txt = pr["name"]
        tb = dr.textbbox((0, 0), txt, font=font)
        tw = tb[2] - tb[0] + tag
        ty = pad + S - tag // 2
        dr.rounded_rectangle([cx - tw // 2, ty, cx + tw // 2, ty + tag], tag // 2, fill=main + (255,))
        dr.text((cx, ty + tag // 2), txt, font=font, fill=(17, 17, 17, 255), anchor="mm")

    cache = {}

    def compose(face, glow):
        im = bgs[glow].copy()
        im.paste(face, (cx - D // 2, cy - D // 2), mask)
        if tag_layer is not None:
            im = Image.alpha_composite(im, tag_layer)
        return im.tobytes()

    lv = speech_levels(segs, total, brand, fps)
    n = len(lv) - 1
    rnd = random.Random(7)
    next_blink, blink_left = int(fps * 1.5), 0
    state, hold, smooth = 0, 0, 0.0
    out = work / f"{name}.mov"
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
                          "-s", f"{BW}x{BH}", "-r", str(fps), "-i", "-", "-c:v", "qtrle", "-pix_fmt", "argb", str(out)],
                         stdin=subprocess.PIPE)
    for i in range(n):
        v = lv[i]
        glow = v > 0.22
        if photo:
            # 입은 빨리 벌리고 천천히 닫음
            target = 0.0 if v < 0.12 else min(1.0, (v - 0.12) / 0.75)
            smooth += (target - smooth) * (0.75 if target > smooth else 0.4)
            p.stdin.write(compose(pf.frame(i, fps, smooth).convert("RGBA"), glow))
            continue
        want = 0 if v < 0.22 else (1 if v < 0.6 else 2)
        if hold > 0 and want != state:
            hold -= 1
        else:
            if want != state:
                hold = 1          # 최소 2프레임 유지 → 덜 깜빡거림
            state = want
        if i >= next_blink:
            blink_left, next_blink = 3, i + int(fps * rnd.uniform(2.5, 5.0))
        blink = blink_left > 0
        blink_left -= 1
        key = (state, blink, glow)
        if key not in cache:
            cache[key] = compose(faces[("blink" if blink else "mouth", state)], glow)
        p.stdin.write(cache[key])
    p.stdin.close()
    p.wait()
    return out, x - pad, y - pad


# ───────────────────────────── 합치기 ─────────────────────────────

def ass_filter(ass_name, brand):
    fd = brand["_fontdir"]
    return f"ass={ass_name}" + (f":fontsdir='{str(fd)}'" if fd else "")


def logo_overlay(brand, W, H, idx, scale=1.0):
    lg = brand["logo"]
    w, m = int(lg["width"] * scale), int(lg["margin"] * scale)
    pos = {"top-left": (f"{m}", f"{m}"), "top-right": (f"W-w-{m}", f"{m}"),
           "bottom-left": (f"{m}", f"H-h-{m}-12"), "bottom-right": (f"W-w-{m}", f"H-h-{m}-12")}
    x, y = pos.get(lg["position"], pos["top-right"])
    return (f"[{idx}:v]scale={w}:-1,format=rgba,colorchannelmixer=aa={lg['opacity']}[lg];"
            f"[v0][lg]overlay={x}:{y}[v1]")


def burn(clean, mix, ass_name, brand, W, H, out, enc, work, scale=1.0, presenter=None):
    inputs = ["-i", clean, "-i", mix]
    fc = "[0:v]null[v0];"
    last = "v0"
    if brand["_logo"]:
        inputs += ["-i", brand["_logo"]]
        fc += logo_overlay(brand, W, H, 2, scale) + ";"
        last = "v1"
    if presenter:
        mov, px, py = presenter
        inputs += ["-i", str(mov)]
        fc += f"[{last}][{len(inputs) // 2 - 1}:v]overlay={px}:{py}:eof_action=pass[vp];"
        last = "vp"
    fc += f"[{last}]{ass_filter(ass_name, brand)}[v]"
    ffmpeg(*inputs, "-filter_complex", fc, "-map", "[v]", "-map", "1:a", *enc,
           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out, cwd=work)


def add_intro_outro(body, brand, W, H, fps, out, enc, work):
    parts = [p for p in (brand["_intro"], body, brand["_outro"]) if p]
    if len(parts) == 1:
        shutil.move(str(body), out)
        return
    inputs, fc, cat = [], [], ""
    bg = brand["colors"]["background"].lstrip("#")
    for i, p in enumerate(parts):
        inputs += ["-i", str(p)]
    k = len(parts)
    for i, p in enumerate(parts):
        fc.append(f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:"
                  f"color=0x{bg},fps={fps},setsar=1,format=yuv420p[v{i}]")
        if has_audio(p):
            fc.append(f"[{i}:a]aresample={SR},aformat=channel_layouts=stereo[a{i}]")
        else:
            inputs += ["-f", "lavfi", "-t", f"{probe_duration(p):.3f}", "-i", f"anullsrc=r={SR}:cl=stereo"]
            fc.append(f"[{k}:a]anull[a{i}]")
            k += 1
        cat += f"[v{i}][a{i}]"
    fc.append(f"{cat}concat=n={len(parts)}:v=1:a=1[v][a]")
    ffmpeg(*inputs, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", *enc,
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out)


def make_shorts(segs, clean, mix, brand, title, work, out, enc, fps, fast):
    sh = brand["shorts"]
    W, H = (540, 960) if fast else (int(sh["width"]), int(sh["height"]))
    picks = [s for s in segs if "하이라이트" in s.tags]
    if not picks:
        log("  [하이라이트] 표시된 구간이 없어 쇼츠를 건너뜁니다")
        return None
    # 이어진 구간끼리 묶기
    ranges = []
    for s in picks:
        if ranges and abs(ranges[-1][1] - s.out_start) < 1e-3:
            ranges[-1][1] = s.out_start + s.out_len
            ranges[-1][2].append(s)
        else:
            ranges.append([s.out_start, s.out_start + s.out_len, [s]])
    length = sum(b - a for a, b, _ in ranges)
    if length > sh["max_seconds"]:
        log(f"  ! 쇼츠가 {length:.0f}초로 {sh['max_seconds']}초를 넘습니다. 하이라이트를 줄여보세요.")

    # 쇼츠 기준 시간으로 다시 계산
    shifted, offset = [], 0.0
    import copy
    for a, b, ss in ranges:
        for s in ss:
            t = copy.copy(s)
            t.out_start = s.out_start - a + offset
            shifted.append(t)
        offset += b - a
    caps = caption_events(shifted, brand, int(sh["max_chars"]))
    chapters = []
    write_ass(work / "shorts.ass", brand, W, H, length, caps, title, chapters,
              int(sh["subtitle_size"] * W / 1080), vertical=True)

    fc = []
    for i, (a, b, _) in enumerate(ranges):
        fc.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}]")
        fc.append(f"[1:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[a{i}]")
    n = len(ranges)
    fc.append("".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[cv][ca]")
    fg_h = int(W * 9 / 16)
    fc.append(f"[cv]split[s1][s2];[s1]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
              f"boxblur=24:2,eq=brightness=-0.15[bgv];[s2]scale={W}:{fg_h}[fg];"
              f"[bgv][fg]overlay=0:(H-h)/2-{int(H * 0.04)}[v0]")
    inputs = ["-i", clean, "-i", mix]
    last = "v0"
    if brand["_logo"]:
        inputs += ["-i", brand["_logo"]]
        fc.append(logo_overlay(brand, W, H, 2, W / 1920 * 1.6))
        last = "v1"
    if brand["_presenter_dir"]:
        mov, px, py = render_presenter(shifted, length, brand, work, W, H, fps, True, "presenter_shorts")
        inputs += ["-i", mov.name]
        fc.append(f"[{last}][{len(inputs) // 2 - 1}:v]overlay={px}:{py}:eof_action=pass[vp]")
        last = "vp"
    fc.append(f"[{last}]{ass_filter('shorts.ass', brand)}[v]")
    ffmpeg(*inputs, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[ca]", *enc,
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out, cwd=work)
    return out, length


# ───────────────────────────── 메인 ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="차트분석 영상 자동 편집 (TTS·컷·자막·음악·효과음·브랜딩)")
    ap.add_argument("video", help="녹화한 차트 화면 영상")
    ap.add_argument("script", help="대본 텍스트 파일")
    ap.add_argument("--brand", default=None, help="브랜딩 설정 (기본: studio/brand.yaml)")
    ap.add_argument("--out", default=None, help="결과 폴더 (기본: 대본과 같은 폴더의 out/)")
    ap.add_argument("--shorts", action="store_true", help="[하이라이트] 구간으로 세로 쇼츠도 만들기")
    ap.add_argument("--preview", action="store_true", help="빠른 저화질 미리보기 (640x360)")
    ap.add_argument("--list-voices", action="store_true", help="ElevenLabs 에서 쓸 수 있는 목소리 목록")
    ap.add_argument("--voice", default=None, help="이번만 다른 목소리 (예: ko-KR-SunHiNeural, test)")
    if "--list-voices" in sys.argv:
        list_eleven_voices()
        return
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg 가 없습니다. 맥:  brew install ffmpeg")
    src, script = Path(a.video).resolve(), Path(a.script).resolve()
    for p in (src, script):
        if not p.exists():
            sys.exit(f"파일이 없습니다: {p}")

    brand = load_brand(a.brand or (HERE / "brand.yaml"))
    if a.voice:
        if a.voice == "test":
            brand["voice"]["engine"] = "test"
        else:
            brand["voice"]["name"] = a.voice
    v = brand["video"]
    W, H, fps = int(v["width"]), int(v["height"]), int(v["fps"])
    if a.preview:
        pw = 640 if W >= H else 360
        W, H = pw, round(pw * H / W / 2) * 2
    vertical = H > W   # 세로(쇼츠) 영상: 쇼츠용 자막 크기·배치 사용
    enc = ["-c:v", "libx264", "-preset", "ultrafast" if a.preview else v["preset"],
           "-crf", str(28 if a.preview else v["crf"]), "-pix_fmt", "yuv420p"]

    name = script.stem + ("_미리보기" if a.preview else "")
    outdir = Path(a.out).resolve() if a.out else script.parent / "out"
    work = outdir / f"{script.stem}_작업"
    outdir.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    log(f"1/6 대본 읽기: {script.name}")
    title, events = parse_script(script)
    video_dur = probe_duration(src)
    segs = build_segments(events, video_dur)
    if not segs:
        sys.exit("대본에서 구간을 찾지 못했습니다")

    log(f"2/6 TTS 내레이션 ({brand['voice']['engine']}: {brand['voice']['name']})")
    for i, s in enumerate(segs):
        if s.spoken:
            synthesize(s, brand, work)
            log(f"  {i + 1}/{len(segs)}  {s.tts_dur:4.1f}초  {s.spoken[:40]}")

    total = plan_timeline(segs, brand, fps)
    log(f"3/6 컷편집: 원본 {yt_time(video_dur)} → {yt_time(total)} ({total:.1f}초)")
    clean = render_segments(segs, src, brand, work, W, H, fps, a.preview)

    log("4/6 내레이션 + 배경음악 + 효과음 믹싱")
    mix = build_audio(segs, total, brand, work, seed=script.stem)

    log("5/6 자막·로고·제목·진행바 입히기")
    if vertical:
        sub_size = int(brand["shorts"]["subtitle_size"] * W / 1080)
        caps = caption_events(segs, brand, int(brand["shorts"]["max_chars"]))
    else:
        sub_size = int(brand["subtitle"]["size"] * H / 1080)
        caps = caption_events(segs, brand, int(brand["subtitle"]["max_chars"]))
    chapters = [(s.out_start, s.tags["챕터"]) for s in segs if s.tags.get("챕터")]
    write_ass(work / "main.ass", brand, W, H, total, caps, title, chapters, sub_size, vertical=vertical)
    presenter = None
    if brand["_presenter_dir"]:
        log(f"  진행자 {brand['presenter']['name']} 화면 만들기")
        presenter = render_presenter(segs, total, brand, work, W, H, fps, vertical, "presenter")
    body = work / "body.mp4"
    burn(clean.name, mix.name, "main.ass", brand, W, H, body.name, enc, work, presenter=presenter,
         scale=W / 1080 if vertical else W / 1920)

    log("6/6 인트로/아웃트로 붙이기 · 내보내기")
    final = outdir / f"{name}.mp4"
    add_intro_outro(body, brand, W, H, fps, final, enc, work)

    # 업로드용 부가 파일
    intro_len = probe_duration(brand["_intro"]) if brand["_intro"] else 0.0
    write_srt(outdir / f"{name}.srt", [(x[0] + intro_len, x[1] + intro_len, *x[2:]) for x in caps])
    desc = [title or script.stem, ""]
    if chapters:
        ch = [(0.0, "인트로")] if intro_len > 0 or chapters[0][0] > 0 else []
        ch += [(t + intro_len, n) for t, n in chapters]
        desc += [f"{yt_time(t)} {n}" for t, n in ch] + [""]
    if brand["channel"].get("disclaimer"):
        desc.append(brand["channel"]["disclaimer"])
    (outdir / f"{name}_설명.txt").write_text("\n".join(desc) + "\n", encoding="utf-8")

    log(f"\n완성: {final}  ({probe_duration(final):.1f}초)")
    log(f"자막 파일: {outdir / (name + '.srt')}  · 설명/챕터: {outdir / (name + '_설명.txt')}")

    if a.shorts:
        log("\n쇼츠 만들기 ([하이라이트] 구간)")
        r = make_shorts(segs, clean.name, mix.name, brand, title, work,
                        f"{name}_쇼츠.mp4", enc, fps, a.preview)
        if r:
            log(f"쇼츠: {outdir / (name + '_쇼츠.mp4')}  ({r[1]:.1f}초)")
            shutil.move(str(work / r[0]), outdir / r[0])


if __name__ == "__main__":
    main()
