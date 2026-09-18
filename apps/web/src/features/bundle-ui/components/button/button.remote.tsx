import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/button";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const ButtonElement = defineRemoteElement(TAG, attributes, events);

export const Button = makeAuthorComponent(TAG, ButtonElement, events);
