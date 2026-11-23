# -*- coding: utf-8 -*-
"""Finalise la PWA après le build Vite.

Remplit les URLs publiques, les liens d'écran de lancement iOS, le sitemap,
robots.txt et le fichier d'association des ressources numériques pour l'APK.
"""
import json
import os
import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DIST = RACINE / "frontend" / "dist"
SOURCE = RACINE / "frontend" / "dist" / "index.html"

# (largeur, hauteur, largeur CSS, hauteur CSS, densité, famille)
ECRANS = [
    (640, 960, 320, 480, 2, "iphone"),
    (640, 1136, 320, 568, 2, "iphone"),
    (750, 1334, 375, 667, 2, "iphone"),
    (1242, 2208, 414, 736, 3, "iphone"),
    (1125, 2436, 375, 812, 3, "iphone"),
    (1242, 2688, 414, 896, 3, "iphone"),
    (828, 1792, 414, 896, 2, "iphone"),
    (1170, 2532, 390, 844, 3, "iphone"),
    (1284, 2778, 428, 926, 3, "iphone"),
    (1179, 2556, 393, 852, 3, "iphone"),
    (1290, 2796, 430, 932, 3, "iphone"),
    (768, 1024, 768, 1024, 1, "ipad"),
    (1536, 2048, 768, 1024, 2, "ipad"),
    (1668, 2224, 834, 1112, 2, "ipad"),
    (1668, 2388, 834, 1194, 2, "ipad"),
    (2048, 2732, 1024, 1366, 2, "ipad"),
    (1620, 2160, 810, 1080, 2, "ipad"),
    (1640, 2360, 820, 1180, 2, "ipad"),
    (2064, 2752, 1032, 1376, 2, "ipad"),
]


def url_publique():
    for ligne in (RACINE / ".env").read_text(encoding="utf-8").splitlines() if (RACINE / ".env").exists() else []:
        if ligne.startswith("MBOA_PUBLIC_URL="):
            v = ligne.split("=", 1)[1].strip().strip('"').strip("'")
            if v:
                return v.rstrip("/")
    return os.environ.get("MBOA_PUBLIC_URL", "https://mboapilot.cm").rstrip("/")


def liens_startup():
    sortie = []
    for l, h, cw, ch, dens, famille in ECRANS:
        media = (
            f'(device-width: {cw}px) and (device-height: {ch}px) and '
            f'(-webkit-device-pixel-ratio: {dens}) and (orientation: portrait)'
        )
        sortie.append(
            f'    <link rel="apple-touch-startup-image" '
            f'href="/splash/{famille}-{l}x{h}.png" media="{media}" />'
        )
    return "\n".join(sortie)


def principal():
    public = url_publique()
    html = SOURCE.read_text(encoding="utf-8")
    html = html.replace("__PUBLIC_URL__", public)
    html = html.replace("<!-- STARTUP_LINKS -->", liens_startup())
    (DIST / "index.html").write_text(html, encoding="utf-8")

    pages = [
        ("", "1.0", "weekly"), ("/fonctionnalites", "0.8", "monthly"),
        ("/tarifs", "0.6", "monthly"), ("/securite", "0.6", "monthly"),
        ("/partenaires", "0.7", "monthly"), ("/contact", "0.5", "monthly"),
    ]
    urls = "\n".join(
        f'  <url><loc>{public}{p}</loc><changefreq>{f}</changefreq><priority>{pr}</priority></url>'
        for p, pr, f in pages
    )
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + urls + "\n</urlset>\n"
    )
    (DIST / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    (RACINE / "sitemap.xml").write_text(sitemap, encoding="utf-8")

    robots = (
        "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\n"
        "Disallow: /partenaires/espace\nDisallow: /partenaires/connexion\n"
        "Disallow: /partenaires/suivi\nDisallow: /media/\n"
        f"Sitemap: {public}/sitemap.xml\n"
    )
    (DIST / "robots.txt").write_text(robots, encoding="utf-8")
    (RACINE / "robots.txt").write_text(robots, encoding="utf-8")

    empreinte = os.environ.get("SHA256_CERTIFICAT", "A_REMPLACER_PAR_L_EMPREINTE_SHA256_DU_CERTIFICAT")
    association = [{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "cm.mboapilot.app",
            "sha256_cert_fingerprints": [empreinte],
        },
    }]
    dossier = DIST / ".well-known"
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "assetlinks.json").write_text(
        json.dumps(association, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("PWA finalisée pour", public)
    print("écrans iOS :", len(ECRANS))


if __name__ == "__main__":
    principal()
