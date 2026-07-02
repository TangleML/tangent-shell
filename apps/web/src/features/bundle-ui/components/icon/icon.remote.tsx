import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/icon";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const IconElement = defineRemoteElement(TAG, attributes, events);

export const Icon = makeAuthorComponent(TAG, IconElement, events);
