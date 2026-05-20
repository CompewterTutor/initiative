import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";

import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatBytes, getFileExtension, getFileTypeLabel } from "@/lib/fileUtils";
import { resolveDocumentDownloadUrl } from "@/lib/uploadUrl";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker from CDN (most reliable for Vite)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface FileDocumentViewerProps {
  documentId: number;
  fileUrl: string;
  contentType?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;
}

export const FileDocumentViewer = ({
  documentId,
  fileUrl,
  contentType,
  originalFilename,
  fileSize,
}: FileDocumentViewerProps) => {
  const { t } = useTranslation("documents");
  const resolvedUrl = resolveDocumentDownloadUrl(documentId);
  const inlineUrl = resolveDocumentDownloadUrl(documentId, true);
  const fileTypeLabel = getFileTypeLabel(contentType, originalFilename);
  const extension = getFileExtension(originalFilename || fileUrl);

  // PDF viewer state
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [baseWidth, setBaseWidth] = useState<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Image viewer state
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Markdown viewer state
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [showRendered, setShowRendered] = useState(true);

  // Determine file type for rendering strategy
  const isPdf = extension === "pdf" || contentType === "application/pdf";
  const isText = extension === "txt" || contentType === "text/plain";
  const isHtml = extension === "html" || extension === "htm" || contentType === "text/html";
  const isImage =
    contentType?.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension);
  const isMarkdown =
    extension === "md" || extension === "markdown" || contentType === "text/markdown";

  // Measure toolbar width once on mount for PDF sizing
  useEffect(() => {
    const measureWidth = () => {
      if (toolbarRef.current) {
        setBaseWidth(toolbarRef.current.clientWidth);
      }
    };

    // Measure after a short delay to ensure layout is complete
    const timeoutId = setTimeout(measureWidth, 50);
    return () => clearTimeout(timeoutId);
  }, []);

  // Fetch markdown content for rendering
  useEffect(() => {
    if (!isMarkdown || !inlineUrl) return;
    fetch(inlineUrl, { credentials: "include" })
      .then((res) => res.text())
      .then(setMarkdownContent)
      .catch(() => setMarkdownContent(""));
  }, [isMarkdown, inlineUrl]);

  // Office documents can't be rendered in-browser without external services
  const isWord =
    ["doc", "docx"].includes(extension) ||
    contentType === "application/msword" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isExcel =
    ["xls", "xlsx"].includes(extension) ||
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const isPowerPoint =
    ["ppt", "pptx"].includes(extension) ||
    contentType === "application/vnd.ms-powerpoint" ||
    contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const isOffice = isWord || isExcel || isPowerPoint;

  const handleDownload = () => {
    if (!resolvedUrl) return;

    const link = document.createElement("a");
    link.href = resolvedUrl;
    link.download = originalFilename || "document";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenInNewTab = () => {
    if (!inlineUrl) return;
    window.open(inlineUrl, "_blank", "noopener,noreferrer");
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPdfError(null);
  };

  const onDocumentLoadError = (error: Error) => {
    console.error("PDF load error:", error);
    setPdfError(t("viewer.pdfError"));
  };

  const zoomIn = () => setScale((prev) => Math.min(2.5, prev + 0.25));
  const zoomOut = () => setScale((prev) => Math.max(0.5, prev - 0.25));

  if (!resolvedUrl || !inlineUrl) {
    return (
      <div className="flex items-center justify-center rounded-lg border p-8 text-muted-foreground">
        <p>{t("viewer.loadError")}</p>
      </div>
    );
  }

  // Get the appropriate icon for Office documents
  const OfficeIcon = isExcel ? FileSpreadsheet : isPowerPoint ? Presentation : FileText;
  const iconColor = isExcel ? "text-green-600" : isPowerPoint ? "text-orange-500" : "text-blue-600";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground text-sm">
          <span className="font-medium">{fileTypeLabel}</span>
          {fileSize && <span className="ml-2">({formatBytes(fileSize)})</span>}
          {originalFilename && (
            <span className="ml-2 inline-block max-w-50 truncate align-bottom">
              {originalFilename}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("viewer.openNewTab")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            {t("viewer.download")}
          </Button>
        </div>
      </div>

      <div
        className="w-full min-w-0 overflow-hidden rounded-lg border bg-card"
        style={baseWidth ? { maxWidth: baseWidth } : undefined}
      >
        {isPdf ? (
          <div className="flex w-full flex-col overflow-hidden">
            {/* PDF Controls */}
            <div
              ref={toolbarRef}
              className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2"
            >
              <span className="text-muted-foreground text-sm">
                {numPages ? t("viewer.pageCount", { count: numPages }) : t("viewer.loading")}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={zoomOut} disabled={scale <= 0.5}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="w-16 text-center text-sm">{Math.round(scale * 100)}%</span>
                <Button variant="outline" size="sm" onClick={zoomIn} disabled={scale >= 2.5}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* PDF Viewer */}
            <div
              className="min-w-0 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900"
              style={{ height: "70vh", minHeight: 500, maxWidth: "100%" }}
            >
              {pdfError ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <FileText className="mb-4 h-16 w-16 text-muted-foreground" />
                  <p className="mb-4 text-muted-foreground">{pdfError}</p>
                  <Button onClick={handleDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("viewer.downloadPdf")}
                  </Button>
                </div>
              ) : baseWidth ? (
                <Document
                  file={inlineUrl}
                  onLoadSuccess={onDocumentLoadSuccess}
                  onLoadError={onDocumentLoadError}
                  loading={
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <div className="flex flex-col items-center gap-4">
                    {Array.from({ length: numPages || 0 }, (_, index) => (
                      <Page
                        // biome-ignore lint/suspicious/noArrayIndexKey: Page numbers are stable and 1-based, so using index as key is fine.
                        key={index + 1}
                        pageNumber={index + 1}
                        width={(baseWidth - 32) * scale}
                        loading={
                          <div className="flex items-center justify-center p-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        }
                      />
                    ))}
                  </div>
                </Document>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
        ) : isText ? (
          // Use iframe for text files
          <iframe
            src={inlineUrl}
            className="w-full bg-muted"
            style={{ height: "70vh", minHeight: 500 }}
            title={originalFilename || t("viewer.textDocument")}
          />
        ) : isHtml ? (
          // Use sandboxed iframe for HTML files
          <iframe
            src={inlineUrl}
            className="w-full"
            style={{ height: "70vh", minHeight: 500 }}
            title={originalFilename || t("viewer.htmlDocument")}
            sandbox=""
          />
        ) : isImage ? (
          <>
            <button
              type="button"
              className="flex w-full cursor-zoom-in items-center justify-center overflow-auto bg-muted/50"
              style={{ height: "70vh", minHeight: 500 }}
              onClick={() => setLightboxOpen(true)}
            >
              <img
                src={inlineUrl}
                alt={originalFilename || t("viewer.imageDocument")}
                className="max-h-full max-w-full object-contain"
              />
            </button>
            <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
              <DialogContent
                className="max-h-[95vh] max-w-[95vw] place-items-center gap-0 border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw]"
                showCloseButton={false}
                onClick={() => setLightboxOpen(false)}
              >
                <img
                  src={inlineUrl}
                  alt={originalFilename || ""}
                  className="max-h-[90vh] max-w-[90vw] object-contain"
                />
              </DialogContent>
            </Dialog>
          </>
        ) : isMarkdown ? (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
              <span className="text-muted-foreground text-sm">{t("viewer.markdownDocument")}</span>
              <Button variant="ghost" size="sm" onClick={() => setShowRendered((prev) => !prev)}>
                {showRendered ? t("viewer.showSource") : t("viewer.showRendered")}
              </Button>
            </div>
            <div className="overflow-auto p-6" style={{ height: "70vh", minHeight: 500 }}>
              {markdownContent === null ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : showRendered ? (
                <Markdown content={markdownContent} />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-muted-foreground text-sm">
                  {markdownContent}
                </pre>
              )}
            </div>
          </div>
        ) : isOffice ? (
          // Office documents - show preview card with download options
          <div
            className="flex flex-col items-center justify-center bg-muted/50"
            style={{ height: "70vh", minHeight: 500 }}
          >
            <OfficeIcon className={`h-24 w-24 ${iconColor} mb-6`} />
            <h3 className="mb-2 font-semibold text-xl">
              {originalFilename || t("viewer.document")}
            </h3>
            <p className="mb-6 max-w-md text-center text-muted-foreground">
              {t("viewer.cannotPreview", { fileType: fileTypeLabel })}
              <br />
              {t("viewer.downloadToView", {
                app: isWord
                  ? "Microsoft Word"
                  : isExcel
                    ? "Microsoft Excel"
                    : "Microsoft PowerPoint",
              })}
            </p>
            <div className="flex gap-3">
              <Button onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {t("viewer.downloadFileType", { fileType: fileTypeLabel })}
              </Button>
              <Button variant="outline" onClick={handleOpenInNewTab}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("viewer.openNewTab")}
              </Button>
            </div>
          </div>
        ) : (
          // Unknown file type - show generic download prompt
          <div
            className="flex flex-col items-center justify-center bg-muted/50"
            style={{ height: "70vh", minHeight: 500 }}
          >
            <FileText className="mb-6 h-24 w-24 text-muted-foreground" />
            <h3 className="mb-2 font-semibold text-xl">
              {originalFilename || t("viewer.document")}
            </h3>
            <p className="mb-6 text-muted-foreground">{t("viewer.unknownFileType")}</p>
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("viewer.downloadFile")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
