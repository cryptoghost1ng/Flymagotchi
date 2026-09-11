// Drawing and animation of the fly.
//
// Everything that moves comes from `state`, fed by the circuit readouts:
// walk = leg motor neurons, eat = MN9, fly = wing motor neurons and TTMn.
// Nothing is decided here: it only draws what they say.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// Six legs. Tripod A = front-left + mid-right + hind-left.
// That is the real insect gait: three feet planted, three swinging, alternating.
const PATAS = [
  { id: 'flL', side: -1, tri: 0, anchor: [-0.30, 0.34], aep: [-0.92, 0.86], pep: [-0.74, 0.24] },
  { id: 'mlL', side: -1, tri: 1, anchor: [-0.34, 0.04], aep: [-1.06, 0.26], pep: [-1.00, -0.42] },
  { id: 'hlL', side: -1, tri: 0, anchor: [-0.30, -0.22], aep: [-0.96, -0.40], pep: [-0.72, -1.04] },
  { id: 'flR', side: 1, tri: 1, anchor: [0.30, 0.34], aep: [0.92, 0.86], pep: [0.74, 0.24] },
  { id: 'mlR', side: 1, tri: 0, anchor: [0.34, 0.04], aep: [1.06, 0.26], pep: [1.00, -0.42] },
  { id: 'hlR', side: 1, tri: 1, anchor: [0.30, -0.22], aep: [0.96, -0.40], pep: [0.72, -1.04] },
];

export class Fly {
  constructor(sprites = {}) {
    this.sp = sprites;                 // { body, wing }
    this.gaitPhase = 0;                     // gait phase
    this.beatPhase = 0;                    // wingbeat phase
    this.proboscis = 0;                     // proboscis extended (0..1)
    this.z = 0;                        // flight altitude (0..1)
    this.wingsOpen = 0;                     // wings unfolded (0..1)
    this.groom = 0;                     // grooming (0..1)
    this.groomT = 0;
    this.glint = 0;                   // eye glint
    this.bank = 0;                    // bank angle when turning
    this.flick = 0;                   // wing flick amount (0..1)
    this.flickT = 0;                  // ms until the next flick
    this.wasStill = true;             // was it stopped on the previous frame
  }

  // dt in ms. state: {walk, eat, fly, turn}
  // A missing key used to turn the whole state into NaN and silently stop the
  // legs and the wings from being drawn at all. Now it just reads as zero.
  update(dt, state) {
    const e = {
      walk: +state.walk || 0, eat: +state.eat || 0,
      fly: +state.fly || 0, turn: +state.turn || 0,
    };
    const k = dt / 16.7;
    const ease = (v, o, r) => v + (o - v) * clamp(r * k, 0, 1);

    this.z = ease(this.z, e.fly, 0.10);
    this.wingsOpen = ease(this.wingsOpen, Math.max(e.fly, this.z > 0.02 ? 1 : 0), 0.16);
    this.proboscis = ease(this.proboscis, e.eat, e.eat > this.proboscis ? 0.30 : 0.09);
    this.bank = ease(this.bank, clamp((e.turn || 0) * 9, -0.5, 0.5), 0.12);

    // the gait advances with leg push; it stops while flying or eating
    const walking = e.walk * (1 - this.z) * (1 - this.proboscis * 0.8);
    this.gaitPhase = (this.gaitPhase + walking * 0.40 * k) % TAU;

    // wingbeat: really ~200 Hz, impossible to draw; shown as motion blur
    this.beatPhase = (this.beatPhase + (0.45 + 0.35 * this.z) * k) % TAU;

    // grooming: only when idle, like a real fly
    const busy = e.walk > 0.15 || e.eat > 0.05 || this.z > 0.02;
    this.groomT = busy ? 0 : this.groomT + dt;
    const wants = !busy && this.groomT > 2200 && (Math.sin(this.groomT / 900) > 0.25);
    this.groom = ease(this.groom, wants ? 1 : 0, 0.07);
    this.glint = (this.glint + 0.012 * k) % TAU;

    // wing flick: short, sporadic, only while idle
    this.flickT -= dt;
    if (this.flickT <= 0 && this.wingsOpen < 0.15) {
      this.flickT = 1100 + Math.random() * 3000;
      this.flick = 1;
    }
    this.flick = ease(this.flick, 0, 0.10);
    // flies buzz their wings for a moment when they start moving
    if (e.walk > 0.5 && this.wasStill) this.flick = 1;
    this.wasStill = e.walk < 0.1;
  }

  // S = half body size in pixels. The origin is the centre of the thorax.
  draw(ctx, S) {
    const z = this.z, scale = 1 + 0.30 * z;
    ctx.save();
    if (this.bank) ctx.rotate(this.bank * 0.25);
    ctx.scale(scale, scale);

    if (z > 0.03) this._sombra(ctx, S, z);
    this._patas(ctx, S);
    this._body(ctx, S);
    this._proboscis(ctx, S);
    this._wings(ctx, S, true);          // izquierda
    this._wings(ctx, S, false);         // derecha
    this._eyes(ctx, S);
    ctx.restore();
  }

  _sombra(ctx, S, z) {
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - z * 0.5);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, S * 0.34 * z * 2.4, S * 0.52 * (1 - z * 0.25), S * 0.30 * (1 - z * 0.25), 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _patas(ctx, S) {
    const tucked = this.z;                       // tucked in while flying
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of PATAS) {
      // tripod: half the legs are planted while the other half swing
      const f = (this.gaitPhase + (p.tri ? Math.PI : 0)) % TAU;
      const stance = f < Math.PI;                    // planted for half the phase
      const u = stance ? f / Math.PI : (f - Math.PI) / Math.PI;
      // stance: the foot goes front to back (it pushes). Swing: it snaps forward.
      const t = stance ? u : 1 - u;
      let px = lerp(p.aep[0], p.pep[0], t);
      let py = lerp(p.aep[1], p.pep[1], t);
      const lift = stance ? 0 : Math.sin(u * Math.PI);   // lift the foot on the way back
      // grooming: the front legs rub against the head
      if (this.groom > 0.05 && Math.abs(p.anchor[1] - 0.34) < 0.01) {
        const r = Math.sin(this.groomT / 90) * 0.16;
        px = lerp(px, p.side * 0.30 + r, this.groom);
        py = lerp(py, 0.72 + Math.abs(r), this.groom);
      }
      if (tucked > 0.02) {                        // tucked in while flying
        px = lerp(px, p.anchor[0] * 1.55, tucked);
        py = lerp(py, p.anchor[1] * 0.5 - 0.52, tucked);
      }
      const ax = p.anchor[0] * S, ay = -p.anchor[1] * S;
      const fx = px * S, fy = -(py + lift * 0.10) * S;
      // knee: out and up, the way an insect's is
      const mx = (ax + fx) / 2 + p.side * 0.26 * S;
      const my = (ay + fy) / 2 - 0.20 * S - lift * 0.10 * S;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(mx, my);
      ctx.lineTo(fx, fy);
      ctx.strokeStyle = stance ? 'rgba(58,42,26,.95)' : 'rgba(84,64,42,.78)';
      ctx.lineWidth = Math.max(1.8, S * 0.080);
      ctx.stroke();
      // tarsus: the little foot
      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(0.8, S * 0.030), 0, TAU);
      ctx.fillStyle = 'rgba(40,28,16,.9)'; ctx.fill();
    }
    ctx.restore();
  }

  _wings(ctx, S, back) {
    // The sprite has its BASE at the bottom and the tip at the top. It is anchored
    // by the base on the thorax and opens backwards, hence the PI rotation.
    const wing = this.sp.wing;
    const side = back ? -1 : 1;                 // left behind, right in front
    const open = this.wingsOpen;
    const rest = 0.13;                          // folded flat along the abdomen
    const mid = 0.68;                           // swept out, but never past the head
    const sweep = Math.sin(this.beatPhase) * 0.32;
    // even at rest a fly twitches its wings: a slow tremor plus the odd flick
    const idle = Math.sin(this.beatPhase * 0.11) * 0.05 + this.flick * 0.55;
    const ang = side * (lerp(rest, mid, open) + sweep * open + idle * (1 - open));
    const copies = open > 0.35 ? 3 : 1;        // blur: they beat at ~200 Hz
    const h = S * 1.62, w = h * 0.32;           // real wings reach past the abdomen
    ctx.save();
    ctx.translate(side * S * 0.13, -S * 0.10);    // hinge on the rear thorax
    for (let c = 0; c < copies; c++) {
      const d = (c - (copies - 1) / 2) * 0.30 * open * side;
      ctx.save();
      ctx.rotate(Math.PI - (ang + d));            // PI: base at origin, tip pointing back
      ctx.globalAlpha = (copies === 1 ? lerp(0.34, 0.58, open) : 0.22) * (back ? 0.9 : 1);
      if (wing?.complete && wing.naturalWidth) ctx.drawImage(wing, -w / 2, -h, w, h);
      else { ctx.fillStyle = '#c9d6ea'; ctx.beginPath();
             ctx.ellipse(0, -h / 2, w * 0.5, h * 0.5, 0, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    ctx.restore();
  }

  _body(ctx, S) {
    const im = this.sp.body;
    if (im?.complete && im.naturalWidth) {
      const h = S * 2.25, w = h * im.width / im.height;
      ctx.drawImage(im, -w / 2, -h * 0.52, w, h);
    } else {
      ctx.fillStyle = '#3b465f';
      ctx.beginPath(); ctx.ellipse(0, S * 0.42, S * 0.42, S * 0.68, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -S * 0.16, S * 0.40, S * 0.44, 0, 0, TAU); ctx.fill();
    }
  }

  _proboscis(ctx, S) {
    if (this.proboscis < 0.02) return;
    const L = this.proboscis * 0.62 * S, y0 = -S * 0.78;
    ctx.save();
    ctx.strokeStyle = 'rgba(198,132,64,.95)';
    ctx.lineWidth = Math.max(1.8, S * 0.10); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(0, y0 - L); ctx.stroke();
    // labellum: the two lobes it sucks with
    const r = S * 0.085 * (0.7 + 0.6 * this.proboscis);
    ctx.fillStyle = 'rgba(226,166,96,.95)';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(sx * r * 0.75, y0 - L, r, r * 0.78, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _eyes(ctx, S) {
    // a fly's eyes do not move; what changes is the glint
    const b = 0.45 + 0.25 * Math.sin(this.glint);
    ctx.save();
    ctx.globalAlpha = b;
    ctx.fillStyle = '#fff';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * S * 0.30, -S * 0.66, S * 0.075, S * 0.055, sx * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// The sugar drop that falls when you feed it from the panel.
export class SugarDrop {
  constructor(W, H, img) {
    this.x = W / 2; this.y = -20; this.alive = true;
    this.target = H * 0.50 - 54; this.img = img; this.r = 15; this.pulse = 0;
  }
  paso(ctx) {
    if (!this.alive) {                       // already landed: pulses slowly
      this.pulse += 0.06; this._pintar(ctx, 1 + 0.05 * Math.sin(this.pulse)); return false;
    }
    this.y += Math.max(1.8, (this.target - this.y) * 0.13);
    this._pintar(ctx, 1);
    if (this.y >= this.target - 1) this.alive = false;
    return true;
  }
  _pintar(ctx, k) {
    const r = this.r * k;
    if (this.img?.complete && this.img.naturalWidth) {
      const w = r * 2.2, h = w * this.img.height / this.img.width;
      ctx.drawImage(this.img, this.x - w / 2, this.y - h / 2, w, h);
    } else {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.55, 0, TAU); ctx.fill();
    }
  }
}
