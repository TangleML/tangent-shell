import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/card-description";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CardDescriptionElement = defineRemoteElement(TAG, attributes, events);

export const CardDescription = makeAuthorComponent(
  TAG,
  CardDescriptionElement,
  events,
);
