(() => {
  const stage = document.getElementById('seam-stage');
  const handle = document.getElementById('seam-handle');
  if (!stage || !handle) return;

  let open = false;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startProgress = 0;
  let progress = 0;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function setProgress(next) {
    progress = clamp(next, 0, 1);
    stage.style.setProperty('--open-progress', progress.toFixed(3));
  }

  function commit(next) {
    open = next;
    document.body.classList.toggle('is-open', open);
    handle.setAttribute('aria-expanded', String(open));
    handle.querySelector('.handle-label').textContent = open ? 'pull to close' : 'pull to open';
    setProgress(open ? 1 : 0);
  }

  function pointerX(event) {
    if ('touches' in event && event.touches.length) return event.touches[0].clientX;
    if ('changedTouches' in event && event.changedTouches.length) return event.changedTouches[0].clientX;
    return event.clientX;
  }

  function onDown(event) {
    dragging = true;
    moved = false;
    startX = pointerX(event);
    startProgress = progress;
    handle.setPointerCapture?.(event.pointerId);
  }

  function onMove(event) {
    if (!dragging) return;
    const delta = pointerX(event) - startX;
    if (Math.abs(delta) > 4) moved = true;
    const width = Math.max(window.innerWidth * 0.22, 160);
    const direction = open ? -1 : 1;
    const next = startProgress + (delta / width) * direction;
    setProgress(next);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    commit(progress > 0.5);
  }

  handle.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  handle.addEventListener('click', (event) => {
    if (moved) {
      event.preventDefault();
      moved = false;
      return;
    }
    commit(!open);
  });

  handle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(!open);
    }
  });

  const urlWantsOpen = window.location.hash === '#open';
  commit(urlWantsOpen);
})();
