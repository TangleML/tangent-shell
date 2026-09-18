import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/card";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CardElement = defineRemoteElement(TAG, attributes, events);

export const Card = makeAuthorComponent(TAG, CardElement, events);
