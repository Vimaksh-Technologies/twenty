import { saveAs } from 'file-saver';

export const downloadFile = (
  fullPath: string,
  fileName: string,
  requestInit?: RequestInit,
) => {
  return (requestInit ? fetch(fullPath, requestInit) : fetch(fullPath))
    .then((resp) =>
      resp.status === 200
        ? resp.blob()
        : Promise.reject('Failed downloading file'),
    )
    .then((blob) => {
      saveAs(blob, fileName);
    });
};
