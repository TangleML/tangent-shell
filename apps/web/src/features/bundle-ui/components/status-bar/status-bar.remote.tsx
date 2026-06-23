import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./status-bar.contract";

const StatusBarElement = defineRemoteElement(TAG, attributes, events);

export const StatusBar = makeAuthorComponent(TAG, StatusBarElement, events);
