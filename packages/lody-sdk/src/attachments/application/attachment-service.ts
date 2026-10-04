import type {
  AttachmentDownload,
  AttachmentRequestOptions,
  FileAttachment,
  FilePreview,
  FilePreviewResult,
  FileUpload,
  ImageAttachment,
  ImageUpload,
} from '../domain/attachments.js';
import {
  AttachmentError,
  FILE_MAX_BYTES,
  validateDownload,
  validateImages,
  validateLocation,
  validateSource,
} from '../domain/attachments.js';

export interface AttachmentGateway {
  uploadFile: (input: FileUpload, options?: AttachmentRequestOptions) => Promise<FileAttachment>;
  uploadImages: (
    input: ImageUpload,
    options?: AttachmentRequestOptions,
  ) => Promise<ImageAttachment[]>;
  downloadFile: (input: AttachmentDownload, options?: AttachmentRequestOptions) => Promise<Blob>;
  downloadImage: (input: AttachmentDownload, options?: AttachmentRequestOptions) => Promise<Blob>;
  previewFile: (
    input: FilePreview,
    options?: AttachmentRequestOptions,
  ) => Promise<FilePreviewResult>;
}

export class AttachmentService {
  constructor(private readonly gateway: AttachmentGateway) {}

  uploadFile = async (
    input: FileUpload,
    options?: AttachmentRequestOptions,
  ): Promise<FileAttachment> => {
    validateLocation(input);
    validateSource(input, FILE_MAX_BYTES);
    return this.gateway.uploadFile(input, options);
  };
  uploadImages = async (
    input: ImageUpload,
    options?: AttachmentRequestOptions,
  ): Promise<ImageAttachment[]> => {
    validateImages(input);
    return this.gateway.uploadImages(input, options);
  };
  downloadFile = async (
    input: AttachmentDownload,
    options?: AttachmentRequestOptions,
  ): Promise<Blob> => {
    validateDownload(input);
    return this.gateway.downloadFile(input, options);
  };
  downloadImage = async (
    input: AttachmentDownload,
    options?: AttachmentRequestOptions,
  ): Promise<Blob> => {
    validateDownload(input);
    return this.gateway.downloadImage(input, options);
  };
  previewFile = async (
    input: FilePreview,
    options?: AttachmentRequestOptions,
  ): Promise<FilePreviewResult> => {
    validateDownload(input);
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 0 ||
      input.sizeBytes > FILE_MAX_BYTES
    )
      throw new AttachmentError('invalid_argument');
    return this.gateway.previewFile(input, options);
  };
}
