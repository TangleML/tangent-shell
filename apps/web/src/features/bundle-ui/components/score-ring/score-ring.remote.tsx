import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/score-ring";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const ScoreRingElement = defineRemoteElement(TAG, attributes, events);

export const ScoreRing = makeAuthorComponent(TAG, ScoreRingElement, events);
