import os
import shutil
import jinja2
import markdown
import pathlib
from datetime import datetime
from dataclasses import dataclass


__here__ = pathlib.Path(__file__).resolve().parent


date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')


md = markdown.Markdown(extensions=['meta', "toc", "extra"])


env = jinja2.Environment(loader = jinja2.FileSystemLoader(str(__here__ / "templates")))


if not os.path.isdir(__here__ / "public"):
    os.mkdir(__here__ / "public")


template = env.get_template("index.html")
with open(__here__ / "public" / "index.html", "w") as f:
    f.write(template.render(date=date))


template = env.get_template('style.css')
for d, _, _ in os.walk(__here__ / "public", topdown=False):
    with open(os.path.join(d, "style.css"), 'w') as f:
        f.write(template.render())