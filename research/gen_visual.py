"""Genera visuales de la extension con la API de OpenAI (gpt-image-1).
Uso: gen_visual.py <nombre> [size]   — los prompts viven en PROMPTS.
La clave sale de ~/fly-arena/.env.openai y nunca se imprime.
"""
import os, sys, json, base64, io, re, ssl, certifi, urllib.request, urllib.error

CTX = ssl.create_default_context(cafile=certifi.where())
ENV = os.path.expanduser('~/fly-arena/.env.openai')
OUT = os.path.expanduser('~/fly-arena/extension/assets')
URL = 'https://api.openai.com/v1/images/generations'

PROMPTS = {
 'cuerpo': (
   "Scientific macro photograph of a Drosophila melanogaster fruit fly, STRICT TOP-DOWN "
   "DORSAL VIEW from directly above, perfectly bilaterally symmetrical, head pointing straight "
   "up. Show ONLY the head with two large deep-red compound eyes, the tan bristled thorax, and "
   "the banded dark abdomen tapering to a point. CRITICAL: NO WINGS and NO LEGS whatsoever - "
   "the wings and legs must be completely absent, only the bare body. Flat even diffuse "
   "lighting, no cast shadow, everything in focus, centered."),
 'ala': (
   "A SINGLE isolated fruit fly wing, photographed flat from directly above, translucent and "
   "glassy with fine dark branching veins, elongated oval shape, narrow at the base and rounded "
   "at the tip, pointing straight up with the attachment base at the bottom of the frame. "
   "Only the wing: no body, no fly, no insect, no legs, nothing else in the image. "
   "Flat even lighting, no shadow."),

 'azucar': (
   "A single glistening sugar crystal droplet, amber-golden honey colour, translucent, "
   "photorealistic macro, viewed from directly above, roughly round with faceted crystalline "
   "edges catching warm light, a soft inner glow. Centered, filling the frame. "
   "No background, no surface, no shadow, no container, no text. Nothing but the droplet itself."),
 'icono': (
   "App icon. A single fruit fly seen from directly above, stylised and simplified for a small "
   "icon: warm amber-gold body, two bright red compound eyes, translucent wings folded back, "
   "six thin dark legs. Clean flat illustration with soft shading, bold readable silhouette, "
   "strong contrast. Centered on a deep navy-black rounded square background. No text, no letters, "
   "no border, no frame."),
 'promo': (
   "Wide banner illustration for a browser extension. On the left, a single photorealistic fruit "
   "fly seen from directly above, warm amber body, red compound eyes, wings folded back, standing "
   "on a dark surface. On the right, a glowing constellation of hundreds of tiny cyan dots "
   "connected by faint thin lines, like a neural network diagram lighting up, with one dot glowing "
   "gold and larger than the rest. Deep navy-black background, cinematic, moody, soft bloom. "
   "No text, no letters, no words, no logos anywhere in the image."),
}


def clave():
    for ln in open(ENV):
        m = re.match(r'\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+)', ln)
        if m: return m.group(1).strip().strip('"').strip("'")
    sys.exit('ERROR: no encuentro OPENAI_API_KEY')


def generar(key, prompt, size):
    p = {'model': 'gpt-image-1', 'prompt': prompt, 'n': 1, 'size': size,
         'output_format': 'png', 'background': 'transparent', 'quality': 'high'}
    req = urllib.request.Request(URL, headers={
        'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.urlopen(req, json.dumps(p).encode(), timeout=420, context=CTX) as r:
            return base64.b64decode(json.load(r)['data'][0]['b64_json'])
    except urllib.error.HTTPError as e:
        sys.exit(f'ERROR HTTP {e.code}: {e.read().decode()[:400]}')


def recortar(png, path):
    from PIL import Image
    import numpy as np
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    a = np.array(im)
    if a[..., 3].min() == 255:
        r, g, b = (a[..., i].astype(int) for i in range(3))
        a[..., 3] = np.where((r > 240) & (g > 240) & (b > 240), 0, 255)
        im = Image.fromarray(a)
    bb = im.split()[3].getbbox()
    if bb: im = im.crop(bb)
    im.save(path)
    return im.size


if __name__ == '__main__':
    nombre = sys.argv[1]
    size = sys.argv[2] if len(sys.argv) > 2 else '1024x1024'
    os.makedirs(OUT, exist_ok=True)
    png = generar(clave(), PROMPTS[nombre], size)
    dest = f'{OUT}/{nombre}.png'
    s = recortar(png, dest)
    print(f'[ok] {dest}  {s[0]}x{s[1]}')
