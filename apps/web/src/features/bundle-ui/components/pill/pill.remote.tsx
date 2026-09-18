import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/pill";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const PillElement = defineRemoteElement(TAG, attributes, events);

export const Pill = makeAuthorComponent(TAG, PillElement, events);
