export type ImagePreviewLabels = Readonly<{
  actualSize: string;
  fit: string;
  loadError: string;
  loading: string;
  zoomIn: string;
  zoomOut: string;
}>;

export type ImagePreviewProps = Readonly<{
  alt: string;
  labels: ImagePreviewLabels;
  src: string;
}>;
