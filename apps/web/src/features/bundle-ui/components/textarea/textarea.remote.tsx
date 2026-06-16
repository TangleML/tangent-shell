import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./textarea.contract";

const TextareaElement = defineRemoteElement(TAG, attributes, events);

export const Textarea = makeAuthorComponent(TAG, TextareaElement, events);
