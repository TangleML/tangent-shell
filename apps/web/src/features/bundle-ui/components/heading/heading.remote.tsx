import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/heading";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const HeadingElement = defineRemoteElement(TAG, attributes, events);

export const Heading = makeAuthorComponent(TAG, HeadingElement, events);
