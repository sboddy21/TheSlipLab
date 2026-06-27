from pathlib import Path
import re

ROOT = Path("website")

NAV_ITEMS = [
    ("Slate", "./mlb.html", {"mlb.html"}),
    ("Full Board", "./full-board.html", {"full-board.html"}),
    ("Matchup Lab", "./matchup-lab.html", {"matchup-lab.html"}),
    ("Power Zones", "./power-zones.html", {"power-zones.html"}),
    ("Quick Target", "./quick-target.html", {"quick-target.html"}),
    ("Heat Check", "./heat-check.html", {"heat-check.html"}),
    ("Streak Lab", "./streak-lab.html", {"streak-lab.html"}),
    ("Weather", "./weather.html", {"weather.html"}),
    ("Results", "./results.html", {"results.html"}),
    ("Decision Center", "./hr-decision-center.html", {"hr-decision-center.html", "decision-center.html"}),
    ("AI Says", "./ai-says.html", {"ai-says.html"}),
    ("Hall of Fame", "./ai-hall-of-fame.html", {"ai-hall-of-fame.html"}),
]

CSS = """
    /* Shared The Slip Lab header */
    .tsl-site-header{
      width:100%;
      background:#050909;
      border-bottom:1px solid rgba(255,255,255,.08);
      position:sticky;
      top:0;
      z-index:99999;
    }
    .tsl-site-header-inner{
      max-width:1800px;
      margin:0 auto;
      padding:14px 22px;
      display:flex;
      align-items:center;
      gap:22px;
      overflow-x:auto;
      scrollbar-width:none;
    }
    .tsl-site-header-inner::-webkit-scrollbar{display:none}
    .tsl-brand{
      color:#f4fff8;
      text-decoration:none;
      font-size:24px;
      font-weight:950;
      letter-spacing:-.03em;
      white-space:nowrap;
      flex:0 0 auto;
    }
    .tsl-nav{
      display:flex;
      align-items:center;
      gap:10px;
      flex-wrap:nowrap;
      white-space:nowrap;
      flex:0 0 auto;
    }
    .tsl-nav a{
      color:#f4fff8;
      text-decoration:none;
      background:#101719;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      padding:10px 17px;
      font-size:14px;
      font-weight:950;
      line-height:1;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.02);
    }
    .tsl-nav a.active{
      background:#7cff24;
      border-color:#7cff24;
      color:#061006;
      box-shadow:0 0 22px rgba(124,255,36,.18);
    }
    body{margin-top:0!important}
    @media(max-width:900px){
      .tsl-site-header-inner{padding:12px 14px;gap:14px}
      .tsl-brand{font-size:20px}
      .tsl-nav a{font-size:12px;padding:9px 12px;border-radius:14px}
    }
"""

def header_for(filename):
    links = []
    for label, href, active_files in NAV_ITEMS:
        cls = ' class="active"' if filename in active_files else ""
        links.append(f'<a{cls} href="{href}">{label}</a>')
    return (
        '<header class="tsl-site-header">\n'
        '  <div class="tsl-site-header-inner">\n'
        '    <a class="tsl-brand" href="./index.html">The Slip Lab</a>\n'
        f'    <nav class="tsl-nav">{"".join(links)}</nav>\n'
        '  </div>\n'
        '</header>'
    )

def remove_old_headers(text):
    text = re.sub(r'\s*<header class="tsl-site-header">[\s\S]*?</header>\s*', '\n', text)

    text = re.sub(
        r'\s*<div class="topbar">\s*<div class="topbar-inner">[\s\S]*?<a class="brand" href="\./index\.html">The Slip Lab</a>[\s\S]*?</nav>\s*</div>\s*</div>\s*',
        '\n',
        text,
        flags=re.I
    )

    text = re.sub(
        r'\s*<div class="topbar">\s*<div class="brand">[\s\S]*?</div>\s*<nav>[\s\S]*?</nav>\s*</div>\s*',
        '\n',
        text,
        flags=re.I
    )

    text = re.sub(
        r'\s*<header>\s*<div class="brand">THE <span>SLIP</span> LAB 🧪</div>[\s\S]*?</header>\s*',
        '\n',
        text,
        flags=re.I
    )

    text = re.sub(
        r'\s*<div class="topbar"><div class="topbar-inner"><a class="brand" href="\./index\.html">The Slip Lab</a>[\s\S]*?</nav></div></div>\s*',
        '\n',
        text,
        flags=re.I
    )

    return text

changed = []

for path in sorted(ROOT.glob("*.html")):
    text = path.read_text()

    text = remove_old_headers(text)

    if "Shared The Slip Lab header" not in text:
        text = text.replace("</style>", CSS + "\n  </style>", 1)

    header = header_for(path.name)

    if "<body" not in text:
        continue

    text = re.sub(r'(<body[^>]*>)', r'\1\n' + header + '\n', text, count=1)

    if text.count('class="tsl-site-header"') != 1:
        raise SystemExit(f"Header count error in {path}: {text.count('class=\"tsl-site-header\"')}")

    path.write_text(text)
    changed.append(str(path))

print("Shared header applied to:")
for f in changed:
    print(" -", f)
