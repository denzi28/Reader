# One-off: makes the small, renamed font files in public/fonts/ from Carlito and Liberation (SIL OFL 1.1).
# Hinting and layout tables are dropped and only Latin, Greek, Cyrillic and common symbols are kept, so
# each face is ~100 KB, and the PDF library can subset them cleanly. They are renamed because the OFL
# does not let a modified font keep its Reserved Font Name.
#   pip install fonttools && python3 scripts/make-office-fonts.py
import os
from fontTools import subset
from fontTools.ttLib import TTFont

UNICODES = "U+0020-024F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+2713"
SOURCES = {
    "ReaderSans": ("/usr/share/fonts/truetype/crosextra/Carlito-%s.ttf", "Reader Sans"),
    "ReaderSerif": ("/usr/share/fonts/truetype/liberation/LiberationSerif-%s.ttf", "Reader Serif"),
    "ReaderMono": ("/usr/share/fonts/truetype/liberation/LiberationMono-%s.ttf", "Reader Mono"),
}
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "fonts")

for base, (pattern, family) in SOURCES.items():
    for style in ["Regular", "Bold", "Italic", "BoldItalic"]:
        opts = subset.Options()
        opts.layout_features = []
        opts.hinting = False
        opts.notdef_outline = True
        opts.name_IDs = [1, 2, 3, 4, 6]
        font = TTFont(pattern % style)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=subset.parse_unicodes(UNICODES))
        sub.subset(font)
        pretty = {"Regular": "Regular", "Bold": "Bold", "Italic": "Italic", "BoldItalic": "Bold Italic"}[style]
        for rec in list(font["name"].names):
            if rec.nameID == 1: rec.string = family if style in ("Regular", "Bold", "Italic", "BoldItalic") else family
            elif rec.nameID == 2: rec.string = pretty
            elif rec.nameID == 3: rec.string = f"{base}-{style}"
            elif rec.nameID == 4: rec.string = f"{family} {pretty}"
            elif rec.nameID == 6: rec.string = f"{base}-{style}"
        font["name"].names = [r for r in font["name"].names if r.nameID in (1, 2, 3, 4, 6)]
        font.save(os.path.join(OUT, f"{base}-{style}.ttf"))
