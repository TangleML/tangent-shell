import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/card-title";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CardTitleElement = defineRemoteElement(TAG, attributes, events);

export const CardTitle = makeAuthorComponent(TAG, CardTitleElement, events);
