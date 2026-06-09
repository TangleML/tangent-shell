import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./pill.contract";

const PillElement = defineRemoteElement(TAG, attributes, events);

export const Pill = makeAuthorComponent(TAG, PillElement, events);
