import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./progress.contract";

const ProgressElement = defineRemoteElement(TAG, attributes, events);

export const Progress = makeAuthorComponent(TAG, ProgressElement, events);
