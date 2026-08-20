import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/card-header";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CardHeaderElement = defineRemoteElement(TAG, attributes, events);

export const CardHeader = makeAuthorComponent(TAG, CardHeaderElement, events);
