import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/inline-stack";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const InlineStackElement = defineRemoteElement(TAG, attributes, events);

export const InlineStack = makeAuthorComponent(TAG, InlineStackElement, events);
