import { useCallback, useRef, type Ref } from "react";
import { keepWheelOnScrollableList } from "@/lib/keepWheelScroll";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/** Attach the portaled-list wheel fix for as long as the node is mounted. */
export function useKeepWheelScroll<T extends HTMLElement>(forwardedRef: Ref<T>) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const forwardedRefRef = useRef(forwardedRef);
  forwardedRefRef.current = forwardedRef;

  return useCallback((node: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    assignRef(forwardedRefRef.current, node);
    if (!node) return;
    const onWheel = (event: WheelEvent) => keepWheelOnScrollableList(event, node);
    node.addEventListener("wheel", onWheel);
    cleanupRef.current = () => node.removeEventListener("wheel", onWheel);
  }, []);
}
