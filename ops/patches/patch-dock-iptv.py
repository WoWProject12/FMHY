from pathlib import Path

p = Path("/var/www/chillflix-lol-toflix/public/new/views/partials/dock.php")
text = p.read_text()
if 'aria-label="Live TV"' in text or "/iptv" in text:
    print("dock already has Live TV")
else:
    marker = """      <a aria-label=\"Shows\" href=\"<?= movy_e(movy_url('/browse/tv')) ?>\" class=\"<?= $itemClass . ($nav === 'tv' ? $activeClass : '') ?>\" title=\"Shows\">
        <span class=\"Dock-module-scss-module__qZDorW__dockIcon\" aria-hidden=\"true\">
          <svg fill=\"none\" height=\"20\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.75\" viewBox=\"0 0 24 24\" width=\"20\"><rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\"></rect><path d=\"M8 21h8\"></path><path d=\"M12 17v4\"></path></svg>
        </span>
        <span class=\"dock-label\">Shows</span>
      </a>"""
    insert = marker + """
      <a aria-label=\"Live TV\" href=\"<?= movy_e(movy_url('/iptv')) ?>\" class=\"<?= $itemClass . ($nav === 'iptv' ? $activeClass : '') ?>\" title=\"Live TV\">
        <span class=\"Dock-module-scss-module__qZDorW__dockIcon\" aria-hidden=\"true\">
          <svg fill=\"none\" height=\"20\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.75\" viewBox=\"0 0 24 24\" width=\"20\"><circle cx=\"12\" cy=\"12\" r=\"3\"></circle><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z\"></path></svg>
        </span>
        <span class=\"dock-label\">Live</span>
      </a>"""
    if marker not in text:
        raise SystemExit("shows marker missing")
    text = text.replace(marker, insert, 1)
    # also update $items array hint
    if "['tv', 'Shows'" in text and "iptv" not in text.split("$items", 1)[-1][:400]:
        text = text.replace(
            "['tv', 'Shows', movy_url('/browse/tv'), false],\n  ['anime', 'Anime', movy_url('/browse/anime'), false],",
            "['tv', 'Shows', movy_url('/browse/tv'), false],\n  ['iptv', 'Live', movy_url('/iptv'), false],\n  ['anime', 'Anime', movy_url('/browse/anime'), false],",
            1,
        )
    p.write_text(text)
    print("inserted Live TV dock item")
