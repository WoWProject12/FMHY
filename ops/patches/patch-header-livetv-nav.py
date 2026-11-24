from pathlib import Path

p = Path("/var/www/chillflix-lol-toflix/public/new/views/partials/header.php")
text = p.read_text()
if "/iptv" in text and "Live TV" in text:
    print("already has Live TV")
else:
    marker = "href=\"<?= movy_e(movy_url('/browse/tv')) ?>\""
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("tv marker missing")
    end = text.find("</a>", idx)
    if end < 0:
        raise SystemExit("no close")
    end += 4
    insert = """
            <a class="relative z-[1] inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors duration-200 <?= $active('iptv', $nav) ?>" href="<?= movy_e(movy_url('/iptv')) ?>"<?= $nav === 'iptv' ? ' aria-current="page" data-marker-active="true"' : '' ?>>
              <svg aria-hidden="true" class="shrink-0" fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14"><rect height="14" rx="2" width="20" x="2" y="5"></rect><path d="M8 21h8M12 17v4"></path></svg>
              Live TV
            </a>"""
    text = text[:end] + insert + text[end:]
    p.write_text(text)
    print("inserted Live TV nav")
