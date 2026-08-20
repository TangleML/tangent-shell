import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/text";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const TextElement = defineRemoteElement(TAG, attributes, events);

export const Text = makeAuthorComponent(TAG, TextElement, events);
