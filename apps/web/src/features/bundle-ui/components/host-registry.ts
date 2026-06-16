/**
 * Host-side registry: maps each remote element name to its typed adapter. This
 * is the single source of truth for which elements exist on the host; adding a
 * component means adding its folder and one line here. `remoteComponents.tsx`
 * builds the `RemoteRootRenderer` map from this record.
 */

import type { ComponentType } from "react";

import type { RemoteProps } from "./_shared/remote-props";
import { BadgeHost } from "./badge/badge.host";
import { BlockStackHost } from "./block-stack/block-stack.host";
import { ButtonHost } from "./button/button.host";
import { CardHost } from "./card/card.host";
import { CardContentHost } from "./card/card-content.host";
import { CardDescriptionHost } from "./card/card-description.host";
import { CardFooterHost } from "./card/card-footer.host";
import { CardHeaderHost } from "./card/card-header.host";
import { CardTitleHost } from "./card/card-title.host";
import { CheckboxHost } from "./checkbox/checkbox.host";
import { HeadingHost } from "./heading/heading.host";
import { IconHost } from "./icon/icon.host";
import { InlineStackHost } from "./inline-stack/inline-stack.host";
import { PillHost } from "./pill/pill.host";
import { ProgressHost } from "./progress/progress.host";
import { ScoreRingHost } from "./score-ring/score-ring.host";
import { SpinnerHost } from "./spinner/spinner.host";
import { TextHost } from "./text/text.host";
import { TextareaHost } from "./textarea/textarea.host";

export const hostAdapters = {
  "tangent-block-stack": BlockStackHost,
  "tangent-inline-stack": InlineStackHost,
  "tangent-text": TextHost,
  "tangent-heading": HeadingHost,
  "tangent-button": ButtonHost,
  "tangent-icon": IconHost,
  "tangent-textarea": TextareaHost,
  "tangent-spinner": SpinnerHost,
  "tangent-card": CardHost,
  "tangent-card-header": CardHeaderHost,
  "tangent-card-title": CardTitleHost,
  "tangent-card-description": CardDescriptionHost,
  "tangent-card-content": CardContentHost,
  "tangent-card-footer": CardFooterHost,
  "tangent-badge": BadgeHost,
  "tangent-pill": PillHost,
  "tangent-progress": ProgressHost,
  "tangent-score-ring": ScoreRingHost,
  "tangent-checkbox": CheckboxHost,
} as const satisfies Record<string, ComponentType<RemoteProps>>;

/** Union of valid remote element names. */
export type BundleUiElementName = keyof typeof hostAdapters;

/** Runtime list of every element name on the host. */
export const BUNDLE_UI_ELEMENT_NAMES = Object.keys(
  hostAdapters,
) as BundleUiElementName[];
