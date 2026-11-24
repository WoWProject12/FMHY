from pathlib import Path

p = Path("/var/www/chillflix-lol-toflix/public/new/index.php")
text = p.read_text()
if "pages/iptv.php" in text:
    print("index already has iptv route")
else:
    needle = "    if ($path === '/help') {\n        require __DIR__ . '/pages/help.php';\n        exit;\n    }"
    insert = """    if ($path === '/iptv' || $path === '/live-tv') {
        require __DIR__ . '/pages/iptv.php';
        exit;
    }

""" + needle
    if needle not in text:
        raise SystemExit("help route marker missing")
    text = text.replace(needle, insert, 1)
    p.write_text(text)
    print("inserted /iptv route")
