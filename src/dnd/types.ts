import { ComponentChildren } from 'preact';

export type Axis = 'horizontal' | 'vertical';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Path = number[];

export interface NestableProps {
  id: string;
  type: string;
  accepts: string[];
}

export interface Nestable<D = any, T = any> extends NestableProps {
  children: T[];
  data: D;
}

// [minX, minY, maxX, maxY]
export type Hitbox = [number, number, number, number];

export interface Coordinates {
  x: number;
  y: number;
}

export type CoordinateShift = Coordinates;

export interface ScrollState extends Coordinates {
  maxX: number;
  maxY: number;
}

export interface EntityData {
  type: string;
  id: string;
  accepts: string[];
  acceptsSort?: string[];
  sortAxis?: Axis;
  [k: string]: any;
}

export interface ScopedEntityData extends EntityData {
  win: Window;
}

/**
 * Personal build: where a drop puts the dragged entity. The target list's SortManager
 * decides it once; its preview shows it and the drop performs it.
 */
export interface DropTarget {
  /** The lane or card that receives the entity; null for the board's list of lanes. */
  parentId: string | null;
  /** Before this sibling, at the end, or where the receiving lane puts new cards. */
  position: { before: string } | 'end' | 'new-card';
}

export interface Entity {
  getPath(): Path;
  /** The data id of the entity this one is nested in (a lane or card), or null. */
  getParentId(): string | null;
  getHitbox(): Hitbox;
  getData(): ScopedEntityData;
  recalcInitial(): void;
  getParentScrollState(): ScrollState;
  getParentScrollShift(): CoordinateShift;

  scopeId: string;
  entityId: string;
  initial: Hitbox;
}

export interface WithChildren {
  children?: ComponentChildren;
}

export const initialScrollState: ScrollState = {
  x: 0,
  y: 0,
  maxX: 0,
  maxY: 0,
};

export const initialScrollShift: CoordinateShift = {
  x: 0,
  y: 0,
};
