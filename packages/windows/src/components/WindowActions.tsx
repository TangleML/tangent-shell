import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { tracking } from "@tangent/utils";
import { observer } from "mobx-react-lite";

import { useWindowContext } from "../ContentWindowStateContext";

const buttonClassName =
  "h-5 w-5 text-muted-foreground hover:text-foreground hover:bg-accent";
const closeButtonClassName =
  "h-5 w-5 text-muted-foreground hover:text-destructive hover:bg-accent";

export const WindowActions = observer(function WindowActions() {
  const { model } = useWindowContext();

  return (
    <div
      className="shrink-0 flex items-center gap-0.5"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {!model.isActionDisabled("minimize") && model.isDocked && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClassName}
          onClick={() => model.toggleMinimize()}
          aria-label={model.isMinimized ? "Expand" : "Minimize"}
          {...tracking("v2.shared_window.chrome.minimize", {
            placement: "docked",
          })}
        >
          <Icon name={model.isMinimized ? "ChevronDown" : "Minus"} size="xs" />
        </Button>
      )}

      {!model.isActionDisabled("maximize") && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClassName}
          onClick={() => model.toggleMaximize()}
          aria-label={model.isMaximized ? "Restore" : "Maximize"}
          {...tracking("v2.shared_window.chrome.maximize", {
            placement: model.isDocked ? "docked" : "floating",
          })}
        >
          <Icon
            name={model.isMaximized ? "Minimize2" : "Maximize2"}
            size="xs"
          />
        </Button>
      )}

      {!model.isActionDisabled("hide") ? (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClassName}
          onClick={() => model.hide()}
          aria-label="Hide"
          {...tracking("v2.shared_window.chrome.hide", {
            placement: model.isDocked ? "docked" : "floating",
          })}
        >
          <Icon name="X" size="xs" />
        </Button>
      ) : !model.isActionDisabled("close") ? (
        <Button
          variant="ghost"
          size="icon"
          className={closeButtonClassName}
          onClick={() => model.close()}
          aria-label="Close"
          {...tracking("v2.shared_window.chrome.close", {
            placement: model.isDocked ? "docked" : "floating",
          })}
        >
          <Icon name="X" size="xs" />
        </Button>
      ) : null}
    </div>
  );
});
