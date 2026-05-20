import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/extension";
import { ScissorsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToolbarContext } from "@/components/ui/editor/context/toolbar-context";

export function HorizontalRuleToolbarPlugin() {
  const { activeEditor } = useToolbarContext();

  return (
    <Button
      onClick={() => activeEditor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}
      size={"icon-sm"}
      variant={"outline"}
      className=""
    >
      <ScissorsIcon className="size-4" />
    </Button>
  );
}
