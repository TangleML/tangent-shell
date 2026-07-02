import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/textarea";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const TextareaElement = defineRemoteElement(TAG, attributes, events);

export const Textarea = makeAuthorComponent(TAG, TextareaElement, events);
