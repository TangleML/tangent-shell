import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/checkbox";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const CheckboxElement = defineRemoteElement(TAG, attributes, events);

export const Checkbox = makeAuthorComponent(TAG, CheckboxElement, events);
