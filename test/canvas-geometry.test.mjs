import { build } from 'esbuild';
import EventEmitter from 'eventemitter3';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: `
    export * from './src/dnd/util/geometry';
    export * from './src/dnd/util/hitbox';
    export { DragManager } from './src/dnd/managers/DragManager';
    export { SortManager } from './src/dnd/managers/SortManager';
    export { ScrollManager } from './src/dnd/managers/ScrollManager';
    export { EntityManager } from './src/dnd/managers/EntityManager';
  `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  plugins: [
    {
      name: 'host-boundaries',
      setup(builder) {
        builder.onResolve(
          { filter: /^(obsidian|src\/components\/helpers|src\/components\/Item\/helpers)$/ },
          ({ path }) => ({ path, namespace: 'boundary' })
        );
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({
          contents: `
      export class Notice {}
      export function generateInstanceId() { return 'test-instance'; }
      export function handleDragOrPaste() { throw new Error('Not a persistence test'); }
    `,
        }));
      },
    },
  ],
});
const module = { exports: {} };
new Function(
  'module',
  'exports',
  'require',
  `${result.outputFiles[0].text}\n//# sourceURL=kanban-geometry-test.cjs`
)(module, module.exports, createRequire(import.meta.url));
const g = module.exports;

function host() {
  const frames = new Map();
  let nextFrame = 0;
  const win = {
    scrollX: 0,
    scrollY: 0,
    performance: { now: () => 1000 },
    requestAnimationFrame(fn) {
      const id = ++nextFrame;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout,
    clearTimeout,
    getComputedStyle: (element) => element.css,
    DOMMatrixReadOnly: class {
      constructor(value) {
        const values = value ? value.match(/[-\d.]+/g).map(Number) : [1, 0, 0, 1, 0, 0];
        [this.a, this.b, this.c, this.d] = values;
        this.is2D = true;
      }
    },
  };
  const tick = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn());
  };
  return { win, tick, frames };
}
function element(win, scale = 1, width = 254.667, height = 35.125) {
  const properties = new Map();
  const style = {
    getPropertyValue: (key) => properties.get(key) || '',
    setProperty: (key, value) => properties.set(key, value),
    removeProperty: (key) => properties.delete(key),
  };
  const css = {
    width: `${width}px`,
    height: `${height}px`,
    boxSizing: 'border-box',
    transform: 'none',
    marginLeft: '0px',
    marginTop: '4px',
    marginRight: '0px',
    marginBottom: '0px',
    fontSize: '14px',
    lineHeight: '21px',
    getPropertyValue: () => '1',
  };
  return {
    win,
    css,
    style,
    dataset: {},
    parentElement: null,
    isConnected: true,
    rect: { x: 100, y: 200, left: 100, top: 200, width: width * scale, height: height * scale },
    getBoundingClientRect() {
      return this.rect;
    },
    removeClass() {},
  };
}
function entity(id, box, path = [0]) {
  return {
    entityId: id,
    scopeId: 'board',
    initial: box,
    getHitbox() {
      return this.initial;
    },
    recalcInitial() {},
    getPath: () => path,
    getData: () => ({ type: 'item', accepts: ['item'] }),
  };
}

for (const scale of [0.5, 1, 2]) {
  test(`preview retains fractional border box and pointer anchor at scale ${scale}`, () => {
    const local = { width: 254.667, height: 35.125 };
    const box = [145.25, 87.125, 145.25 + local.width * scale, 87.125 + local.height * scale];
    assert.ok(
      Math.abs(
        g.uniformScale({ width: local.width * scale, height: local.height * scale }, local) - scale
      ) < 1e-9
    );
    const preview = g.previewGeometry(box, { x: 160, y: 90 }, { x: 180, y: 120 }, scale);
    assert.ok(Math.abs(parseFloat(preview.width) * scale - local.width * scale) < 1e-9);
    assert.ok(Math.abs(parseFloat(preview.height) * scale - local.height * scale) < 1e-9);
    assert.equal(preview.transform, `translate3d(165.25px, 117.125px, 0) scale(${scale})`);
  });
  test(`sorting converts screen size and asymmetric CSS margins at scale ${scale}`, () => {
    const dims = g.sortDimensions(
      [10, 20, 10 + 100 * scale, 20 + 35 * scale],
      [1, 4, 2, 3],
      scale,
      scale
    );
    assert.deepEqual(dims, { width: 103, height: 42 });
  });
  test(`cached hitbox follows nested local scroll in screen units at scale ${scale}`, () => {
    const rect = { left: 100, top: 200, width: 200 * scale, height: 35 * scale };
    const initial = g.calculateHitbox(
      rect,
      g.screenShift({ x: 5, y: 10 }, scale),
      g.screenShift({ x: 20, y: 30 }, scale),
      null
    );
    const moved = g.adjustHitbox(
      ...initial,
      g.screenShift({ x: 7, y: 25 }, scale),
      g.screenShift({ x: 24, y: 35 }, scale)
    );
    assert.deepEqual(moved, [
      100 - 6 * scale,
      200 - 20 * scale,
      100 + 194 * scale,
      200 + 15 * scale,
    ]);
  });
}

test('fractional content-box padding/borders are included; invalid scales are rejected', () => {
  assert.deepEqual(
    g.localBorderBox({
      width: '100.25px',
      height: '20.5px',
      boxSizing: 'content-box',
      paddingLeft: '1.5px',
      paddingRight: '2px',
      borderLeftWidth: '.5px',
      borderRightWidth: '.75px',
      paddingTop: '1px',
      paddingBottom: '2px',
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
    }),
    { width: 105, height: 25.5 }
  );
  assert.throws(
    () => g.uniformScale({ width: 0, height: 0 }, { width: 100, height: 20 }),
    /visible/
  );
  assert.throws(
    () => g.uniformScale({ width: 200, height: 20 }, { width: 100, height: 20 }),
    /uniform/
  );
});
test('cross-scale destination sorting uses destination local units', () => {
  assert.deepEqual(g.sortDimensions([0, 0, 200, 70], [1, 4, 2, 3], 2, 0.5), {
    width: 412,
    height: 168,
  });
});

test('native pickup refreshes stale source/target/scroll caches and uses client coordinates', () => {
  const { win, frames } = host();
  const source = element(win, 2);
  source.dataset.hitboxid = 'task';
  const task = entity('task', [1, 2, 3, 4]);
  let targets = 0,
    scroll = 0;
  task.recalcInitial = () => {
    task.initial = [100, 200, 609.334, 270.25];
  };
  const target = entity('target', [0, 0, 1, 1]);
  target.recalcInitial = () => targets++;
  const edge = entity('edge', [0, 0, 1, 1]);
  edge.recalcInitial = () => scroll++;
  const emitter = new EventEmitter();
  const drag = new g.DragManager(
    win,
    emitter,
    new Map([
      ['task', task],
      ['target', target],
    ]),
    new Map([['edge', edge]])
  );
  let start;
  emitter.on('dragStart', (event) => {
    start = event;
  });
  assert.equal(
    drag.dragStart({ clientX: 120, clientY: 220, pageX: 1120, pageY: 1220 }, source),
    true
  );
  assert.deepEqual(start.dragOriginHitbox, task.initial);
  assert.deepEqual(start.dragOrigin, { x: 120, y: 220 });
  assert.equal(start.dragScale, 2);
  assert.equal(targets, 1);
  assert.equal(scroll, 1);
  drag.cancelDrag();
  assert.equal(frames.size, 0);
});

test('host transform change cancels without emitting a drop, including while stationary', () => {
  const { win, tick } = host();
  const source = element(win);
  source.dataset.hitboxid = 'task';
  source.parentElement = element(win);
  const task = entity('task', [100, 200, 354.667, 235.125]);
  const emitter = new EventEmitter();
  const drag = new g.DragManager(win, emitter, new Map([['task', task]]), new Map());
  let drops = 0,
    cancellations = 0;
  emitter.on('dragEnd', () => drops++);
  emitter.on('dragCancel', () => cancellations++);
  drag.dragStart({ clientX: 120, clientY: 220 }, source);
  source.parentElement.css.transform = 'matrix(2, 0, 0, 2, 10, 20)';
  tick();
  drag.dragEnd({ type: 'pointerup' });
  assert.equal(cancellations, 1);
  assert.equal(drops, 0);
  assert.equal(drag.dragEntity, undefined);
});

test('a new pickup waits for the prior native drop animation to settle', () => {
  const { win } = host();
  const source = element(win);
  source.dataset.hitboxid = 'task';
  const task = entity('task', [100, 200, 354.667, 235.125]);
  const drag = new g.DragManager(win, new EventEmitter(), new Map([['task', task]]), new Map());
  const pointer = { clientX: 120, clientY: 220 };
  assert.equal(drag.dragStart(pointer, source), true);
  drag.dragEnd({ type: 'pointerup' });
  assert.equal(drag.dragStart(pointer, source), false);
  win.performance.now = () => 10000;
  assert.equal(drag.dragStart(pointer, source), true);
  drag.cancelDrag();
});

test('unsupported rotated host transforms refuse pickup before sorting starts', () => {
  const { win } = host();
  const source = element(win);
  source.dataset.hitboxid = 'task';
  source.parentElement = element(win);
  source.parentElement.css.transform = 'matrix(1, 0.2, 0, 1, 0, 0)';
  const drag = new g.DragManager(
    win,
    new EventEmitter(),
    new Map([['task', entity('task', [0, 0, 1, 1])]]),
    new Map()
  );
  assert.equal(drag.dragStart({ clientX: 1, clientY: 2 }, source), false);
  assert.equal(drag.dragEntity, undefined);
});

test('native SortManager sizes placeholders/translations locally and clears them on cancellation', () => {
  const { win } = host();
  const emitter = new EventEmitter();
  const manager = new g.SortManager(
    {
      win,
      dragManager: { emitter },
      onDrop() {
        throw new Error('Must not drop');
      },
    },
    'vertical'
  );
  const task = entity('task', [100, 200, 300, 270], [0]);
  const next = entity('next', [100, 280, 300, 350], [1]);
  const placeholder = entity('placeholder', [100, 350, 300, 350], [2]);
  placeholder.getData = () => ({ type: 'placeholder' });
  const hidden = element(win, 2, 100, 35),
    sibling = element(win, 2, 100, 35),
    space = element(win, 2, 100, 0);
  manager.registerSortable('task', task, hidden, hidden);
  manager.registerSortable('next', next, sibling, sibling);
  manager.registerSortable('placeholder', placeholder, space, space);
  emitter.emit('dragStart', {
    dragEntity: task,
    dragEntityMargin: [0, 4, 0, 0],
    dragOriginHitbox: task.initial,
    dragScale: 2,
  });
  assert.equal(space.style.getPropertyValue('height'), '39px');
  assert.equal(sibling.style.getPropertyValue('transform'), 'translate3d(0, 39px, 0)');
  emitter.emit('dragCancel');
  assert.equal(space.style.getPropertyValue('height'), '');
  assert.equal(hidden.style.getPropertyValue('display'), '');
  assert.equal(sibling.style.getPropertyValue('transform'), 'translate3d(0, 0, 0)');
  manager.destroy();
});

test('native nested ScrollManager hitboxes follow scaled offsets', () => {
  const { win } = host();
  const parent = new g.ScrollManager({}, 'board', [], null);
  parent.scrollEl = element(win, 2, 300, 200);
  parent.scrollState = { x: 10, y: 20, maxX: 100, maxY: 100 };
  const child = new g.ScrollManager({}, 'board', [], parent);
  child.scrollEl = element(win, 2, 200, 100);
  child.scrollState = { x: 3, y: 4, maxX: 100, maxY: 100 };
  assert.deepEqual(child.getScrollShift(), { x: 20, y: 40 });
  const edge = child.createScrollEntity('top');
  parent.scrollState.y += 5;
  assert.equal(edge.getHitbox()[1], 190);
});

test('child entities can initialize before a parent scroll ref, then refresh after mounting', () => {
  const { win } = host();
  const parent = new g.ScrollManager({}, 'board', [], null);
  const childScroll = new g.ScrollManager({}, 'board', [], parent);
  childScroll.scrollEl = element(win, 2, 200, 100);
  childScroll.scrollState = { x: 0, y: 0, maxX: 0, maxY: 0 };
  const child = new g.EntityManager({}, 'board', 'task', 0, null, childScroll, null, {
    current: {},
  });
  child.measureNode = element(win, 2, 100, 35);
  const task = child.getEntity(child.measureNode.getBoundingClientRect());
  assert.deepEqual(task.getHitbox(), [100, 200, 300, 270]);
  assert.deepEqual(childScroll.getScrollShift(), { x: 0, y: 0 });
  parent.scrollEl = element(win, 2, 300, 200);
  parent.scrollState = { x: 5, y: 10, maxX: 100, maxY: 100 };
  task.recalcInitial();
  assert.deepEqual(task.getHitbox(), [100, 200, 300, 270]);
  parent.scrollState.y += 5;
  assert.deepEqual(task.getHitbox(), [100, 190, 300, 260]);
});
