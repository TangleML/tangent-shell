import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/card-content";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CardContentElement = defineRemoteElement(TAG, attributes, events);

export const CardContent = makeAuthorComponent(TAG, CardContentElement, events);
