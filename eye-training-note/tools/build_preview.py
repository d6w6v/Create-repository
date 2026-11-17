"""미리보기용 한 파일 만들기: index.html + style.css + app.js 를 하나로 합친다.
사용법: python3 tools/build_preview.py <출력파일.html>"""
import sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
css = (root / "style.css").read_text(encoding="utf-8")
js = (root / "app.js").read_text(encoding="utf-8")
out = f"""<title>눈 훈련 노트</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
{css}
</style>
<div id="app"></div>
<script>window.EYE_PREVIEW = true;</script>
<script>
{js}
</script>
"""
pathlib.Path(sys.argv[1]).write_text(out, encoding="utf-8")
print("ok", len(out))
