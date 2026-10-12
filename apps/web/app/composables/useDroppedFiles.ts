/** Files dropped anywhere in the app, waiting for the Projects page to show the import dialog. */
export function useDroppedFiles() {
  return useState<File[]>('dropped-files', () => [])
}
