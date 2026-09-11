// Overlay core. It uses NO import() and NO Worker: a page's CSP blocks both
// when this runs as a content script. The simulation runs on the main thread
// (20 ms of CPU per 1000 ms simulated: ~2% of one core).
// Depends on FlyCircuit, mutationFromSeed and Fly, which the bundle inlines first.
(async () => {
  if (window.__moscaSuelta) return;
  window.__moscaSuelta = true;

  const url = p => chrome.runtime.getURL(p);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  root.appendChild(cv);
  const ctx = cv.getContext('2d');
  const dim = () => {
    const d = devicePixelRatio || 1;
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  dim(); addEventListener('resize', dim);

  const circuit = await (await fetch(url('data/circuit.json'))).json();

  const { semilla } = await chrome.storage.local.get('semilla');
  const silenced = await mutationFromSeed(semilla || 'demo', circuit.pool, 40);

  const c = new FlyCircuit(circuit, { seed: (Date.now() & 0xffff) || 1 });
  if (silenced.length) c.silence(silenced);
  let drive = 0, mn9Hz = 0, activity = 0;

  const sp = {};
  for (const n of ['body', 'wing']) {
    const i = new Image(); i.src = url(`assets/${n}.png`); sp[n] = i;
  }
  const fly = new Fly(sp);
  let flyAmt = 0, startleT = 0;
  let x = innerWidth * 0.72, y = innerHeight * 0.3, th = -Math.PI / 2;
  let target = newTarget(), pause = 0, S = 46, near = false;
  function newTarget() {
    return { x: 70 + Math.random() * (innerWidth - 140), y: 70 + Math.random() * (innerHeight - 140) };
  }

  let anterior = performance.now(), accMn9 = 0, accMs = 0;
  function loop() {
    const now = performance.now();
    let ms = Math.min(now - anterior, 100);   // if the tab slept, don't pile up time
    anterior = now;

    // The neurons only run while the tab is visible — no point burning CPU on a
    // tab nobody is looking at. Drawing always happens, though: gating the draw
    // too made the fly vanish in any context that reports "hidden" while the
    // user can still see the page.
    if (document.visibilityState === 'visible') {
      const steps = Math.round(ms / c.dt);
      let mn9 = 0, firing = 0;
      for (let s = 0; s < steps; s++) {
        const spk = c.step(drive);
        firing += spk.length;
        for (const i of spk) if (i === c.mn9) mn9++;
      }
      accMn9 += mn9; accMs += ms;
      if (accMs > 250) { mn9Hz = accMn9 / (accMs / 1000); accMn9 = 0; accMs = 0; }
      activity = Math.min(1, firing / Math.max(1, steps) / 3);
    } else {
      ms = 0;                       // freeze the animation, but keep drawing it
    }

    // --- paseo ---
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const speed = pause > 0 ? 0 : 0.35 + activity * 1.6;
    if (pause > 0) pause--;
    const dx = target.x - x, dy = target.y - y;
    if (Math.hypot(dx, dy) < 16) { target = newTarget(); pause = 40 + Math.random() * 120; }
    else {
      const want = Math.atan2(dy, dx);
      const diff = ((want - th + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      th += Math.max(-0.06, Math.min(0.06, diff));
      x += Math.cos(th) * speed; y += Math.sin(th) * speed;
    }
    if (near) {
      ctx.beginPath(); ctx.arc(x, y, S * 1.25, 0, 7);
      ctx.strokeStyle = 'rgba(255,209,102,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // the startle decays on its own; while it lasts, it flies
    if (startleT > 0) { startleT -= ms; flyAmt = Math.min(1, flyAmt + ms / 220); }
    else flyAmt = Math.max(0, flyAmt - ms / 650);
    if (flyAmt > 0.02) { x += Math.cos(th) * flyAmt * 2.6; y += Math.sin(th) * flyAmt * 2.6; }

    fly.update(ms, {
      walk: pause > 0 ? 0 : Math.min(1, 0.25 + activity),
      eat: Math.min(1, mn9Hz / 45),
      fly: flyAmt,
      turn: 0,
    });
    ctx.save();
    ctx.translate(x, y); ctx.rotate(th + Math.PI / 2);
    fly.draw(ctx, S);
    ctx.restore();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  let mx = 0, my = 0, mt = 0;
  addEventListener('mousemove', ev => {
    const d = Math.hypot(ev.clientX - x, ev.clientY - y);
    near = d <= S * 1.6;
    const now = performance.now(), dt = now - mt;
    if (mt && dt > 0 && dt < 120) {
      const prev = Math.hypot(mx - x, my - y);
      const closing = (prev - d) / dt;        // px/ms of approach
      // an object looming at you: that is what triggers the escape response
      if (d < S * 5 && closing > 1.1) { startleT = 900; th += (Math.random() - .5) * 1.2; pause = 0; }
    }
    mx = ev.clientX; my = ev.clientY; mt = now;
  });
  addEventListener('click', ev => {
    if (Math.hypot(ev.clientX - x, ev.clientY - y) > S * 1.3) return;
    drive = circuit.params.r_poi; pause = 160;
    document.dispatchEvent(new CustomEvent('fly:come', { detail: { x, y } }));
    chrome.storage.local.set({ ultima_comida: Date.now() });
    setTimeout(() => {
      drive = 0;
      document.dispatchEvent(new CustomEvent('fly:saciada'));
    }, 2500);
  }, true);

  chrome.runtime.onMessage.addListener(m => {
    if (m === 'recoger') { host.remove(); window.__moscaSuelta = false; }
  });
})();
