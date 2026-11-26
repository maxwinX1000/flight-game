// Coral Coast Run — keyboard and mouse input.
// One object owns every key and the mouse drag, so the flight model and the
// menus read the same state and no handler is registered twice.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseDown = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this._onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    };
    this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this._onMouseDown = () => { this.mouseDown = true; };
    this._onMouseUp = () => { this.mouseDown = false; };
    this._onMouseMove = (e) => {
      if (!this.mouseDown) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
  }

  down(...names) {
    return names.some((n) => this.keys.has(n));
  }

  // Pitch stick: -1 (pull up) .. +1 (push down). W/S and Up/Down agree.
  pitch() {
    let v = 0;
    if (this.down('w', 'arrowup')) v -= 1;
    if (this.down('s', 'arrowdown')) v += 1;
    return v;
  }

  // Roll stick: -1 (left) .. +1 (right). A/D and Left/Right agree.
  roll() {
    let v = 0;
    if (this.down('a', 'arrowleft')) v -= 1;
    if (this.down('d', 'arrowright')) v += 1;
    return v;
  }

  // Throttle: Shift up, Control down.
  throttle() {
    let v = 0;
    if (this.down('shift')) v += 1;
    if (this.down('control')) v -= 1;
    return v;
  }

  // One-shot keys: true once per press, then cleared by the caller.
  pressed(name) {
    return this.keys.has(name);
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
  }
}
