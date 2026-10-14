// The iOS keyboard can shrink and move the visual viewport independently of vh.
export function popupViewportBounds(viewport, windowWidth, windowHeight) {
  return {
    top: Math.max(0, viewport?.offsetTop || 0),
    left: Math.max(0, viewport?.offsetLeft || 0),
    width: viewport?.width > 0 ? viewport.width : windowWidth,
    height: viewport?.height > 0 ? viewport.height : windowHeight,
  };
}

export function installPopupViewport(win = window, doc = document) {
  const viewport = win.visualViewport;
  let frame = 0;
  let focusFrame = 0;
  const root = doc.documentElement;

  const revealFocusedField = () => {
    focusFrame = 0;
    const field = doc.activeElement;
    const modal = field?.closest?.('.overlay .modal');
    if (!modal) return;
    const fieldRect = field.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    const top = modalRect.top + modal.clientTop + 16;
    const bottom = modalRect.top + modal.clientTop + modal.clientHeight - 16;
    if (fieldRect.top < top || fieldRect.height > bottom - top) {
      modal.scrollTop += fieldRect.top - top;
    } else if (fieldRect.bottom > bottom) {
      modal.scrollTop += fieldRect.bottom - bottom;
    }
  };

  const update = () => {
    frame = 0;
    const bounds = popupViewportBounds(viewport, win.innerWidth, win.innerHeight);
    for (const [name, value] of Object.entries(bounds)) {
      root.style.setProperty(`--popup-viewport-${name}`, `${value}px`);
    }
    win.cancelAnimationFrame(focusFrame);
    focusFrame = win.requestAnimationFrame(revealFocusedField);
  };
  const schedule = () => {
    // A newer keyboard/pan event supersedes focus positioning for the old size.
    win.cancelAnimationFrame(focusFrame);
    focusFrame = 0;
    if (!frame) frame = win.requestAnimationFrame(update);
  };

  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  doc.addEventListener('focusin', schedule);
  schedule();

  return () => {
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    doc.removeEventListener('focusin', schedule);
    win.cancelAnimationFrame(frame);
    win.cancelAnimationFrame(focusFrame);
    for (const name of ['top', 'left', 'width', 'height']) {
      root.style.removeProperty(`--popup-viewport-${name}`);
    }
  };
}
