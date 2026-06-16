import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./score-ring.contract";

const ScoreRingElement = defineRemoteElement(TAG, attributes, events);

export const ScoreRing = makeAuthorComponent(TAG, ScoreRingElement, events);
