import sys
import os

path = '/home/270zw/ytrana/backend'
if path not in sys.path:
    sys.path.append(path)

os.chdir(path)

from a2wsgi import ASGIMiddleware
from main import app

application = ASGIMiddleware(app)
