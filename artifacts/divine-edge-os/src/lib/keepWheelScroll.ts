export type ScrollSnapshot = {
  overflowY: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

/** True when this element can move in the wheel's vertical direction. */
export function listCanConsumeWheel(metrics: ScrollSnapshot, deltaY: number): boolean {
  if (deltaY === 0) return false;
  if (!SCROLLABLE_OVERFLOW.has(metrics.overflowY)) return false;
  if (metrics.scrollHeight <= metrics.clientHeight + 1) return false;
  if (deltaY < 0) return metrics.scrollTop > 0;
  return metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 1;
}

/** True when any element from the pointer target up to the portaled list can consume the wheel. */
export function shouldKeepWheelOnList(deltaY: number, chain: readonly ScrollSnapshot[]): boolean {
  return chain.some(metrics => listCanConsumeWheel(metrics, deltaY));
}

function snapshot(node: HTMLElement): ScrollSnapshot {
  return {
    overflowY: window.getComputedStyle(node).overflowY,
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  };
}

function chainWithin(target: EventTarget | null, boundary: Element): ScrollSnapshot[] {
  let node: Node | null = target instanceof Node ? target : null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const chain: ScrollSnapshot[] = [];
  while (node instanceof Element && boundary.contains(node)) {
    if (node instanceof HTMLElement) chain.push(snapshot(node));
    if (node === boundary) break;
    node = node.parentElement;
  }
  return chain;
}

/**
 * A modal Sheet or Dialog locks wheel events on document (bubble) and cancels
 * scrolling for anything portaled outside that dialog. Stop the event once the
 * open list can still scroll so the wheel moves the list. At the ends of the
 * list the event continues, and the dialog lock still keeps the page still.
 * This does not change keyboard navigation or which option is selected.
 */
export function keepWheelOnScrollableList(event: WheelEvent, boundary: Element): void {
  if (shouldKeepWheelOnList(event.deltaY, chainWithin(event.target, boundary))) {
    event.stopPropagation();
  }
}
