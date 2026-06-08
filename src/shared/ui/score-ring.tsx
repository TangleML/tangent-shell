import { cn } from "@/shared/lib/utils";

import { Text } from "./typography";

/**
 * ScoreRing — Layer 2 base primitive.
 *
 * A circular progress ring that visualizes an opportunity score in `[0, 100]`,
 * with the numeric value centered inside. Ported from the sister project's
 * `OpportunityScoreRing` (tooltip dropped); the band colors are remapped to this
 * repo's semantic tokens (`success`/`warning`/`muted`) for dark-mode
 * consistency. Added for the bundle UI vocabulary (`tangent-score-ring`).
 */

const STROKE_WIDTH = 6;

type ScoreBand = "high" | "medium" | "low";

function getScoreBand(score: number): ScoreBand {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function getScoreTextClass(band: ScoreBand): string {
  if (band === "high") return "text-success";
  if (band === "medium") return "text-warning";
  return "text-muted-foreground";
}

function getScoreStrokeClass(band: ScoreBand): string {
  if (band === "high") return "stroke-success";
  if (band === "medium") return "stroke-warning";
  return "stroke-muted-foreground/50";
}

interface ScoreRingProps {
  /** Opportunity score in `[0, 100]`. */
  score: number;
  /** Pixel diameter of the ring. */
  size?: number;
}

export function ScoreRing({ score, size = 64 }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const band = getScoreBand(clamped);
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          className={getScoreStrokeClass(band)}
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <Text
        size="md"
        weight="bold"
        className={cn("absolute", getScoreTextClass(band))}
      >
        {clamped}
      </Text>
    </div>
  );
}

export type { ScoreRingProps };
