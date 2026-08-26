<template>
  <path
    :id="id"
    :style="style"
    class="vue-flow__edge-path"
    :d="svgPath"
    :marker-end="markerEnd"
  />

  <EdgeLabelRenderer>
    <!-- Stored corner waypoints -->
    <button
      v-for="(waypoint, index) in waypointHandles"
      :key="`waypoint-${index}`"
      class="edge-waypoint-handle edge-waypoint-handle--active nodrag nopan"
      :style="handleStyle(waypoint)"
      type="button"
      aria-label="Move edge waypoint"
      @pointerdown="startWaypointDrag(index, $event)"
    />

    <!-- One handle at the center of every visible segment -->
    <button
      v-for="handle in midpointHandles"
      :key="`segment-${handle.segmentIndex}`"
      class="edge-waypoint-handle edge-waypoint-handle--midpoint nodrag nopan"
      :style="handleStyle(handle)"
      type="button"
      aria-label="Move edge segment"
      @pointerdown="startSegmentDrag(handle.segmentIndex, $event)"
    />

    <!-- Temporary visual guide while dragging a segment -->
    <button
      v-if="segmentDragHandle"
      class="edge-waypoint-handle edge-waypoint-handle--dragging nodrag nopan"
      :style="handleStyle(segmentDragHandle)"
      type="button"
      aria-hidden="true"
      tabindex="-1"
    />

    <div
      :style="{
        pointerEvents: 'none',
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
      }"
    />
  </EdgeLabelRenderer>
</template>

<script lang="ts" setup>
import type { EdgeProps } from "@vue-flow/core";
import {
  EdgeLabelRenderer,
  useVueFlow,
} from "@vue-flow/core";
import type { CSSProperties } from "vue";
import {
  computed,
  nextTick,
  ref,
  watch,
} from "vue";
import {
  type OrthogonalEdgeData,
  type Point,
} from "../src/interface/OrthogonalRouter";
import {
  type WaypointDragState,
  type SegmentHandle,
  type SegmentDragState,
} from "../src/interface/SpecialEdge";
import { routeOrthogonal } from '../src/router/orthogonalRouter';

const props =
  defineProps<EdgeProps<OrthogonalEdgeData>>();

const {
  screenToFlowCoordinate,
  updateEdgeData,
} = useVueFlow();

const ALIGNMENT_TOLERANCE = 6;
const DRAG_THRESHOLD = 3;
const POINT_EPSILON = 0.5;

const segmentDrag = ref<SegmentDragState | null>(null);

const waypointDrag = ref<WaypointDragState | null>(null);

const sourcePoint = computed<Point>(() => ({
  x: props.sourceX,
  y: props.sourceY,
}));

const targetPoint = computed<Point>(() => ({
  x: props.targetX,
  y: props.targetY,
}));

const buildRoute = (
  waypoints: Point[] = [],
): Point[] =>
  routeOrthogonal({
    source: sourcePoint.value,
    target: targetPoint.value,
    /*
     * Strict isolation:
     * unrelated nodes cannot affect this edge.
     */
    obstacles: [],
    waypoints,
    clearance: props.data?.clearance,
  });

/**
 * While an existing waypoint is being dragged, use the preview
 * waypoints for rendering.
 *
 * Edge data is not modified until pointerup.
 */
const effectiveWaypoints =
  computed<Point[]>(() => {
    if (waypointDrag.value) {
      return waypointDrag.value.previewWaypoints;
    }

    return props.data?.waypoints ?? [];
  });

const routedPath = computed<Point[]>(() =>
  buildRoute(effectiveWaypoints.value),
);

/**
 * During segment dragging, render the modified route snapshot.
 *
 * Outside segment dragging, render the normal router result.
 */
const displayedRoute =
  computed<Point[]>(() => {
    const state = segmentDrag.value;

    if (!state) {
      return routedPath.value;
    }

    return moveSegment(
      state.originalRoute,
      state.segmentIndex,
      state.moveAxis,
      state.currentCoordinate,
    );
  });

/**
 * Temporary visual handle shown at the center of the segment
 * currently being dragged.
 */
const segmentDragHandle =
  computed<Point | null>(() => {
    const state = segmentDrag.value;

    if (!state) {
      return null;
    }

    const start =
      displayedRoute.value[state.segmentIndex];

    const end =
      displayedRoute.value[
        state.segmentIndex + 1
      ];

    if (!start || !end) {
      return null;
    }

    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
  });

const svgPath = computed<string>(() =>
  displayedRoute.value
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
    )
    .join(" "),
);

/**
 * Generate one midpoint handle for every visible segment.
 *
 * These handles are derived from the current route. They are not
 * stored in edge data.
 */
const midpointHandles =
  computed<SegmentHandle[]>(() => {
    if (
      segmentDrag.value ||
      waypointDrag.value
    ) {
      return [];
    }

    const handles: SegmentHandle[] = [];
    const route = displayedRoute.value;

    for (
      let segmentIndex = 0;
      segmentIndex < route.length - 1;
      segmentIndex += 1
    ) {
      const start = route[segmentIndex];
      const end = route[segmentIndex + 1];

      if (
        !start ||
        !end ||
        samePoint(start, end)
      ) {
        continue;
      }

      const horizontal = nearlyEqual(
        start.y,
        end.y,
      );

      handles.push({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
        segmentIndex,
        direction: horizontal
          ? "horizontal"
          : "vertical",

        /*
         * A horizontal segment moves vertically.
         * A vertical segment moves horizontally.
         */
        moveAxis: horizontal ? "y" : "x",
      });
    }

    return handles;
  });

/**
 * Show preview waypoint positions while dragging an existing
 * waypoint.
 */
const waypointHandles =
  computed<Point[]>(() => {
    if (segmentDrag.value) {
      return [];
    }

    return (
      waypointDrag.value?.previewWaypoints ??
      props.data?.waypoints ??
      []
    );
  });

const labelPosition = computed<Point>(() =>
  pointAtPathProgress(
    displayedRoute.value,
    0.5,
  ),
);

const handleStyle = (
  handle: Point,
): CSSProperties => ({
  pointerEvents: "all",
  position: "absolute",
  transform:
    `translate(-50%, -50%) ` +
    `translate(${handle.x}px, ${handle.y}px)`,
});

/**
 * Start dragging a visible segment.
 *
 * No stored waypoint is created at pointerdown.
 */
const startSegmentDrag = (
  segmentIndex: number,
  event: PointerEvent,
): void => {
  event.preventDefault();
  event.stopPropagation();

  const routeSnapshot = clonePoints(
    routedPath.value,
  );

  const start = routeSnapshot[segmentIndex];
  const end =
    routeSnapshot[segmentIndex + 1];

  if (
    !start ||
    !end ||
    samePoint(start, end)
  ) {
    return;
  }

  const horizontal = nearlyEqual(
    start.y,
    end.y,
  );

  const moveAxis: "x" | "y" =
    horizontal ? "y" : "x";

  const pointerStart =
    screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    });

  segmentDrag.value = {
    segmentIndex,
    originalRoute: routeSnapshot,
    currentCoordinate: start[moveAxis],
    moveAxis,
    pointerStart,
    hasMoved: false,
  };

  const moveSegmentPreview = (
    moveEvent: PointerEvent,
  ): void => {
    const state = segmentDrag.value;

    if (!state) {
      return;
    }

    const pointer =
      screenToFlowCoordinate({
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });

    state.currentCoordinate =
      snapSegmentCoordinate(
        pointer[state.moveAxis],
        state,
      );

    if (
      manhattanDistance(
        state.pointerStart,
        pointer,
      ) >= DRAG_THRESHOLD
    ) {
      state.hasMoved = true;
    }
  };

  const finishSegmentDrag = (): void => {
    const state = segmentDrag.value;

    if (state?.hasMoved) {
      const movedRoute = moveSegment(
        state.originalRoute,
        state.segmentIndex,
        state.moveAxis,
        state.currentCoordinate,
      );

      /*
       * Waypoints are saved only after pointerup.
       */
      commitPolyline(movedRoute);
    }

    segmentDrag.value = null;

    removeDocumentDragListeners(
      moveSegmentPreview,
      finishSegmentDrag,
    );
  };

  addDocumentDragListeners(
    moveSegmentPreview,
    finishSegmentDrag,
  );
};

/**
 * Drag an existing stored waypoint.
 *
 * While dragging, only previewWaypoints changes.
 * Edge data is committed on pointerup.
 */
const startWaypointDrag = (
  waypointIndex: number,
  event: PointerEvent,
): void => {
  event.preventDefault();
  event.stopPropagation();

  const existingWaypoints = clonePoints(
    props.data?.waypoints ?? [],
  );

  const originalWaypoint =
    existingWaypoints[waypointIndex];

  if (!originalWaypoint) {
    return;
  }

  const pointerStart =
    screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    });

  waypointDrag.value = {
    waypointIndex,
    previewWaypoints: existingWaypoints,
    pointerStart,
    hasMoved: false,
  };

  const moveWaypointPreview = (
    moveEvent: PointerEvent,
  ): void => {
    const state = waypointDrag.value;

    if (!state) {
      return;
    }

    const pointer =
      screenToFlowCoordinate({
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });

    const snappedPoint = snapWaypoint(
      pointer,
      state.waypointIndex,
      state.previewWaypoints,
    );

    state.previewWaypoints =
      state.previewWaypoints.map(
        (waypoint, index) =>
          index === state.waypointIndex
            ? snappedPoint
            : waypoint,
      );

    if (
      manhattanDistance(
        state.pointerStart,
        pointer,
      ) >= DRAG_THRESHOLD
    ) {
      state.hasMoved = true;
    }
  };

  const finishWaypointDrag = (): void => {
    const state = waypointDrag.value;

    if (state?.hasMoved) {
      /*
       * Route through the final preview waypoints and simplify the
       * resulting complete source-to-target polyline.
       */
      const finalRoute = buildRoute(
        state.previewWaypoints,
      );

      commitPolyline(finalRoute);
    }

    waypointDrag.value = null;

    removeDocumentDragListeners(
      moveWaypointPreview,
      finishWaypointDrag,
    );
  };

  addDocumentDragListeners(
    moveWaypointPreview,
    finishWaypointDrag,
  );
};

const moveSegment = (
  route: Point[],
  segmentIndex: number,
  moveAxis: "x" | "y",
  coordinate: number,
): Point[] => {
  const start = route[segmentIndex];
  const end = route[segmentIndex + 1];

  if (!start || !end) {
    return route;
  }

  const movedStart: Point = {
    ...start,
    [moveAxis]: coordinate,
  };

  const movedEnd: Point = {
    ...end,
    [moveAxis]:coordinate,
  };

  return simplifyPolyline([
    ...route.slice(0, segmentIndex + 1),
    movedStart,
    movedEnd,
    ...route.slice(segmentIndex + 1),
  ]);
}

/**
 * Snap a dragged segment to the axis of an existing parallel
 * segment when it is within the configured tolerance.
 */
const snapSegmentCoordinate = (
  coordinate: number,
  state: SegmentDragState,
): number => {
  let closestCoordinate = coordinate;
  let closestDistance =
    ALIGNMENT_TOLERANCE + 1;

  for (
    let index = 0;
    index <
    state.originalRoute.length - 1;
    index += 1
  ) {
    if (index === state.segmentIndex) {
      continue;
    }

    const start =
      state.originalRoute[index];

    const end =
      state.originalRoute[index + 1];

    if (!start || !end) {
      continue;
    }

    const candidateIsParallel =
      state.moveAxis === "y"
        ? nearlyEqual(start.y, end.y)
        : nearlyEqual(start.x, end.x);

    if (!candidateIsParallel) {
      continue;
    }

    const candidateCoordinate =
      start[state.moveAxis];

    const candidateDistance = Math.abs(
      coordinate - candidateCoordinate,
    );

    if (
      candidateDistance < closestDistance
    ) {
      closestDistance =
        candidateDistance;

      closestCoordinate =
        candidateCoordinate;
    }
  }

  return closestCoordinate;
}

/**
 * Snap an existing waypoint to the x or y position of its adjacent
 * source, target, or waypoint.
 */
const snapWaypoint = (
  pointer: Point,
  waypointIndex: number,
  waypoints: Point[],
): Point => {
  const previous =
    waypointIndex === 0
      ? sourcePoint.value
      : waypoints[waypointIndex - 1];

  const next =
    waypointIndex === waypoints.length - 1
      ? targetPoint.value
      : waypoints[waypointIndex + 1];

  const candidates = [
    previous,
    next,
  ].filter(
    (point): point is Point =>
      point !== undefined,
  );

  let x = pointer.x;
  let y = pointer.y;

  let closestXDistance =
    ALIGNMENT_TOLERANCE + 1;

  let closestYDistance =
    ALIGNMENT_TOLERANCE + 1;

  for (const candidate of candidates) {
    const xDistance = Math.abs(
      pointer.x - candidate.x,
    );

    const yDistance = Math.abs(
      pointer.y - candidate.y,
    );

    if (
      xDistance < closestXDistance
    ) {
      closestXDistance = xDistance;
      x = candidate.x;
    }

    if (
      yDistance < closestYDistance
    ) {
      closestYDistance = yDistance;
      y = candidate.y;
    }
  }

  return { x, y };
}

/**
 * Simplify the entire provided polyline and store only its internal
 * points as edge waypoints.
 */
const commitPolyline = (
  polyline: Point[],
): void => {
  const simplified =
    simplifyPolyline(polyline);

  const waypoints =
    simplified.length <= 2
      ? []
      : simplified.slice(1, -1);

  updateEdgeData<OrthogonalEdgeData>(
    props.id,
    {
      waypoints,
    },
  );
}

/**
 * Remove:
 *
 * 1. Consecutive duplicate points.
 * 2. Middle points from three consecutive vertical points.
 * 3. Middle points from three consecutive horizontal points.
 *
 * This function never moves a point. It only removes points that
 * are redundant.
 */
const simplifyPolyline = (
  points: Point[],
): Point[] => {
  const result: Point[] = [];

  for (const inputPoint of points) {
    const point: Point = {
      x: inputPoint.x,
      y: inputPoint.y,
    };

    const previous =
      result[result.length - 1];

    if (
      previous &&
      samePoint(previous, point)
    ) {
      continue;
    }

    result.push(point);

    /*
     * Continue checking because removing the middle point can make
     * another previous point redundant.
     */
    while (result.length >= 3) {
      const first =
        result[result.length - 3];

      const middle =
        result[result.length - 2];

      const last =
        result[result.length - 1];

      if (
        !first ||
        !middle ||
        !last
      ) {
        break;
      }

      const sameVerticalLine =
        nearlyEqual(first.x, middle.x) &&
        nearlyEqual(middle.x, last.x);

      const sameHorizontalLine =
        nearlyEqual(first.y, middle.y) &&
        nearlyEqual(middle.y, last.y);

      if (
        !sameVerticalLine &&
        !sameHorizontalLine
      ) {
        break;
      }

      /*
       * Remove only the middle point.
       */
      result.splice(
        result.length - 2,
        1,
      );
    }
  }

  return result;
}

/**
 * Find a point at a normalized distance along the route.
 */
const pointAtPathProgress = (
  path: Point[],
  normalizedProgress: number,
): Point => {
  if (!path.length) {
    return { x: 0, y: 0 };
  }

  const totalLength = path.reduce(
    (total, point, index) => {
      const previous =
        path[index - 1];

      return previous
        ? total +
            manhattanDistance(
              previous,
              point,
            )
        : total;
    },
    0,
  );

  let remaining =
    totalLength * normalizedProgress;

  for (
    let index = 1;
    index < path.length;
    index += 1
  ) {
    const start = path[index - 1];
    const end = path[index];

    if (!start || !end) {
      continue;
    }

    const segmentLength =
      manhattanDistance(start, end);

    if (
      remaining <= segmentLength
    ) {
      const ratio =
        segmentLength > 0
          ? remaining / segmentLength
          : 0;

      return {
        x:
          start.x +
          (end.x - start.x) * ratio,
        y:
          start.y +
          (end.y - start.y) * ratio,
      };
    }

    remaining -= segmentLength;
  }

  return (
    path[path.length - 1] ?? {
      x: 0,
      y: 0,
    }
  );
}

const addDocumentDragListeners = (
  moveHandler: (
    event: PointerEvent,
  ) => void,
  finishHandler: () => void,
): void => {
  document.addEventListener(
    "pointermove",
    moveHandler,
  );

  document.addEventListener(
    "pointerup",
    finishHandler,
  );

  document.addEventListener(
    "pointercancel",
    finishHandler,
  );
}

const removeDocumentDragListeners = (
  moveHandler: (
    event: PointerEvent,
  ) => void,
  finishHandler: () => void,
): void => {
  document.removeEventListener(
    "pointermove",
    moveHandler,
  );

  document.removeEventListener(
    "pointerup",
    finishHandler,
  );

  document.removeEventListener(
    "pointercancel",
    finishHandler,
  );
}

const nearlyEqual = (
  first: number,
  second: number,
  tolerance = POINT_EPSILON,
): boolean => {
  return (
    Math.abs(first - second) <= tolerance
  );
}

const samePoint = (
  first: Point,
  second: Point,
): boolean => {
  return (
    nearlyEqual(first.x, second.x) &&
    nearlyEqual(first.y, second.y)
  );
}

const samePointList = (
  first: Point[],
  second: Point[],
): boolean => {
  if (first.length !== second.length) {
    return false;
  }

  return first.every(
    (point, index) => {
      const other = second[index];

      return (
        other !== undefined &&
        samePoint(point, other)
      );
    },
  );
}

const manhattanDistance = (
  first: Point,
  second: Point,
): number => {
  return (
    Math.abs(first.x - second.x) +
    Math.abs(first.y - second.y)
  );
}

const clonePoints = (
  points: Point[],
): Point[] => {
  return points.map((point) => ({
    x: point.x,
    y: point.y,
  }));
}

/**
 * After a connected node finishes moving, simplify only the
 * existing control points.
 *
 * Do not use routedPath here. routedPath can contain new points
 * generated by routeOrthogonal(), which would replace the old edge.
 */
const normalizeRouteAfterNodeMove = (): void => {
  if (
    segmentDrag.value ||
    waypointDrag.value
  ) {
    return;
  }

  const currentWaypoints =
    props.data?.waypoints ?? [];

  if (!currentWaypoints.length) {
    return;
  }

  /*
   * Only use the current endpoint positions and existing stored
   * waypoints.
   */
  const existingControlPolyline: Point[] = [
    {
      x: props.sourceX,
      y: props.sourceY,
    },

    ...clonePoints(currentWaypoints),

    {
      x: props.targetX,
      y: props.targetY,
    },
  ];

  const simplifiedControlPolyline =
    simplifyPolyline(
      existingControlPolyline,
    );

  /*
   * Remove source and target before storing the result.
   */
  const normalizedWaypoints =
    simplifiedControlPolyline.length > 2
      ? simplifiedControlPolyline.slice(
          1,
          -1,
        )
      : [];

  /*
   * Avoid an unnecessary reactive update if no waypoint was
   * removed.
   */
  if (
    samePointList(
      currentWaypoints,
      normalizedWaypoints,
    )
  ) {
    return;
  }

  updateEdgeData<OrthogonalEdgeData>(
    props.id,
    {
      waypoints: normalizedWaypoints,
    },
  );
}

/**
 * App.vue should increment normalizeRevision only for special edges
 * connected to the node that has finished dragging.
 */
watch(
  () =>
    props.data?.normalizeRevision,
  async (
    newRevision,
    oldRevision,
  ) => {
    if (
      newRevision === undefined ||
      newRevision === oldRevision
    ) {
      return;
    }

    /*
     * Wait until Vue Flow updates sourceX/sourceY or
     * targetX/targetY for this connected edge.
     */
    await nextTick();

    normalizeRouteAfterNodeMove();
  },
  {
    flush: "post",
  },
);
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
};
</script>

<style>
.edge-waypoint-handle {
  width: 10px;
  height: 10px;
  padding: 0;
  border: 2px solid #f05f75;
  border-radius: 50%;
  background: white;
  cursor: crosshair;
  box-sizing: border-box;
  transition:
    width 100ms ease,
    height 100ms ease,
    background-color 100ms ease;
}

.edge-waypoint-handle:hover {
  width: 14px;
  height: 14px;
  background: #f05f75;
}

.edge-waypoint-handle--active {
  background: #f05f75;
}

.edge-waypoint-handle--midpoint {
  background: white;
}

.edge-waypoint-handle--midpoint:hover {
  background: #f05f75;
}

.edge-waypoint-handle--dragging {
  width: 14px;
  height: 14px;
  border-color: #d93654;
  background: #f05f75;
  cursor: grabbing;
  pointer-events: none;
  box-shadow:
    0 0 0 3px rgb(240 95 117 / 20%),
    0 2px 6px rgb(0 0 0 / 20%);
}
</style>