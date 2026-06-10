// local primitive — a freehand region selector drawn over a frozen artifact
// screenshot. The selection surface, rubber-band rect, and dimming mask are raw
// DOM with scoped classes (an allowed escape hatch, like the artifact iframe);
// the annotation panel uses Tangle UI primitives.
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { Box } from "@/shared/ui/box";
import { Button } from "@/shared/ui/button";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Textarea } from "@/shared/ui/textarea";
import { Text } from "@/shared/ui/typography";

/** A selection rectangle in CSS pixels, relative to the overlay box. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ArtifactReviewOverlayProps {
  /** Frozen screenshot of the artifact, at capture resolution. */
  image: HTMLCanvasElement;
  /** Data URL of {@link image}, used for display. */
  imageUrl: string;
  /** True while the cropped image is being uploaded/sent. */
  submitting?: boolean;
  /** Receives the cropped region and the user's note. */
  onSubmit: (blob: Blob, note: string) => void;
  /** Dismisses the overlay without sending. */
  onCancel: () => void;
}

/** Ignore stray clicks: a real selection must exceed this size (CSS px). */
const MIN_SELECTION = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function ArtifactReviewOverlay({
  image,
  imageUrl,
  submitting = false,
  onSubmit,
  onCancel,
}: ArtifactReviewOverlayProps) {
  const [phase, setPhase] = useState<"selecting" | "annotating">("selecting");
  const [selection, setSelection] = useState<Rect | null>(null);
  const [note, setNote] = useState("");
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Escape always backs out of review mode.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  function pointAt(e: ReactPointerEvent): { x: number; y: number } {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: clamp(e.clientX - box.left, 0, box.width),
      y: clamp(e.clientY - box.top, 0, box.height),
    };
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (phase !== "selecting") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = pointAt(e);
    dragStartRef.current = start;
    setSelection({ x: start.x, y: start.y, w: 0, h: 0 });
  }

  function handlePointerMove(e: ReactPointerEvent) {
    const start = dragStartRef.current;
    if (!start) return;
    setSelection(normalizeRect(start, pointAt(e)));
  }

  function handlePointerUp(e: ReactPointerEvent) {
    const start = dragStartRef.current;
    if (!start) return;
    dragStartRef.current = null;
    const rect = normalizeRect(start, pointAt(e));
    if (rect.w < MIN_SELECTION || rect.h < MIN_SELECTION) {
      setSelection(null);
      return;
    }
    setSelection(rect);
    setPhase("annotating");
  }

  function reselect() {
    setSelection(null);
    setPhase("selecting");
  }

  function cropSelection(rect: Rect): Promise<Blob | null> {
    const box = surfaceRef.current;
    if (!box) return Promise.resolve(null);
    // Map the CSS-pixel selection onto the capture-resolution canvas.
    const scaleX = image.width / box.clientWidth;
    const scaleY = image.height / box.clientHeight;
    const sx = Math.round(rect.x * scaleX);
    const sy = Math.round(rect.y * scaleY);
    const sw = Math.max(1, Math.round(rect.w * scaleX));
    const sh = Math.max(1, Math.round(rect.h * scaleY));

    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise((resolve) => out.toBlob((blob) => resolve(blob), "image/png"));
  }

  async function handleSend() {
    if (!selection || submitting) return;
    const blob = await cropSelection(selection);
    if (blob) onSubmit(blob, note);
  }

  return (
    <div
      ref={surfaceRef}
      role="application"
      aria-label="Select a region to review"
      className="absolute inset-0 z-20 overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />

      {selection ? (
        <div
          className="pointer-events-none absolute border-2 border-primary"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.w,
            height: selection.h,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/30" />
      )}

      {phase === "selecting" ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <Box
            background="inverted"
            paddingInline="base"
            paddingBlock="xs"
            borderRadius="full"
            shadow="md"
          >
            <Text size="xs">Drag to select a region, then add a note</Text>
          </Box>
        </div>
      ) : null}

      {phase === "selecting" ? (
        <div className="absolute inset-0 cursor-crosshair" aria-hidden />
      ) : null}

      {phase === "annotating" && selection ? (
        <div
          className="absolute inset-x-0 bottom-0 p-3"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Box
            background="base"
            border="sm"
            borderColor="base"
            borderRadius="base"
            padding="base"
            shadow="lg"
            maxInlineSize="2xl"
          >
            <BlockStack gap="2">
              <Text size="sm" weight="medium">
                Add a note for this region
              </Text>
              <Textarea
                autoFocus
                rows={3}
                placeholder="Describe what you'd like Prime to look at..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={submitting}
                aria-label="Review note"
              />
              <InlineStack gap="2" align="space-between" wrap="nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reselect}
                  disabled={submitting}
                >
                  Reselect
                </Button>
                <InlineStack gap="2" wrap="nowrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void handleSend()} disabled={submitting}>
                    {submitting ? "Sending..." : "Send to Prime"}
                  </Button>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Box>
        </div>
      ) : null}
    </div>
  );
}
