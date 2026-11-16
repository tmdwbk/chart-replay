"""사진 1장으로 말하는 얼굴 만들기 (무료, GPU 불필요).

- 얼굴을 찾아 정사각형으로 자르고, 입술 위치를 색으로 찾는다 (설정으로 직접 지정도 가능)
- 입 벌림 정도(0~1)에 따라 아래턱·아랫입술을 부드럽게 내리고, 벌어진 입 안(어두운 공간·윗니)을 그린다
- 프레임마다 숨쉬기·고개 미세 움직임·말할 때 끄덕임을 준다
"""
import math
import numpy as np
import cv2
from PIL import Image

LEVELS = 9   # 입 벌림 단계 수 (미리 만들어 둠)


def _auto_crop(img):
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    h, w = img.shape[:2]
    faces = []
    try:
        det = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        if not det.empty():
            faces = det.detectMultiScale(gray, 1.1, 4, minSize=(30, 30))
    except Exception:
        pass
    if len(faces):
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        side = int(max(fw, fh) * 1.7)
        cx, cy = x + fw / 2, y + fh * 0.52
    else:
        side = min(w, h)
        cx, cy = w / 2, h / 2
    side = min(side, w, h)
    x0 = int(min(max(0, cx - side / 2), w - side))
    y0 = int(min(max(0, cy - side / 2), h - side))
    return x0, y0, side


def _find_mouth(sq):
    """정사각형 얼굴 이미지에서 입술(붉은 영역) 찾기 → (cx, cy, width) 픽셀."""
    R = sq.shape[0]
    lab = cv2.cvtColor(sq, cv2.COLOR_RGB2LAB).astype(np.float32)
    a = lab[:, :, 1]
    y0, y1, x0, x1 = int(R * 0.52), int(R * 0.85), int(R * 0.3), int(R * 0.7)
    roi = a[y0:y1, x0:x1]
    thr = np.percentile(roi, 96)
    m = (roi >= thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab_img, stats, cent = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return R * 0.5, R * 0.68, R * 0.16
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, _ = stats[i]
    return x0 + x + w / 2, y0 + y + h / 2, max(w, R * 0.08)


class PhotoFace:
    def __init__(self, path, size, crop=None, mouth=None, motion=1.0):
        img = np.array(Image.open(path).convert("RGB"))
        x0, y0, side = crop if crop else _auto_crop(img)
        sq = img[y0:y0 + side, x0:x0 + side]
        W = max(512, size * 2)                       # 여유 있게 크게 작업 후 마지막에 줄임
        sq = cv2.resize(sq, (W, W), interpolation=cv2.INTER_LANCZOS4)
        blur = cv2.GaussianBlur(sq, (0, 0), 1.2)
        sq = cv2.addWeighted(sq, 1.35, blur, -0.35, 0)  # 업스케일 후 살짝 선명하게
        self.W, self.size, self.motion = W, size, motion
        if mouth:
            self.mx, self.my, self.mw = mouth[0] * W, mouth[1] * W, mouth[2] * W
        else:
            self.mx, self.my, self.mw = _find_mouth(sq)
        self.base = sq
        self.levels = [self._open(o / (LEVELS - 1)) for o in range(LEVELS)]

    def _open(self, o):
        img = self.base
        if o <= 0:
            return img
        W, mx, my, mw = self.W, self.mx, self.my, self.mw
        d = o * mw * 0.36
        ys, xs = np.mgrid[0:W, 0:W].astype(np.float32)
        # 가로 가중치: 입술선 근처는 입꼬리에서 0 (입꼬리는 고정), 턱 쪽은 더 넓게
        xn = (xs - mx) / (0.5 * mw)
        wl = np.clip(1 - xn ** 2, 0, 1) ** 0.8
        wx = np.exp(-((xs - mx) / (0.9 * mw)) ** 2)
        sblend = np.clip((ys - my) / (0.6 * mw), 0, 1)
        hw = wl * (1 - sblend) + wx * sblend
        below = ys >= my
        wy_lo = np.exp(-(np.maximum(ys - my, 0) / (1.9 * mw)) ** 2)    # 턱 아래로 갈수록 사라짐
        wy_up = np.exp(-(np.maximum(my - ys, 0) / (0.35 * mw)) ** 2)
        dy = np.where(below, d * hw * wy_lo, -0.12 * d * wl * wy_up)
        out = cv2.remap(img, xs, (ys - dy).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        # 벌어진 틈 = 입 안 (틈 모양 그대로)
        top = my - 0.12 * d * wl
        bot = my + d * wl
        inside = ((ys > top + 0.5) & (ys < bot - 0.5) & (np.abs(xn) < 1)).astype(np.float32)
        k = max(3, int(mw * 0.04)) | 1
        mask = cv2.GaussianBlur(inside, (k, k), 0)
        gap = np.maximum(bot - top, 1)
        rel = np.clip((ys - top) / gap, 0, 1)
        cav = np.zeros_like(out, np.float32)
        cav[:] = (52, 16, 22)
        cav = cav * (1 - 0.45 * rel[..., None])                       # 아래로 갈수록 어둡게
        if o > 0.45:                                                   # 윗니
            teeth = (rel < 0.22) & (wl > 0.45)
            cav[teeth] = (205, 198, 195)
        tongue = np.clip(1 - ((xn / 0.75) ** 2 + ((rel - 0.85) / 0.3) ** 2), 0, 1)
        cav = cav * (1 - 0.45 * tongue[..., None]) + np.array((180, 85, 95), np.float32) * 0.45 * tongue[..., None]
        cav = cv2.GaussianBlur(cav, (3, 3), 0)
        out = out.astype(np.float32) * (1 - mask[..., None]) + cav * mask[..., None]
        return np.clip(out, 0, 255).astype(np.uint8)

    def frame(self, i, fps, level):
        """i번째 프레임 얼굴 (RGB PIL, size×size). level: 0~1 입 벌림."""
        img = self.levels[int(round(min(1, max(0, level)) * (LEVELS - 1)))]
        t = i / fps
        mo = self.motion
        ang = mo * (0.8 * math.sin(t * 0.7) + 0.4 * math.sin(t * 1.9 + 1))   # 고개 기울기 (도)
        sc = 1.04 + mo * 0.006 * math.sin(t * 2 * math.pi / 4.2)            # 숨쉬기
        dx = mo * 2.0 * math.sin(t * 0.5)
        dy = mo * (1.5 * math.sin(t * 0.9) + 3.0 * level)                   # 말할 때 살짝 끄덕
        W = self.W
        M = cv2.getRotationMatrix2D((W / 2, W * 0.75), ang, sc)
        M[0, 2] += dx * W / 512
        M[1, 2] += dy * W / 512
        out = cv2.warpAffine(img, M, (W, W), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        out = cv2.resize(out, (self.size, self.size), interpolation=cv2.INTER_AREA)
        return Image.fromarray(out)
