# -*- coding: utf-8 -*-
"""Dérive les icônes et écrans de lancement du tracé officiel logo.svg.

Aucune image n'est inventée : les formes sont celles du SVG du projet, redessinées
à haute résolution puis réduites en LANCZOS pour rester nettes en petit format.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RACINE = Path(__file__).resolve().parent.parent
PUBLIC = RACINE / "frontend" / "public"
ICONS = PUBLIC / "icons"
SPLASH = PUBLIC / "splash"
ICONS.mkdir(parents=True, exist_ok=True)
SPLASH.mkdir(parents=True, exist_ok=True)

FOND = (10, 37, 64)
BLANC = (255, 255, 255)
VIOLET = (99, 91, 255)
CYAN = (0, 212, 255)
SURFACES = (8, 30, 54)


def _font(taille):
    for chemin in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        if Path(chemin).exists():
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


def tracé(taille, masquable=False, fond=True):
    """Redessine le SVG 64x64 à l'échelle demandée."""
    echelle = 8
    t = taille * echelle
    img = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = t / 64.0

    if fond:
        d.rounded_rectangle((0, 0, t - 1, t - 1), radius=15 * k, fill=FOND + (255,))

    # La zone sûre des icônes maskable occupe 80 % de la surface.
    dec = 0.0
    if masquable:
        dec = 6.4 * k
        k *= 0.8

    def P(x, y):
        return (dec + x * k, dec + y * k)

    largeur = max(1, round(4 * k))
    d.line((P(23, 13), P(23, 51)), fill=BLANC + (255,), width=largeur)
    d.line((P(41, 13), P(41, 51)), fill=BLANC + (255,), width=largeur)

    d.rounded_rectangle((*P(17.5, 24), *P(28.5, 39)), radius=2.5 * k, fill=VIOLET + (255,))
    d.rounded_rectangle((*P(35.5, 18), *P(46.5, 33)), radius=2.5 * k, fill=BLANC + (255,))
    d.line((P(14, 52.5), P(50, 52.5)), fill=CYAN + (230,), width=max(1, round(3.5 * k)))

    return img.resize((taille, taille), Image.LANCZOS)


def splash(largeur, hauteur):
    """Écran de lancement : fond travaillé, logo lisible, sans ornement."""
    e = 2
    img = Image.new("RGB", (largeur * e, hauteur * e), FOND)
    d = ImageDraw.Draw(img)
    for y in range(hauteur * e):
        p = y / (hauteur * e)
        c = tuple(int(FOND[i] + (SURFACES[i] - FOND[i]) * p) for i in range(3))
        d.line((0, y, largeur * e, y), fill=c)

    echelle = min(largeur, hauteur) / 390.0
    icone_t = int(88 * echelle * e)
    icone = tracé(icone_t)
    cx, cy = largeur * e // 2, hauteur * e // 2 - int(34 * echelle * e)
    img.paste(icone, (cx - icone_t // 2, cy - icone_t // 2), icone)

    police = _font(int(30 * echelle * e))
    texte = "mboapilot"
    bbox = d.textbbox((0, 0), texte, font=police)
    ty = cy + icone_t // 2 + int(26 * echelle * e)
    d.text((cx - (bbox[2] - bbox[0]) / 2, ty), texte, font=police, fill=BLANC)

    return img.resize((largeur, hauteur), Image.LANCZOS)


TAILLES_ICONS = [72, 96, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512]
TAILLES_MASQUE = [96, 128, 192, 256, 384, 512]

SPLASH_IPHONE = [
    (640, 960), (640, 1136), (750, 1334), (1242, 2208),
    (1125, 2436), (1242, 2688), (828, 1792), (1170, 2532),
    (1284, 2778), (1179, 2556), (1290, 2796),
]
SPLASH_IPAD = [
    (768, 1024), (1536, 2048), (1668, 2224), (1668, 2388),
    (2048, 2732), (1620, 2160), (1640, 2360), (2064, 2752),
]


def main():
    for t in TAILLES_ICONS:
        tracé(t).save(ICONS / f"icon-{t}.png", optimize=True)
    for t in TAILLES_MASQUE:
        tracé(t, masquable=True).save(ICONS / f"maskable-icon-{t}.png", optimize=True)
    for t in (16, 32, 48):
        tracé(t).save(ICONS / f"favicon-{t}.png", optimize=True)
    for l, h in SPLASH_IPHONE:
        splash(l, h).save(SPLASH / f"iphone-{l}x{h}.png", optimize=True)
    for l, h in SPLASH_IPAD:
        splash(l, h).save(SPLASH / f"ipad-{l}x{h}.png", optimize=True)
    print("icônes et écrans générés :", len(TAILLES_ICONS) + len(TAILLES_MASQUE) + 3,
          "icônes,", len(SPLASH_IPHONE) + len(SPLASH_IPAD), "écrans")


if __name__ == "__main__":
    main()
