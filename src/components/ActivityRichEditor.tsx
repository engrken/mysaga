"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

export function ActivityRichEditor({ value, onChange, disabled }: {
  value: string; onChange: (html: string) => void; disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true })],
    content: value || "<p></p>",
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange(current.getHTML())
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== (value || "<p></p>")) {
      editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);

  return <div className="border rounded overflow-hidden">
    <div className="d-flex flex-wrap gap-1 border-bottom p-2 bg-body-tertiary" aria-label="Formatting tools">
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleBold().run()}>Bold</button>
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}>Italic</button>
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}>Bullets</button>
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>Numbered list</button>
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</button>
    </div>
    <EditorContent editor={editor} className="p-3 activity-rich-editor" />
  </div>;
}
