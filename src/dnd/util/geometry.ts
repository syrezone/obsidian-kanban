import { Coordinates, Hitbox } from '../types';

/** Border boxes in local CSS pixels; DOM rectangles are viewport pixels. */
export function localBorderBox(style: CSSStyleDeclaration) {
  const px = (value: string) => parseFloat(value) || 0;
  return {
    width:
      px(style.width) +
      (style.boxSizing === 'border-box'
        ? 0
        : px(style.paddingLeft) +
          px(style.paddingRight) +
          px(style.borderLeftWidth) +
          px(style.borderRightWidth)),
    height:
      px(style.height) +
      (style.boxSizing === 'border-box'
        ? 0
        : px(style.paddingTop) +
          px(style.paddingBottom) +
          px(style.borderTopWidth) +
          px(style.borderBottomWidth)),
  };
}

export function uniformScale(
  rect: { width: number; height: number },
  local: { width: number; height: number }
) {
  const scale = local.width > 0 ? rect.width / local.width : rect.height / local.height;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('Kanban requires a visible, positive-scale surface.');
  if (local.height > 0 && Math.abs(rect.height / local.height - scale) > 0.01) {
    throw new Error('Kanban supports uniform canvas scaling only.');
  }
  return scale;
}

export function elementScale(element: HTMLElement) {
  return uniformScale(
    element.getBoundingClientRect(),
    localBorderBox(element.win.getComputedStyle(element))
  );
}

export function screenShift(point: Coordinates, scale: number): Coordinates {
  return { x: point.x * scale, y: point.y * scale };
}

/** CSS margins stay local; convert them only when combining with screen boxes. */
export function sortDimensions(
  box: Hitbox,
  margin: Hitbox,
  sourceScale: number,
  destinationScale: number
) {
  return {
    width: (box[2] - box[0] + (margin[0] + margin[2]) * sourceScale) / destinationScale,
    height: (box[3] - box[1] + (margin[1] + margin[3]) * sourceScale) / destinationScale,
  };
}

/** A body-level preview represents the source border box, not its margin box. */
export function previewGeometry(
  box: Hitbox,
  origin: Coordinates,
  position: Coordinates,
  scale: number
) {
  return {
    width: `${(box[2] - box[0]) / scale}px`,
    height: `${(box[3] - box[1]) / scale}px`,
    transformOrigin: '0 0',
    transform: `translate3d(${box[0] + position.x - origin.x}px, ${box[1] + position.y - origin.y}px, 0) scale(${scale})`,
  };
}

/**
 * Watches the host surface: `root` (the owned embed's root) and its ancestors. Elements
 * inside `root` are Kanban's own, and sorting moves them with transforms during a drag
 * (a child card's parent card among them), so they are not watched.
 */
export function captureHostTransform(source: HTMLElement, root: HTMLElement) {
  const win = source.win;
  const ancestors: Array<{ element: HTMLElement; transform: string; zoom: string }> = [];
  for (let element = root; element; element = element.parentElement) {
    const style = win.getComputedStyle(element);
    const matrix = new (win as Window & typeof globalThis).DOMMatrixReadOnly(
      style.transform === 'none' ? undefined : style.transform
    );
    if (
      !matrix.is2D ||
      matrix.b !== 0 ||
      matrix.c !== 0 ||
      matrix.a <= 0 ||
      Math.abs(matrix.a - matrix.d) > 0.0001
    ) {
      throw new Error('Kanban supports positive uniform scale and translation only.');
    }
    ancestors.push({ element, transform: style.transform, zoom: style.getPropertyValue('zoom') });
  }
  const scrollX = win.scrollX,
    scrollY = win.scrollY;
  return () =>
    source.isConnected &&
    win.scrollX === scrollX &&
    win.scrollY === scrollY &&
    ancestors.every(({ element, transform, zoom }) => {
      const style = win.getComputedStyle(element);
      return (
        element.isConnected &&
        style.transform === transform &&
        style.getPropertyValue('zoom') === zoom
      );
    });
}
