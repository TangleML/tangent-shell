import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./text.contract";

const TextElement = defineRemoteElement(TAG, attributes, events);

export const Text = makeAuthorComponent(TAG, TextElement, events);
