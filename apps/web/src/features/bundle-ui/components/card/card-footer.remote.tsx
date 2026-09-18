import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/card-footer";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CardFooterElement = defineRemoteElement(TAG, attributes, events);

export const CardFooter = makeAuthorComponent(TAG, CardFooterElement, events);
