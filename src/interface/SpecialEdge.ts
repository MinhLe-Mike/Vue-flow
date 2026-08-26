import { type Point } from '../interface/OrthogonalRouter';

export interface SegmentHandle extends Point {
  segmentIndex: number;
  direction: 'horizontal' | 'vertical';
  moveAxis: 'x' | 'y';
}

export interface SegmentDragState {
  segmentIndex: number;
  originalRoute: Point[];
  currentCoordinate: number;
  moveAxis: 'x' | 'y';
  pointerStart: Point;
  hasMoved: boolean;
}

export interface WaypointDragState {
  waypointIndex: number;
  previewWaypoints: Point[];
  pointerStart: Point;
  hasMoved: boolean;
}
