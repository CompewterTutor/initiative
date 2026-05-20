import { ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToolbarContext } from "@/components/ui/editor/context/toolbar-context";
import { InsertImageDialog } from "@/components/ui/editor/plugins/images-plugin";

export function ImageToolbarPlugin() {
  const { activeEditor, showModal } = useToolbarContext();

  return (
    <Button
      onClick={() => {
        showModal("Insert Image", (onClose) => (
          <InsertImageDialog activeEditor={activeEditor} onClose={onClose} />
        ));
      }}
      variant={"outline"}
      size={"icon-sm"}
      className=""
    >
      <ImageIcon className="size-4" />
    </Button>
  );
}
