"""Genera el sprite cenital del CUERPO de la mosca con la API de OpenAI.

Solo el cuerpo (cabeza, ojos, torax, abdomen, alas). SIN patas: las seis patas
las dibuja el render con las motoneuronas reales del cordon nervioso ventral.

Lee la clave de ~/fly-arena/.env.openai. Nunca la imprime, ni en los errores.
"""
import os, sys, json, base64, io, re, ssl, certifi, urllib.request, urllib.error

CTX = ssl.create_default_context(cafile=certifi.where())
ENV = os.path.expanduser('~/fly-arena/.env.openai')
OUT = os.path.expanduser('~/fly-arena/assets')
URL = 'https://api.openai.com/v1/images/generations'

PROMPT = (
    "Scientific macro photograph of a single Drosophila melanogaster fruit fly, "
    "STRICT TOP-DOWN DORSAL VIEW looking straight down at the fly from directly above, "
    "perfectly bilaterally symmetrical, the head pointing straight up toward the top of the frame. "
    "Visible anatomy: the head with two large deep-red compound eyes, the tan bristled thorax, "
    "the banded dark abdomen tapering to a point, and the two translucent veined wings folded "
    "back over the abdomen in a narrow V. "
    "CRITICAL: the fly has NO LEGS in this image. Do not draw legs, do not draw any limbs, "
    "tarsi or appendages of any kind extending from the thorax. Body only. "
    "Flat even diffuse lighting, no cast shadow, no reflection, no depth of field, everything in focus. "
    "The fly is centered and fills most of the frame."
)


def leer_clave():
    if not os.path.exists(ENV):
        sys.exit(f'ERROR: no existe {ENV}')
    for ln in open(ENV):
        m = re.match(r'\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+)', ln)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    sys.exit(f'ERROR: no encuentro OPENAI_API_KEY en {ENV}')


def generar(key, fondo='transparent', size='1024x1024'):
    p = {'model': 'gpt-image-1', 'prompt': PROMPT, 'n': 1, 'size': size,
         'output_format': 'png', 'background': fondo, 'quality': 'high'}
    req = urllib.request.Request(URL, headers={
        'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.urlopen(req, json.dumps(p).encode(), timeout=300, context=CTX) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode()[:500]
        # la clave nunca aparece: solo devolvemos el cuerpo del error de la API
        sys.exit(f'ERROR HTTP {e.code}: {cuerpo}')
    return base64.b64decode(d['data'][0]['b64_json'])


def recortar(png_bytes, path_out):
    """Recorta al contenido. Si no hay alfa, quita el fondo claro/verde."""
    from PIL import Image
    import numpy as np
    im = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
    a = np.array(im)
    if a[..., 3].min() == 255:                       # vino opaco: keying de rescate
        r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
        fondo = ((g - r > 40) & (g - b > 40)) | ((r > 235) & (g > 235) & (b > 235))
        a[..., 3] = np.where(fondo, 0, 255)
    im2 = Image.fromarray(a)
    bbox = im2.split()[3].getbbox()
    if bbox: im2 = im2.crop(bbox)
    im2.save(path_out)
    return im2.size


if __name__ == '__main__':
    key = leer_clave()
    os.makedirs(OUT, exist_ok=True)
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    for i in range(n):
        print(f'[{i+1}/{n}] generando con gpt-image-1 (fondo transparente)...', flush=True)
        png = generar(key)
        raw = f'{OUT}/fly_raw_{i}.png'; fin = f'{OUT}/fly_body_{i}.png'
        open(raw, 'wb').write(png)
        size = recortar(png, fin)
        print(f'    -> {fin}  {size[0]}x{size[1]}', flush=True)
    print('[ok]')
