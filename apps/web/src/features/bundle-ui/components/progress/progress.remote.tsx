import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/progress";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const ProgressElement = defineRemoteElement(TAG, attributes, events);

export const Progress = makeAuthorComponent(TAG, ProgressElement, events);
