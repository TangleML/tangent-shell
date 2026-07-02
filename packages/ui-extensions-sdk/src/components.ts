/**
 * The typed component surface a UI extension imports from
 * `@tangent/ui-extensions-sdk`.
 *
 * Each component's props are derived from its wire contract (`z.infer` over the
 * same zod `attributes` the host validates), plus the author-facing event
 * handlers and `children`. This keeps the author types in lockstep with the
 * runtime contract — change a contract and the author types move with it.
 *
 * The implementations are intentionally thin: at runtime the worker swaps this
 * module for its own remote-dom runtime, and the local build externalizes the
 * import, so these bodies never execute in production. They render children so a
 * component still degrades gracefully if imported directly (e.g. in a test).
 */

import {
  createElement,
  Fragment,
  type FunctionComponent,
  type ReactNode,
} from "react";
import type { z } from "zod";

import { attributes as badgeAttributes } from "./contracts/badge";
import { attributes as blockStackAttributes } from "./contracts/block-stack";
import { attributes as buttonAttributes } from "./contracts/button";
import { attributes as cardAttributes } from "./contracts/card";
import { attributes as cardContentAttributes } from "./contracts/card-content";
import { attributes as cardDescriptionAttributes } from "./contracts/card-description";
import { attributes as cardFooterAttributes } from "./contracts/card-footer";
import { attributes as cardHeaderAttributes } from "./contracts/card-header";
import { attributes as cardTitleAttributes } from "./contracts/card-title";
import { attributes as checkboxAttributes } from "./contracts/checkbox";
import { attributes as headingAttributes } from "./contracts/heading";
import { attributes as iconAttributes } from "./contracts/icon";
import { attributes as inlineStackAttributes } from "./contracts/inline-stack";
import { attributes as pillAttributes } from "./contracts/pill";
import { attributes as progressAttributes } from "./contracts/progress";
import { attributes as scoreRingAttributes } from "./contracts/score-ring";
import { attributes as spinnerAttributes } from "./contracts/spinner";
import { attributes as statusBarAttributes } from "./contracts/status-bar";
import { attributes as textAttributes } from "./contracts/text";
import { attributes as textareaAttributes } from "./contracts/textarea";

type Attrs<T> = z.infer<T>;
type WithChildren = { children?: ReactNode };

export type BadgeProps = Attrs<typeof badgeAttributes> & WithChildren;
export type BlockStackProps = Attrs<typeof blockStackAttributes> & WithChildren;
export type ButtonProps = Attrs<typeof buttonAttributes> &
  WithChildren & {
    /** Fired when the button is activated. */
    onPress?: () => void;
  };
export type CardProps = Attrs<typeof cardAttributes> & WithChildren;
export type CardContentProps = Attrs<typeof cardContentAttributes> &
  WithChildren;
export type CardDescriptionProps = Attrs<typeof cardDescriptionAttributes> &
  WithChildren;
export type CardFooterProps = Attrs<typeof cardFooterAttributes> & WithChildren;
export type CardHeaderProps = Attrs<typeof cardHeaderAttributes> & WithChildren;
export type CardTitleProps = Attrs<typeof cardTitleAttributes> & WithChildren;
export type CheckboxProps = Omit<
  Attrs<typeof checkboxAttributes>,
  "checked"
> & {
  /** Whether the box is checked; defaults to `false`. */
  checked?: boolean;
  /** Fired with the next checked state when toggled. */
  onCheckedChange?: (checked: boolean) => void;
};
export type HeadingProps = Omit<Attrs<typeof headingAttributes>, "level"> &
  WithChildren & {
    /** Heading level 1–6; defaults to `1`. */
    level?: Attrs<typeof headingAttributes>["level"];
  };
export type IconProps = Attrs<typeof iconAttributes>;
export type InlineStackProps = Attrs<typeof inlineStackAttributes> &
  WithChildren;
export type PillProps = Attrs<typeof pillAttributes> & WithChildren;
export type ProgressProps = Attrs<typeof progressAttributes>;
export type ScoreRingProps = Omit<
  Attrs<typeof scoreRingAttributes>,
  "score"
> & {
  /** Score 0–100; defaults to `0`. */
  score?: number;
};
export type SpinnerProps = Attrs<typeof spinnerAttributes>;
export type StatusBarProps = Attrs<typeof statusBarAttributes>;
export type TextProps = Attrs<typeof textAttributes> & WithChildren;
export type TextareaProps = Attrs<typeof textareaAttributes> & {
  /** Fired with the textarea's value on every input. */
  onInput?: (value: string) => void;
};

function stub<P>(displayName: string): FunctionComponent<P> {
  const Component = (props: P): ReactNode =>
    createElement(Fragment, null, (props as WithChildren).children);
  Component.displayName = displayName;
  return Component;
}

export const Badge = stub<BadgeProps>("Badge");
export const BlockStack = stub<BlockStackProps>("BlockStack");
export const Button = stub<ButtonProps>("Button");
export const Card = stub<CardProps>("Card");
export const CardContent = stub<CardContentProps>("CardContent");
export const CardDescription = stub<CardDescriptionProps>("CardDescription");
export const CardFooter = stub<CardFooterProps>("CardFooter");
export const CardHeader = stub<CardHeaderProps>("CardHeader");
export const CardTitle = stub<CardTitleProps>("CardTitle");
export const Checkbox = stub<CheckboxProps>("Checkbox");
export const Heading = stub<HeadingProps>("Heading");
export const Icon = stub<IconProps>("Icon");
export const InlineStack = stub<InlineStackProps>("InlineStack");
export const Pill = stub<PillProps>("Pill");
export const Progress = stub<ProgressProps>("Progress");
export const ScoreRing = stub<ScoreRingProps>("ScoreRing");
export const Spinner = stub<SpinnerProps>("Spinner");
export const StatusBar = stub<StatusBarProps>("StatusBar");
export const Text = stub<TextProps>("Text");
export const Textarea = stub<TextareaProps>("Textarea");
