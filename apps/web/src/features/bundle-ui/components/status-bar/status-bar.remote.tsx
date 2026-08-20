import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/status-bar";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const StatusBarElement = defineRemoteElement(TAG, attributes, events);

export const StatusBar = makeAuthorComponent(TAG, StatusBarElement, events);
