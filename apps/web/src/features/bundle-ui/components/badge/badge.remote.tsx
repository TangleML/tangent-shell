import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/badge";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const BadgeElement = defineRemoteElement(TAG, attributes, events);

export const Badge = makeAuthorComponent(TAG, BadgeElement, events);
