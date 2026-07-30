"use client";

import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchDownloadUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/lib/queries/attachments";
import { formatFileSize } from "@/lib/labels";
import type { AuditEntity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx";
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

export const AttachmentsPanel = ({
  entityType,
  entityId,
}: {
  entityType: AuditEntity;
  entityId: string;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: attachments, isLoading } = useAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    // checagem no cliente é cortesia: quem manda é a API, que recusa com 422
    if (file.size > MAX_SIZE_BYTES) {
      toast.error("O arquivo passa de 20 MB");
      return;
    }
    try {
      await upload.mutateAsync({ entityType, entityId, file });
      toast.success("Arquivo enviado");
    } catch {
      toast.error("Não foi possível enviar o arquivo");
    } finally {
      // sem isto, escolher o mesmo arquivo de novo não dispara onChange
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (id: string, filename: string) => {
    setDownloadingId(id);
    try {
      const url = await fetchDownloadUrl(id);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
    } catch {
      toast.error("Não foi possível abrir o arquivo");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          <Paperclip className="size-4" />
          {upload.isPending ? "Enviando…" : "Anexar arquivo"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !attachments?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>Nenhum arquivo</EmptyTitle>
            <EmptyDescription>Contratos, documentos e propostas deste lead ficam aqui.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {attachments.map((file) => (
            <li key={file.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)} · {file.uploadedByName} ·{" "}
                  {format(parseISO(file.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Baixar ${file.filename}`}
                  disabled={downloadingId === file.id}
                  onClick={() => download(file.id, file.filename)}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${file.filename}`}
                  onClick={() => remove.mutate(file.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
